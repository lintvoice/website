"""The in-browser check's assets: the rule files the lintvoice command-line tool runs, compiled for the browser, with
the schemas and the runtimes the check page loads.

- Rule files: the rule packs that the pinned lintvoice version installs (`lintvoice.rulepacks`, same sources and
  checksums), so the page and the command-line tool run the same files. Their Schematron stylesheets are compiled to
  SaxonJS SEF files with xslt3 (Node, version pinned in package-lock.json).
- Schemas: the XSD trees the page validates against, and for each main schema the list of files it includes or
  imports (xsd/manifest.json), so the page loads only those.
- Runtimes: SaxonJS 2.7, downloaded from Saxonica and checked by SHA-256 (its licence allows unmodified
  redistribution inside an application that uses it, with its notice: LICENSE-SaxonJS.txt); pdf.js and xmllint-wasm
  from npm, with their licences.

The result is cached in .check-cache/ and rebuilt only when one of these versions changes.
"""

import hashlib
import io
import json
import posixpath
import re
import shutil
import subprocess
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from importlib.metadata import version
from importlib.resources import files
from pathlib import Path

from lintvoice import rulepacks
from lintvoice.rulecheck import contexts

ROOT = Path(__file__).parent
CACHE = ROOT / ".check-cache"

EN = rulepacks.PACKS["en16931"].folder
FR = f"{rulepacks.PACKS['france-rfe'].folder}/FNFE_RFE_INVOICE"

# The stylesheets the command-line tool runs, by the name the page asks for (static/check/engine.mjs).
STYLESHEETS = {
    "en16931-cii": f"{EN}/cii/xslt/EN16931-CII-validation.xslt",
    "en16931-ubl": f"{EN}/ubl/xslt/EN16931-UBL-validation.xslt",
    "facturx-basicwl": f"{FR}/Factur-X/BASICWL/2xslt/FACTUR-X_BASIC-WL.xslt",
    "facturx-en16931": f"{FR}/Factur-X/EN16931/2xslt/FACTUR-X_EN16931.xslt",
    "facturx-extended": f"{FR}/Factur-X/EXTENDED/2xslt/FACTUR-X_EXTENDED.xslt",
    "br-fr-cii": f"{FR}/CII/EN16931/2xslt/BR-FR-Flux2-Schematron-CII.xslt",
    "extended-ctc-fr": f"{FR}/CII/EXTENDED-CTC-FR/2xslt/EXTENDED-CTC-FR-CII.xslt",
    "br-fr-ubl": f"{FR}/UBL/EN16931/2xslt/BR-FR-Flux2-Schematron-UBL.xslt",
}
# The Factur-X profile rules read a code list next to the stylesheet when they run.
CODE_LISTS = [
    f"{FR}/Factur-X/{p}/2xslt/FACTUR-X_{f}_codedb.xml"
    for p, f in (("BASICWL", "BASIC-WL"), ("EN16931", "EN16931"), ("EXTENDED", "EXTENDED"))
]

SCHEMA_TREES = [
    "Factur-X/BASICWL/1xsd",
    "Factur-X/EN16931/1xsd",
    "Factur-X/EXTENDED/1xsd",
    "CII/1xsd-CII_D22B_uncoupled",
    "UBL/1xsd_UBL2.1",
]
MAIN_SCHEMAS = [
    *(f"Factur-X/{p}/1xsd/Factur-X_{p}.xsd" for p in ("BASICWL", "EN16931", "EXTENDED")),
    "CII/1xsd-CII_D22B_uncoupled/CrossIndustryInvoice_100pD22B.xsd",
    *(f"UBL/1xsd_UBL2.1/maindoc/UBL-{r}-2.1.xsd" for r in ("Invoice", "CreditNote")),
]

