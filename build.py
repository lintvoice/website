"""Build lintvoice.com into a folder of static files.

    uv run python build.py                 # into dist/
    uv run python build.py --strict        # the same, but refuses a legal notice still marked TODO
    python -m http.server -d dist 8000     # preview at http://localhost:8000

Pages come from templates/ and the texts in content/{en,fr}.toml. The examples gallery runs the
invoice-examples generator at the version this project pins, so the files served are the ones its tests check.
"""

import argparse
import json
import os
import re
import shutil
import sys
import tomllib
import zipfile
from pathlib import Path

from invoice_examples import cli as examples_cli
from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape
from markupsafe import Markup, escape

ROOT = Path(__file__).parent
LANGS = ("en", "fr")
PAGES = {
    "home": {"en": "/", "fr": "/fr/"},
    "examples": {"en": "/examples/", "fr": "/fr/exemples/"},
    "legal": {"en": "/legal/", "fr": "/fr/mentions-legales/"},
}
FILES_HREF = "/examples/fr/"  # the example files, shared by both languages
ZIP_HREF = "/examples/invoice-examples-fr.zip"
MARKER = ".built-by-lintvoice-website"  # only a folder carrying it is ever wiped
PUBLISHER_KEYS = ("publisher", "legal_form", "address", "registration", "vat", "director", "contact", "phone")
FIXED_TIME = (2026, 1, 1, 0, 0, 0)  # zip entries: the same bytes on every build


LINK = re.compile(r"\[([^\]]+)\]\(((?:https://|/)[^)\s]+)\)")


def links(text):
    """Texts may carry Markdown-style links, [label](https://… or /…): escape everything, then turn those into <a>."""
    escaped = str(escape(text))
    # The text is escaped first; only https:// and / links are built from it.
    return Markup(LINK.sub(lambda m: f'<a href="{m.group(2)}">{m.group(1)}</a>', escaped))  # noqa: S704


class NotReady(Exception):
    """The site is not ready to go live (--strict)."""


def load():
    site = tomllib.loads((ROOT / "site.toml").read_text(encoding="utf-8"))
    texts = {lang: tomllib.loads((ROOT / "content" / f"{lang}.toml").read_text(encoding="utf-8")) for lang in LANGS}
    return site, texts


def missing_legal(site):
    return [key for key, value in site["legal"].items() if "TODO" in value.upper()]


def _prepare(out):
    if out.exists():
        if not (out / MARKER).exists():
            raise SystemExit(f"build: {out} exists and was not made by this script; not touching it")
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / MARKER).write_text("")


def _examples(out):
    """Generate the examples into out/examples/fr/, zip them, and return the manifest."""
    with open(os.devnull, "w") as quiet:
        if examples_cli.main(["generate", "--target", "fr", "--out", str(out / "examples")], out=quiet) != 0:
            raise SystemExit("build: invoice-examples failed")
    folder = out / "examples" / "fr"
    with zipfile.ZipFile(out / ZIP_HREF.lstrip("/"), "w") as z:
        for path in sorted(p for p in folder.rglob("*") if p.is_file()):
            info = zipfile.ZipInfo(f"invoice-examples-fr/{path.relative_to(folder).as_posix()}", FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, path.read_bytes())
    return json.loads((folder / "manifest.json").read_text(encoding="utf-8"))


def _static(out):
    shutil.copytree(ROOT / "static", out / "static")
    logo = ROOT / "static" / "logo"
    for src, dst in (
        ("favicon.ico", "favicon.ico"),
        ("favicon.svg", "favicon.svg"),
        ("apple-touch-icon-180.png", "apple-touch-icon.png"),
    ):
        shutil.copyfile(logo / src, out / dst)


def _write(out, path, html):
    target = out / path.lstrip("/") / "index.html" if path.endswith("/") else out / path.lstrip("/")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, encoding="utf-8")


def build(out, strict=False):
    site, texts = load()
    if strict and missing_legal(site):
        raise NotReady("legal notice still marked TODO in site.toml: " + ", ".join(missing_legal(site)))
    out = Path(out)
    _prepare(out)
    _static(out)
    manifest = _examples(out)
    env = Environment(
        loader=FileSystemLoader(ROOT / "templates"),
        autoescape=select_autoescape(),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["links"] = links
    rs = site["rule_sets"]
    common = {
        "site": site,
        "base_url": site["base_url"],
        "rule_chips": [f"EN 16931 {rs['en16931']}", f"Factur-X {rs['facturx']}", f"BR-FR {rs['brfr']}"],
        "sample_output": (ROOT / "content" / "sample-output.txt").read_text(encoding="utf-8").rstrip("\n"),
        "manifest": manifest,
        "valid": next(e for e in manifest["examples"] if e["status"] == "valid"),
        "invalid": [e for e in manifest["examples"] if e["status"] == "invalid"],
        "files_href": FILES_HREF,
        "zip_href": ZIP_HREF,
    }
    for page, paths in PAGES.items():
        for lang in LANGS:
            t, other = texts[lang], next(code for code in LANGS if code != lang)
            p = t[page]
            html = env.get_template(f"{page}.html").render(
                **common,
                t=t,
                p=p,
                path=paths[lang],
                alternates=paths,
                canonical=True,
                page_title=p["title"] if page == "home" else f"{p['title']} · lintvoice",
                links={name: PAGES[name][lang] for name in PAGES},
                other={"lang": other, "href": paths[other]},
                publisher_rows=list(zip(p["publisher_labels"], PUBLISHER_KEYS, strict=True)) if page == "legal" else [],
            )
            _write(out, paths[lang], html)
    en, fr = texts["en"], texts["fr"]
    _write(
        out,
        "/404.html",
        env.get_template("notfound.html").render(
            **common,
            t=en,
            p=en["notfound"],
            path="/404.html",
            alternates={},
            canonical=False,
            page_title=f"{en['notfound']['title']} · lintvoice",
            links={name: PAGES[name]["en"] for name in PAGES},
            other={"lang": "fr", "href": "/fr/"},
            other_texts=fr,
        ),
    )
    _write(out, "/sitemap.xml", _sitemap(site["base_url"]))
    _write(out, "/robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {site['base_url']}/sitemap.xml\n")
    return out


def _sitemap(base):
    rows = []
    for paths in PAGES.values():
        for lang in LANGS:
            alternates = "".join(
                f'<xhtml:link rel="alternate" hreflang="{code}" href="{base}{href}"/>' for code, href in paths.items()
            )
            rows.append(f"<url><loc>{base}{paths[lang]}</loc>{alternates}</url>")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        + "\n".join(rows)
        + "\n</urlset>\n"
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "dist"))
    parser.add_argument("--strict", action="store_true", help="refuse a legal notice still marked TODO")
    args = parser.parse_args(argv)
    try:
        out = build(args.out, strict=args.strict)
    except NotReady as e:
        print(f"build: {e}", file=sys.stderr)
        return 1
    print(f"built {sum(1 for p in out.rglob('*') if p.is_file())} files in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
