"""Build lintvoice.com into a folder of static files.

    uv run python build.py                 # into dist/
    uv run python build.py --strict        # the same, but refuses a legal notice still marked TODO
    uv run python build.py --rules ../invoice-rules  # the rule pages from a local checkout, instead of the pinned commit
    uv run python build.py --no-check      # without the in-browser check page, which needs Node to build
    python -m http.server -d dist 8000     # preview at http://localhost:8000

Pages come from templates/ and the texts in content/{en,fr}.toml. The examples gallery runs the
invoice-examples generator at the version this project pins, so the files served are the ones its tests check.
The rule pages come from the lintvoice/invoice-rules repository at the commit pinned in site.toml, fetched with git.
The check page runs the rule files of the lintvoice version this project pins, compiled for the browser (checkassets.py).
The guides come from guides/, one folder each (guides.py).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
import zipfile
from pathlib import Path

import checkassets
import guides
import rulepages
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


ICONS = ROOT / "static" / "icons"  # Carbon icons (IBM), Apache-2.0: the licence is published next to them


def icon(name):
    """An icon inlined in the page, next to its words: it takes the text's colour and says nothing to screen readers."""
    svg = (ICONS / f"{name}.svg").read_text(encoding="utf-8").strip()
    attrs = 'class="ic" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"'
    return Markup(svg.replace("<svg ", f"<svg {attrs} ", 1))  # noqa: S704 (our own files)


PLACEHOLDER = re.compile(r"\{(\w+)\}")


def fill(text, values):
    """A text's {placeholders} filled with what the build knows (counts, rule versions), then its links."""
    return links(PLACEHOLDER.sub(lambda m: str(values[m.group(1)]), text))


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


# French puts a space before ? ! : ; » € % and after «. An ordinary space lets the line break there, so a "?" starts a
# line or a "«" ends one: on French pages it becomes a no-break space, in the text only (never inside a tag, code, a
# script, a style or the title, which share cards repeat).
FR_SKIP = re.compile(r"<(script|style|pre|code|textarea|title)\b.*?</\1>|<[^>]+>", re.S | re.I)
FR_SPACE = re.compile(r" (?=[?!:;»€%])|(?<=«) ")


def french_spaces(html):
    parts, pos = [], 0
    for m in FR_SKIP.finditer(html):
        parts += [FR_SPACE.sub("\u00a0", html[pos : m.start()]), m.group(0)]
        pos = m.end()
    parts.append(FR_SPACE.sub("\u00a0", html[pos:]))
    return "".join(parts)