SAXONJS = {
    "url": "https://downloads.saxonica.com/SaxonJS/2/SaxonJS-2.7.zip",
    "sha256": "13cbd2e6eb0a80dcf64067e88cb5eab54a52c3a29e01fe0b156346895585845d",
}
# Runtime files from npm (node_modules/).
NPM_FILES = {
    "pdf.min.mjs": "pdfjs-dist/build/pdf.min.mjs",
    "pdf.worker.min.mjs": "pdfjs-dist/build/pdf.worker.min.mjs",
    "index-browser.mjs": "xmllint-wasm/index-browser.mjs",
    "xmllint-browser.mjs": "xmllint-wasm/xmllint-browser.mjs",
    "xmllint.wasm": "xmllint-wasm/xmllint.wasm",
}
# The EN 16931 artefacts' licence, from their repository at the pinned release (their zips do not carry it).
EUPL = {
    "url": "https://raw.githubusercontent.com/ConnectingEurope/eInvoicing-EN16931/validation-1.3.17/LICENSE.txt",
    "sha256": "fc22ec1dcd8bee4636a395fb332e2308cde870fb3fdc71a2e260b919877cdef5",
}

# What the page serves, where it comes from, under which licence: written to NOTICES.txt, next to the licence texts
# (licenses/). Compiled rule files keep their rules unchanged; their sources are at the address given.
FX = rulepacks.PACKS["france-rfe"]
NOTICES = [
    {
        "name": f"EN 16931 validation artefacts {rulepacks.PACKS['en16931'].version}",
        "source": rulepacks.PACKS["en16931"].source,
        "licence": "EUPL-1.2 (licenses/EUPL-1.2.txt)",
        "files": "sef/en16931-cii.sef.json, sef/en16931-ubl.sef.json: the release's XSLT files compiled for SaxonJS with xslt3 2.7.0",
    },
    {
        "name": f"FNFE-MPE France_RFE {FX.version}",
        "source": FX.source,
        "licence": "Apache-2.0 for the repository (licenses/France_RFE-LICENSE.txt); most of its Schematron files carry an EUPL header",
        "files": "sef/facturx-*.sef.json, sef/br-fr-*.sef.json, sef/extended-ctc-fr.sef.json: XSLT files compiled for SaxonJS with xslt3 2.7.0; sef/*_codedb.xml and xsd/: unchanged copies of the repository's files",
    },
    {
        "name": "SaxonJS 2.7, Saxonica Ltd",
        "source": SAXONJS["url"],
        "licence": "Saxonica licence (licenses/SaxonJS-LICENSE.txt): free, redistributed unmodified, not open source",
        "files": "vendor/SaxonJS2.rt.js",
    },
    {
        "name": "pdf.js 6.4.299 (npm pdfjs-dist), Mozilla",
        "source": "https://github.com/mozilla/pdf.js",
        "licence": "Apache-2.0 (licenses/pdf.js-LICENSE.txt)",
        "files": "vendor/pdf.min.mjs, vendor/pdf.worker.min.mjs",
    },
    {
        "name": "xmllint-wasm 5.3.0, libxml2 compiled to WebAssembly",
        "source": "https://github.com/noppa/xmllint-wasm",
        "licence": "MIT (licenses/xmllint-wasm-COPYING.txt)",
        "files": "vendor/index-browser.mjs, vendor/xmllint-browser.mjs, vendor/xmllint.wasm",
    },
]


def _stamp():
    lock = (ROOT / "package-lock.json").read_bytes()
    return {
        "lintvoice": version("lintvoice"),
        "packs": {p.id: p.version for p in rulepacks.PACKS.values()},
        "saxonjs": SAXONJS["sha256"],
        "notices": NOTICES,
        "package-lock": hashlib.sha256(lock).hexdigest(),
        "stylesheets": STYLESHEETS,
        "outputs": ["contexts.json"],  # a new output rebuilds the cache once
    }


def _download(url, sha256):
    if not url.startswith("https://"):
        raise ValueError(f"refusing to download from {url!r}: only https:// is allowed")
    with urllib.request.urlopen(url, timeout=120) as response:  # noqa: S310 (https only, checked above)
        data = response.read()
    if hashlib.sha256(data).hexdigest() != sha256:
        raise ValueError(f"checksum mismatch for {url}: the download is not the pinned version")
    return data


def _compile(rules, name, out):
    """Compile one stylesheet to a SEF file with the locked xslt3 (npx --no-install never fetches another)."""
    xsl, sef = rules / STYLESHEETS[name], out / f"{name}.sef.json"
    command = ["npx", "--no-install", "xslt3", f"-xsl:{xsl}", f"-export:{sef}", "-nogo", "-relocate:on", "-ns:##html5"]
    subprocess.run(command, cwd=ROOT, check=True, capture_output=True)  # noqa: S603 (our pinned tool and paths)


