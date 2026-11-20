"""The check page against the lintvoice command-line tool: the same files must give the same findings.

    uv run python build.py
    uv run --group parity playwright install chromium   # or webkit, firefox
    uv run --group parity python tools/parity.py chromium [webkit firefox]

Builds a corpus: the EN 16931 examples from the rule packs, the gallery's example invoices, files crafted for each
Factur-X profile and for each way a file can be refused, and hostile files (deep nesting, entity expansion, broken
or encrypted PDFs, a decompression bomb, 2,000 invoice lines). Checks it with `lintvoice check --format json`, then
with the page's own engine in each browser, served from dist/, and compares file by file. For every rule page, each
file's answer for that rule (fails, no error found, does not apply and why, not checked) is compared too: the rule
pages' own check (rule-answer.mjs) against `lintvoice check --rule`.

Exits 1 on any difference but one, which the page makes on purpose: an invoice over its line limit is refused as
too large for a check in the browser, where the command-line tool checks it.
"""

import base64
import contextlib
import functools
import http.server
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import zlib
from importlib.metadata import version
from pathlib import Path

from playwright.sync_api import sync_playwright
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject, StreamObject

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
import checkassets  # noqa: E402

DIST = ROOT / "dist"
EXAMPLES = DIST / "examples" / "fr"
MAX_LINES = int(
    re.search(r"MAX_LINES = (\d+)", (ROOT / "static/check/engine.mjs").read_text(encoding="utf-8")).group(1)
)
LINE = re.compile(rb"<(?:\w+:)?(?:IncludedSupplyChainTradeLineItem|InvoiceLine|CreditNoteLine)\b")
TIMEOUT_MS = 120_000  # the command-line tool's budget is 60 s per file; twice that before calling it a hang