def _fr_strings(value):
    """The check's texts, which the page writes itself: the same no-break spaces."""
    if isinstance(value, dict):
        return {k: _fr_strings(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_fr_strings(v) for v in value]
    return FR_SPACE.sub("\u00a0", value) if isinstance(value, str) else value


def _write(out, path, html):
    if html.lstrip().lower().startswith("<!doctype html>") and '<html lang="fr"' in html[:200]:
        html = french_spaces(html)
    target = out / path.lstrip("/") / "index.html" if path.endswith("/") else out / path.lstrip("/")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(html, encoding="utf-8")


CHECK_PATHS = {"en": "/check/", "fr": "/fr/verifier/"}


def _check_assets(out, source, rules):
    """The in-browser check: its compiled rule files, schemas and runtimes (vendor/, sef/, xsd/ under source), their
    licences (licenses/, NOTICES.txt), and
    for each rule page its title, "in short" and address, so that an error leads to its page."""
    for folder in ("vendor", "sef", "xsd", "licenses"):
        shutil.copytree(Path(source) / folder, out / "static" / "check" / folder)
    shutil.copy(Path(source) / "NOTICES.txt", out / "static" / "check")
    shutil.copy(Path(source) / "terms.json", out / "static" / "check")
    index = {
        r["id"]: {
            "title": {lang: r["pages"][lang]["title"] for lang in LANGS},
            "brief": {lang: r["meta"]["brief"][lang] for lang in LANGS},
            "href": {lang: rulepages.href(r["id"], lang) for lang in LANGS},
            "terms": r["meta"].get("business_terms", []),
            "topic": r["meta"].get("topic"),
            # the page's own explanations, shown under the error on the check page itself
            "sections": {
                lang: {
                    key: str(r["pages"][lang]["sections"][key]["html"]) for key in ("checks", "causes", "fix", "why")
                }
                for lang in LANGS
            },
            "headings": {
                lang: {key: r["pages"][lang]["sections"][key]["heading"] for key in ("checks", "causes", "fix", "why")}
                for lang in LANGS
            },
        }
        for r in rules
    }
    (out / "static" / "check" / "rules.json").write_text(
        json.dumps(index, ensure_ascii=False, sort_keys=True), encoding="utf-8"
    )
    # each rule page's own check: the ids the rule is reported under and, in each compiled rule file, the contexts
    # they fire on, so that the page can tell a rule that applies to an invoice from one that does not
    rule_contexts = json.loads((Path(source) / "contexts.json").read_text(encoding="utf-8"))
    for r in rules:
        ids = sorted({r["id"], *r["meta"].get("reported_ids", [])})
        r["check"] = {
            "ids": ids,
            "contexts": {
                name: sorted({c for i in ids for c in found.get(i, [])})
                for name, found in rule_contexts.items()
                if any(i in found for i in ids)
            },
        }


def build(out, strict=False, rules_dir=None, check_assets=None):
    site, texts = load()
    rules = rulepages.load(rules_dir) if rules_dir else []
    pages = dict(PAGES, rules=rulepages.PATHS) if rules else dict(PAGES)
    if check_assets:
        pages["check"] = CHECK_PATHS
    if strict and missing_legal(site):
        raise NotReady("legal notice still marked TODO in site.toml: " + ", ".join(missing_legal(site)))
    out = Path(out)
    _prepare(out)
    _static(out)
    if check_assets:
        _check_assets(out, check_assets, rules)
        # each subject's name and icon, for the subject an error card names
        subjects = {
            key: {"name": {lang: texts[lang]["rules"]["topics"][key] for lang in LANGS}, "icon": str(icon(name))}
            for key, name in rulepages.TOPIC_ICONS.items()
        }
        (out / "static" / "check" / "subjects.json").write_text(
            json.dumps(subjects, ensure_ascii=False, sort_keys=True), encoding="utf-8"
        )
        for lang in LANGS:  # the check's texts, which a rule page loads only when it checks a file
            ui = texts[lang]["check"]["ui"]
            (out / "static" / "check" / f"texts.{lang}.json").write_text(
                json.dumps(_fr_strings(ui) if lang == "fr" else ui, ensure_ascii=False, sort_keys=True),
                encoding="utf-8",
            )
    manifest = _examples(out)
    env = Environment(
        loader=FileSystemLoader(ROOT / "templates"),
        autoescape=select_autoescape(),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["links"] = links
    env.filters["fill"] = fill
    env.globals["icon"] = icon
    env.globals["topic_icons"] = rulepages.TOPIC_ICONS
    # the home page's picture of the example invoice (tools/example_pictures.py)
    sizes = ROOT / "static" / "home" / "sizes.json"
    env.globals["home_sizes"] = json.loads(sizes.read_text(encoding="utf-8")) if sizes.is_file() else {}
    env.globals["rule_href"] = rulepages.href
    rs = site["rule_sets"]
    common = {
        "site": site,
        "base_url": site["base_url"],
        "rule_chips": [f"EN 16931 {rs['en16931']}", f"Factur-X {rs['facturx']}", f"BR-FR {rs['brfr']}"],
        "manifest": manifest,
        "valid": next(e for e in manifest["examples"] if e["status"] == "valid"),
        "invalid": [e for e in manifest["examples"] if e["status"] == "invalid"],
        "files_href": FILES_HREF,
        "zip_href": ZIP_HREF,
        "rules": rules,
    }
    if rules:
        rs = site["rule_sets"]
        found = rulepages.inventory(rules_dir, checkassets.CACHE / "rules", out / "examples" / "fr" / "manifest.json")
        data = rulepages.index(rules, found, {"en16931": f"EN 16931 {rs['en16931']}", "brfr": f"BR-FR {rs['brfr']}"})
        (out / "static" / "rules").mkdir(parents=True, exist_ok=True)
        (out / "static" / "rules" / "index.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        common["rules_index"] = {
            "explained": len(data["explained"]),
            "total": len(data["explained"]) + len(data["others"]),
            "topics": [(key, [r for r in rules if r["meta"]["topic"] == key]) for key in rulepages.TOPICS],
            "ids": {r["id"] for r in rules},
            "complete": bool(found),  # every rule of the official files is in the index, not only the explained ones
        }
    # the counts a page's description or brief may carry come from the build, never typed into a text
    counts = {"invoices": len(manifest["examples"]), "examples": len(common["invalid"])}
    for page, paths in pages.items():
        for lang in LANGS:
            t, other = texts[lang], next(code for code in LANGS if code != lang)
            p = {**t[page], **{key: fill(t[page][key], counts) for key in ("description", "brief") if key in t[page]}}
            html = env.get_template(f"{page}.html").render(
                **common,
                t=t,
                p=p,
                path=paths[lang],
                alternates=paths,
                canonical=True,
                page_title=p["title"]
                if page == "home"
                else f"{p['title']} | lintvoice"
                if page == "rules"
                else f"{p['title']} · lintvoice",
                links={name: pages[name][lang] for name in pages},
                other={"lang": other, "href": paths[other]},
                publisher_rows=list(zip(p["publisher_labels"], PUBLISHER_KEYS, strict=True)) if page == "legal" else [],
            )
            _write(out, paths[lang], html)
    for rule in rules:
        rule["diff"] = rulepages.example_diff(out / "examples" / "fr", rule["meta"])
        rule["example"] = rulepages.example_file(rule["meta"])
        rule["valid"] = rulepages.example_valid(rule["meta"])
        paths = {lang: rulepages.href(rule["id"], lang) for lang in LANGS}
        for lang in LANGS:
            t, other = texts[lang], next(code for code in LANGS if code != lang)
            r = rule["pages"][lang]
            html = env.get_template("rule.html").render(
                **common,
                t=t,
                p={"description": rule["meta"]["brief"][lang]},
                rule=rule,
                path=paths[lang],
                alternates=paths,
                canonical=True,
                page_title=f"{r['title']} ({rule['id']}) · {t['rule']['title_suffix']} | lintvoice",
                links={name: pages[name][lang] for name in pages},
                other={"lang": other, "href": paths[other]},
            )
            _write(out, paths[lang], html)
    known = {path for paths in pages.values() for path in paths.values()}
    known |= {rulepages.href(r["id"], lang) for r in rules for lang in LANGS}
    for guide in guides.load():
        paths = guide["meta"]["paths"]
        for lang in LANGS:
            t, other = texts[lang], next(code for code in LANGS if code != lang)
            g = guide["pages"][lang]
            html = env.get_template("guide.html").render(
                **common,
                t=t,
                p={"description": guide["meta"]["description"][lang]},
                guide={
                    "title": g["title"],
                    "brief": guides.inline(g["brief"]),
                    "body": guides.html(g["body"], known),
                    "checked": guide["meta"]["checked"],
                },
                path=paths[lang],
                alternates=paths,
                canonical=True,
                page_title=f"{g['title']} · lintvoice",
                links={name: pages[name][lang] for name in pages},
                other={"lang": other, "href": paths[other]},
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
            links={name: pages[name]["en"] for name in pages},
            other={"lang": "fr", "href": "/fr/"},
            other_texts=fr,
        ),
    )
    # a rule page is dated by the day its text last changed, a guide by the day its facts were checked, the dates
    # they show; the other pages carry no date
    all_paths = (
        [(paths, None) for paths in pages.values()]
        + [({lang: rulepages.href(r["id"], lang) for lang in LANGS}, str(r["meta"]["updated"])) for r in rules]
        + [(g["meta"]["paths"], str(g["meta"]["checked"])) for g in guides.load()]
    )
    _write(out, "/sitemap.xml", _sitemap(site["base_url"], all_paths))
    _write(out, "/robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {site['base_url']}/sitemap.xml\n")
    return out


def _sitemap(base, all_paths):
    rows = []
    for paths, updated in all_paths:
        lastmod = f"<lastmod>{updated}</lastmod>" if updated else ""
        for lang in LANGS:
            alternates = "".join(
                f'<xhtml:link rel="alternate" hreflang="{code}" href="{base}{href}"/>' for code, href in paths.items()
            )
            rows.append(f"<url><loc>{base}{paths[lang]}</loc>{lastmod}{alternates}</url>")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        + "\n".join(rows)
        + "\n</urlset>\n"
    )