def _manifest(xsd):
    """For each main schema, the files it includes or imports, transitively."""

    def reachable(main):
        seen, todo = set(), [main]
        while todo:
            f = posixpath.normpath(todo.pop())
            if f in seen:
                continue
            seen.add(f)
            for loc in re.findall(r'schemaLocation="([^"]+)"', (xsd / f).read_text(encoding="utf-8", errors="replace")):
                todo.append(posixpath.join(posixpath.dirname(f), loc))
        return sorted(seen)

    return {m: reachable(m) for m in MAIN_SCHEMAS}


def build(cache=CACHE):
    """Build the assets (or reuse them when nothing changed); return the folder that holds vendor/, sef/, xsd/,
    licenses/, NOTICES.txt, terms.json and contexts.json."""
    out = cache / "assets"
    stamp = _stamp()
    if (out / "stamp.json").exists() and json.loads((out / "stamp.json").read_text(encoding="utf-8")) == stamp:
        return out
    subprocess.run(
        ["npm", "ci", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund"],  # noqa: S607
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    rules = cache / "rules"
    for pack in rulepacks.PACKS.values():
        rulepacks.install(pack, rules)

    staging = cache / "assets.tmp"
    shutil.rmtree(staging, ignore_errors=True)
    sef, xsd, vendor, licenses = staging / "sef", staging / "xsd", staging / "vendor", staging / "licenses"
    for folder in (sef, xsd, vendor, licenses):
        folder.mkdir(parents=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda name: _compile(rules, name, sef), STYLESHEETS))
    for code_list in CODE_LISTS:
        shutil.copy(rules / code_list, sef)

    for tree in SCHEMA_TREES:
        shutil.copytree(rules / FR / tree, xsd / tree)
    (xsd / "manifest.json").write_text(json.dumps(_manifest(xsd), indent=1), encoding="utf-8")

    with zipfile.ZipFile(io.BytesIO(_download(SAXONJS["url"], SAXONJS["sha256"]))) as z:
        (vendor / "SaxonJS2.rt.js").write_bytes(z.read("saxon-js/SaxonJS2.rt.js"))
        (licenses / "SaxonJS-LICENSE.txt").write_bytes(z.read("saxon-js/LICENSE.txt"))
    for name, source in NPM_FILES.items():
        shutil.copy(ROOT / "node_modules" / source, vendor / name)
    shutil.copy(ROOT / "node_modules/pdfjs-dist/LICENSE", licenses / "pdf.js-LICENSE.txt")
    shutil.copy(ROOT / "node_modules/xmllint-wasm/COPYING", licenses / "xmllint-wasm-COPYING.txt")
    shutil.copy(rules / FX.folder / "LICENSE", licenses / "France_RFE-LICENSE.txt")
    (licenses / "EUPL-1.2.txt").write_bytes(_download(EUPL["url"], EUPL["sha256"]))
    lines = [
        "Files used by the in-browser check on lintvoice.com",
        "",
        "The check runs these files in your browser. Each keeps its own licence; the texts are in licenses/.",
        "",
    ]
    for n in NOTICES:
        lines += [n["name"], f"  Source: {n['source']}", f"  Licence: {n['licence']}", f"  Served as: {n['files']}", ""]
    (staging / "NOTICES.txt").write_text("\n".join(lines), encoding="utf-8")

    # for each compiled rule file, the rule context of each assert (read by lintvoice, as for `lintvoice check --rule`):
    # what tells a rule that applies from one that does not
    rule_contexts = {name: contexts((rules / path).read_text(encoding="utf-8")) for name, path in STYLESHEETS.items()}
    (staging / "contexts.json").write_text(json.dumps(rule_contexts, ensure_ascii=False), encoding="utf-8")
    # where each business term is read and the totals computations: the command-line tool's own data
    (staging / "terms.json").write_bytes(files("lintvoice").joinpath("terms.json").read_bytes())
    (staging / "stamp.json").write_text(json.dumps(stamp, indent=1), encoding="utf-8")
    shutil.rmtree(out, ignore_errors=True)
    staging.rename(out)
    return out