def _pdf(*attachments, encrypt=None):
    writer = PdfWriter()
    writer.add_blank_page(width=595, height=842)
    for name, data in attachments:
        writer.add_attachment(name, data)
    if encrypt:
        writer.encrypt(encrypt)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _flate_bomb():
    """A factur-x.xml attachment whose stream inflates to 1 GiB."""
    writer = PdfWriter(clone_from=PdfReader(io.BytesIO(_pdf(("factur-x.xml", b"<a/>")))))
    bomb = zlib.compress(b"<a>" + b" " * (1 << 30), 9)
    for ref in writer._objects:
        obj = ref.get_object() if ref is not None else None
        if isinstance(obj, StreamObject) and obj.get("/Type") == "/EmbeddedFile":
            obj._data = bomb
            obj[NameObject("/Filter")] = NameObject("/FlateDecode")
            obj[NameObject("/Length")] = NumberObject(len(bomb))
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def corpus(folder):
    rules = checkassets.CACHE / "rules" / checkassets.EN
    for syntax in ("cii", "ubl"):
        for p in sorted((rules / syntax / "examples").glob("*.xml")):
            shutil.copy(p, folder / f"official-{syntax}-{p.name}")
    for p in sorted([EXAMPLES / "valid.xml", EXAMPLES / "valid.pdf", *(EXAMPLES / "invalid").iterdir()]):
        shutil.copy(p, folder / f"examples-{p.name}")

    valid = (EXAMPLES / "valid.xml").read_text(encoding="utf-8")
    for name, spec in (
        ("basicwl", "urn:factur-x.eu:1p0:basicwl"),
        ("minimum", "urn:factur-x.eu:1p0:minimum"),
        ("extended", "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended"),
        ("extended-ctc-fr", "urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr"),
    ):
        crafted = valid.replace("<ram:ID>urn:cen.eu:en16931:2017</ram:ID>", f"<ram:ID>{spec}</ram:ID>")
        (folder / f"crafted-{name}.xml").write_text(crafted, encoding="utf-8")
    doctype = valid.replace("?>\n", '?>\n<!DOCTYPE x SYSTEM "http://example.com/x.dtd">\n', 1)
    (folder / "crafted-doctype.xml").write_text(doctype, encoding="utf-8")
    (folder / "crafted-not-an-invoice.xml").write_text("<note><to>x</to></note>", encoding="utf-8")
    (folder / "crafted-broken.xml").write_text(valid[: len(valid) // 2], encoding="utf-8")
    # Two VAT breakdowns: the 25 % one 1.50 too high (BR-CO-17 and BR-S-09 reject it), the 12 % one with only its sign
    # flipped (both rules compare amounts without their sign, so they accept it). The explanation must show the 25 %
    # breakdown, on the page as in lintvoice.
    two_rates = (rules / "cii" / "examples" / "CII_example4.xml").read_text(encoding="utf-8")
    for old, new in (("375", "376.50"), ("300", "-300")):
        tag = "<ram:CalculatedAmount>{}</ram:CalculatedAmount>"
        if two_rates.count(tag.format(old)) != 1:
            raise SystemExit(f"CII_example4.xml has changed: not one VAT amount of {old}")
        two_rates = two_rates.replace(tag.format(old), tag.format(new))
    (folder / "crafted-vat-sign-flipped.xml").write_text(two_rates, encoding="utf-8")

    head, rest = valid.split("?>", 1)
    laughs = (
        '<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa">'
        + "".join(f'<!ENTITY {n} "{("&" + p + ";") * 10}">' for p, n in zip("abcdefg", "bcdefgh", strict=True))
        + "]>"
    )
    item = re.search(r"<ram:IncludedSupplyChainTradeLineItem>.*?</ram:IncludedSupplyChainTradeLineItem>", valid, re.S)
    first = valid.index("<ram:IncludedSupplyChainTradeLineItem>")
    last = valid.rindex("</ram:IncludedSupplyChainTradeLineItem>") + len("</ram:IncludedSupplyChainTradeLineItem>")
    pdf = (EXAMPLES / "valid.pdf").read_bytes()
    xml = valid.encode()
    hostile = {
        "deep-nesting.xml": (head + "?>" + "<a>" * 100_000 + "</a>" * 100_000).encode(),
        "billion-laughs.xml": (head + "?>" + laughs + rest).encode(),
        "2000-lines.xml": (valid[:first] + item.group(0) * 2000 + valid[last:]).encode(),
        "truncated.pdf": pdf[: len(pdf) // 2],
        "no-trailer.pdf": pdf.split(b"trailer")[0],
        "garbage.pdf": b"%PDF-1.7\n" + bytes(range(256)) * 800,
        "300-attachments.pdf": _pdf(*[(f"other-{i}.xml", b"<x/>") for i in range(300)], ("factur-x.xml", xml)),
        "encrypted.pdf": _pdf(("factur-x.xml", xml), encrypt="secret"),
        "flate-bomb.pdf": _flate_bomb(),
    }
    for name, data in hostile.items():
        (folder / f"hostile-{name}").write_bytes(data)
    return sorted(folder.iterdir())


def rule_pages():
    """Each rule page's own check data (its id, the official ids reported under it, its rule contexts), as built."""
    found = re.compile(r'<script type="application/json" id="rule-check-data">(.*?)</script>', re.S)
    pages = []
    for page in sorted((DIST / "rules").glob("*/index.html")):
        m = found.search(page.read_text(encoding="utf-8"))
        if m:
            data = json.loads(m.group(1))
            pages.append({"id": data["id"], "ids": data["ids"], "contexts": data["contexts"]})
    return pages


def cli(files, pages):
    rules = str(checkassets.CACHE / "rules")
    asked = [arg for page in pages for arg in ("--rule", page["id"])]
    command = [sys.executable, "-m", "lintvoice", "check", "--format", "json", "--rules-dir", rules, *asked]
    command += map(str, files)
    r = subprocess.run(command, capture_output=True, text=True, check=False)  # noqa: S603 (our own tool)
    return {Path(f["path"]).name: f for f in json.loads(r.stdout)["files"]}


@contextlib.contextmanager
def server():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    handler = functools.partial(Quiet, directory=str(DIST))

    class Server(http.server.ThreadingHTTPServer):
        request_queue_size = 128  # the page fetches a schema's files in parallel; the default backlog is 5

    httpd = Server(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        yield f"http://127.0.0.1:{httpd.server_address[1]}"
    finally:
        httpd.shutdown()


# The page's engine, as the page itself loads it; evaluate() has no timeout of its own, so the check is started
# without waiting and its result awaited with one.
START = """([n, b, pages]) => {
  window.__r = undefined;
  const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  Promise.all([import("/static/check/engine.mjs"), import("/static/check/rule-answer.mjs")])
    .then(([m, a]) => m.check(n, bytes).then((r) => {
      if (r.findings && pages.length) r.rules = pages.map((page) => a.answer(r, page));  // each rule page's answer
      return r;
    }))
    .then((r) => (window.__r = r), (e) => (window.__r = { path: n, status: "page-error", error: String(e) }));
}"""


def browser_run(p, kind, url, files, pages):
    """A shared browser for ordinary files; a hostile file gets a browser of its own, so that a crash or a hang
    says something about that file only."""
    state = {}

    def fresh():
        with contextlib.suppress(Exception):
            state["browser"].close()
        state["browser"] = getattr(p, kind).launch()
        page = state["browser"].new_page()
        page.goto(f"{url}/check/")
        page.wait_for_function("window.lintvoiceReady === true", timeout=60_000)
        return page

    page, results = fresh(), {}
    for f in files:
        hostile = f.name.startswith("hostile-")
        if hostile:
            page = fresh()
        start = time.perf_counter()
        try:
            page.evaluate(START, [f.name, base64.b64encode(f.read_bytes()).decode(), pages])
            page.wait_for_function("window.__r !== undefined", timeout=TIMEOUT_MS, polling=200)
            r = page.evaluate("window.__r")
        except Exception as e:  # a crash or a hang of the page itself: a difference to report
            status = "timeout" if "Timeout" in type(e).__name__ else "page-error"
            r = {"path": f.name, "status": status, "error": str(e).splitlines()[0]}
        r["wall_ms"] = round((time.perf_counter() - start) * 1000)
        results[f.name] = r
        if hostile or r["status"] in ("page-error", "timeout"):
            page = fresh()
    with contextlib.suppress(Exception):
        state["browser"].close()
    return results


def comparable(f):
    """What must match between the command-line tool and the page."""
    if f.get("status") in ("unreadable", "page-error", "timeout", "too-large"):
        error = f.get("error", "")
        kind = (
            "doctype"
            if "DOCTYPE" in error
            else "well-formed"
            if "well-formed" in error
            else "not-invoice"
            if "not a CII or UBL" in error
            else "pdf-unreadable"
            if "cannot read this PDF" in error or "attached file is larger" in error
            else "no-xml-in-pdf"
            if "no embedded invoice XML" in error
            else error
        )
        return {"status": f["status"], "error": kind}
    findings = []
    for g in f["findings"]:
        messages = sorted(
            (re.sub(r"\s+", " ", m["message"]).strip() if g["rule"] == "XSD" else m["message"], tuple(m["locations"]))
            for m in g["messages"]
        )
        computation = json.dumps(g.get("computation"), sort_keys=True)  # the values behind a totals rule
        findings.append((g["rule"], g["severity"], g["rule_set"], g["count"], tuple(messages), computation))
    return {
        "status": f["status"],
        "document": f["document"],
        "rule_sets": f["rule_sets"],
        "notes": f["notes"],
        "not_run": [n["rule_set"] for n in f["not_run"]],
        "summary": f["summary"],
        "findings": findings,
        "values": f.get("values"),  # what the invoice says, read the same way on both sides
        "rules": f.get("rules"),  # each rule page's answer for this file
    }


def by_design(path, ref, got):
    """The page refuses an invoice over its line limit, which the command-line tool checks."""
    lines = len(LINE.findall(path.read_bytes()))
    return got.get("status") == "too-large" and lines > MAX_LINES and ref["status"] not in ("unreadable",)


def main(kinds):
    with tempfile.TemporaryDirectory() as tmp:
        files = corpus(Path(tmp))
        pages = rule_pages()
        ref = cli(files, pages)
        print(
            f"corpus: {len(files)} files, checked by lintvoice {version('lintvoice')}; "
            f"each file's answer for the {len(pages)} rules with a page",
            flush=True,
        )
        failed = False
        with server() as url, sync_playwright() as p:
            for kind in kinds:
                t0 = time.perf_counter()
                got = browser_run(p, kind, url, files, pages)
                same, expected, diffs = 0, [], []
                for f in files:
                    if comparable(ref[f.name]) == comparable(got[f.name]):
                        same += 1
                    elif by_design(f, ref[f.name], got[f.name]):
                        expected.append(f.name)
                    else:
                        a, b = comparable(ref[f.name]), comparable(got[f.name])
                        why = b.get("error", "") or "; ".join(
                            f"{n['rule_set']}: {n['error']}" for n in got[f.name].get("not_run", [])
                        )
                        diffs.append((f.name, [k for k in a if a.get(k) != b.get(k)] or ["status"], why))
                walls = sorted(r["wall_ms"] for r in got.values())
                print(
                    f"{kind}: {same}/{len(files)} identical, {len(expected)} refused as too large by design "
                    f"({', '.join(expected)}); {time.perf_counter() - t0:.0f} s, slowest file {walls[-1]} ms",
                    flush=True,
                )
                for name, keys, error in diffs:
                    print(f"  DIFF {name}: {', '.join(keys)} {error}".rstrip(), flush=True)
                failed |= bool(diffs)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["chromium"]))