def fetch_rules(source, cache=ROOT / ".rules-src"):
    """Check out the pinned commit of the rules repository (once; later builds reuse it) and return its folder."""
    commit = source["commit"]
    folder = cache / commit
    if not (folder / "rules").is_dir():
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True)
        for args in (
            ["init", "-q"],
            ["fetch", "-q", "--depth", "1", source["repo"], commit],
            ["checkout", "-q", "FETCH_HEAD"],
        ):
            subprocess.run(["git", *args], cwd=folder, check=True)  # noqa: S603, S607 (git, with our pinned values)
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=folder, check=True, capture_output=True, text=True)  # noqa: S607
    if head.stdout.strip() != commit:
        raise SystemExit(f"build: {folder} is not at the pinned rules commit {commit}")
    return folder


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "dist"))
    parser.add_argument("--strict", action="store_true", help="refuse a legal notice still marked TODO")
    parser.add_argument("--rules", help="a local checkout of the rules repository, instead of the pinned commit")
    parser.add_argument(
        "--check-assets",
        help="the in-browser check's compiled rules, schemas and runtimes (vendor/, sef/, xsd/), instead of building them",
    )
    parser.add_argument("--no-check", action="store_true", help="leave out the in-browser check page (no Node needed)")
    args = parser.parse_args(argv)
    try:
        rules_dir = args.rules or fetch_rules(load()[0]["rules_source"])
        check_assets = None if args.no_check else args.check_assets or checkassets.build()
        out = build(args.out, strict=args.strict, rules_dir=rules_dir, check_assets=check_assets)
    except NotReady as e:
        print(f"build: {e}", file=sys.stderr)
        return 1
    print(f"built {sum(1 for p in out.rglob('*') if p.is_file())} files in {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
