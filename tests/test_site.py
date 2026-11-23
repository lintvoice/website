"""The built site: every page in both languages, links that resolve, no third-party resource, the gallery
complete, our wording rules, a legal notice that cannot go live with gaps, and the same bytes on every build."""

import hashlib
import json
import re
import sys
import zipfile
from datetime import date, timedelta
from html.parser import HTMLParser
from pathlib import Path
from xml.etree import ElementTree

import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402 (after the sys.path insert)
import checkassets  # noqa: E402
import guides  # noqa: E402
import rulepages  # noqa: E402

EXTERNAL = (
    "https://github.com/",
    "https://pypi.org/",
    "https://annuaire-entreprises.data.gouv.fr/",
    "https://www.cloudflare.com/",
    "https://creativecommons.org/",
    "https://openfontlicense.org/",
    "https://portail.chorus-pro.gouv.fr/",  # AIFE's documents, the sources of a guide
    "https://facturation.chorus-pro.gouv.fr/",  # the French e-invoicing directory
    "https://www.boutique.afnor.org/",  # AFNOR's page for a French standard, a source of a guide
    # the glossary's official sources
    "https://eur-lex.europa.eu/",
    "https://www.legifrance.gouv.fr/",
    "https://fnfe-mpe.org/",
    "https://www.ferd-net.de/",
    "https://ec.europa.eu/",
    "https://peppol.org/",
    "https://docs.peppol.eu/",
    "https://entreprendre.service-public.gouv.fr/",
    "https://bofip.impots.gouv.fr/",
    "https://www.collectivites-locales.gouv.fr/",
    "https://xeinkauf.de/",
    "https://www.insee.fr/",
)
FORBIDDEN = re.compile(r"certif|complian|conform|\bfake|fixture", re.I)  # we help check; we never certify
QUOTED_CODES = ("FACT_NON_CONFORME",)  # Chorus Pro's reason codes, quoted on a guide as they arrive: not our wording


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.lang, self.title, self.description, self.canonical = None, "", None, None
        self.alternates, self.refs, self.text, self.ids = {}, [], [], set()
        self.og = {}
        self._in = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"])
        if tag == "html":
            self.lang = a.get("lang")
        elif tag == "meta" and a.get("name") == "description":
            self.description = a.get("content")
        elif tag == "meta" and a.get("property", "").startswith("og:"):
            self.og[a["property"]] = a["content"]
        elif tag == "link" and a.get("rel") == "canonical":
            self.canonical = a["href"]
        elif tag == "link" and a.get("rel") == "alternate":
            self.alternates[a["hreflang"]] = a["href"]
        elif tag == "link":
            self.refs.append(("resource", a["href"]))
        if tag in ("a",) and a.get("href"):
            self.refs.append(("link", a["href"]))
        if tag in ("img", "script") and a.get("src"):
            self.refs.append(("resource", a["src"]))
        self._in.append(tag)

    def handle_endtag(self, tag):
        if tag in self._in:
            while self._in.pop() != tag:
                pass

    def handle_data(self, data):
        if self._in and self._in[-1] == "title":
            self.title += data
        elif not (self._in and self._in[-1] in ("script", "style")):
            self.text.append(data)


@pytest.fixture(scope="session")
def dist_rules(tmp_path_factory):
    """The site with its rule pages, from the pinned rules commit (fetched once, then reused), without the check page."""
    rules_dir = build.fetch_rules(build.load()[0]["rules_source"])
    return build.build(tmp_path_factory.mktemp("site-rules") / "dist", rules_dir=rules_dir)


def _page(dist, path):
    file = dist / path.lstrip("/") / "index.html" if path.endswith("/") else dist / path.lstrip("/")
    return Page(file.read_text(encoding="utf-8"))


ALL = [(page, lang, path) for page, paths in build.PAGES.items() for lang, path in paths.items()] + [
    (f"guide-{g['key']}", lang, path) for g in guides.load() for lang, path in g["meta"]["paths"].items()
]


@pytest.mark.parametrize("page,lang,path", ALL, ids=[f"{page}-{lang}" for page, lang, _ in ALL])
def test_page_has_language_title_description_and_canonical(dist, page, lang, path):
    p = _page(dist, path)
    assert p.lang == lang
    assert p.title.strip() and "lintvoice" in p.title
    assert p.description and 50 <= len(p.description) <= 200, len(p.description or "")
    assert p.canonical == f"https://lintvoice.com{path}"


@pytest.mark.parametrize("page,lang,path", ALL, ids=[f"{page}-{lang}" for page, lang, _ in ALL])
def test_alternates_name_both_languages_and_exist(dist, page, lang, path):
    p = _page(dist, path)
    assert set(p.alternates) == {"en", "fr", "x-default"}
    for href in p.alternates.values():
        local = href.removeprefix("https://lintvoice.com")
        assert (dist / local.lstrip("/") / "index.html").exists(), href


def test_every_internal_link_and_resource_resolves(dist):
    pages = [path for _, _, path in ALL] + ["/404.html"]
    for path in pages:
        p = _page(dist, path)
        for _kind, href in p.refs:
            if href.startswith(EXTERNAL) or href.startswith(("mailto:", "tel:")):
                continue
            assert href.startswith("/"), f"{path}: {href} is not a local absolute path"
            target, _, anchor = href.partition("#")
            target = target.partition("?")[0]  # a query (a search, a filter) is read by the page's script
            file = dist / target.lstrip("/")
            file = file / "index.html" if target.endswith("/") else file
            assert file.exists(), f"{path}: {href}"
            if anchor and file.suffix == ".html":
                assert anchor in Page(file.read_text(encoding="utf-8")).ids, f"{path}: #{anchor}"


def test_no_third_party_resource_at_runtime(dist):
    for _, _, path in ALL:
        for kind, href in _page(dist, path).refs:
            if kind == "resource":
                assert href.startswith("/"), f"{path} loads {href}"
    css = "".join(f.read_text() for f in (dist / "static").glob("*.css"))
    for ref in re.findall(r"url\(\s*['\"]?([^'\")]+)", css):  # what CSS loads: fonts, images, masks
        assert ref.startswith(("data:", "fonts/", "/")), f"CSS loads {ref}"


def test_gallery_lists_every_example_with_its_files(dist):
    manifest = json.loads((dist / "examples/fr/manifest.json").read_text(encoding="utf-8"))
    invalid = [e for e in manifest["examples"] if e["status"] == "invalid"]
    assert len(manifest["examples"]) == len(invalid) + 1
    for path in ("/examples/", "/fr/exemples/"):
        p = _page(dist, path)
        assert {e["id"] for e in invalid} <= p.ids, "every invalid example has its own row (anchor)"
        links = {href for kind, href in p.refs if kind == "link"}
        for e in manifest["examples"]:
            for f in e["files"].values():
                assert build.FILES_HREF + f in links
                assert (dist / "examples/fr" / f).exists()
        if manifest.get("annotated"):  # the annotated invoice, featured on its own
            assert build.FILES_HREF + manifest["annotated"]["pdf"] in links
    annotated = 1 if manifest.get("annotated") else 0
    # an example that first adds something to the invoice comes with its fixed counterpart (fixed/<id>.xml, .pdf)
    fixed = [f for e in manifest["examples"] for f in (e.get("fixed") or {}).values()]
    for f in fixed:
        assert (dist / "examples/fr" / f).exists()
    with zipfile.ZipFile(dist / build.ZIP_HREF.lstrip("/")) as z:
        assert (
            len(z.namelist()) == 2 * len(manifest["examples"]) + len(fixed) + 1 + annotated
        )  # XML, PDF, the fixed counterparts, the manifest, annotated.pdf


def test_resources_picture_shows_what_the_example_files_hold(dist):
    """The Resources page's picture is drawn from the generated example invoice: its number, seller, SIREN and total,
    and the example that fails because the seller's SIREN is missing."""
    valid = ElementTree.parse(dist / "examples/fr/valid.xml")  # noqa: S314 (a file the build generated)
    number = valid.findtext("rsm:ExchangedDocument/ram:ID", namespaces=build.CII)
    siren = valid.findtext(build.SELLER_SIREN, namespaces=build.CII)
    for path in ("/resources/", "/fr/ressources/"):
        text = " ".join(_page(dist, path).text)
        assert number in text and siren in text and build.DESK_EXAMPLE in text
        assert build._amount(valid.findtext(".//ram:GrandTotalAmount", namespaces=build.CII)) in text
    assert build._amount("1230.00") == "1 230,00 €"
    assert build._amount("7.5") == "7,50 €"


def test_about_shows_the_rule_its_text_names(dist, dist_rules, texts):
    """Beside the why, the rule page for the code the text names, linked; without the rule pages, no picture."""
    rule = build.DESK_EXAMPLE
    for lang, path in build.PAGES["about"].items():
        assert any(rule in para for para in texts[lang]["about"]["why"])
        assert ("link", rulepages.href(rule, lang)) in _page(dist_rules, path).refs
        assert not any(href.endswith(f"/{rule}/") for _, href in _page(dist, path).refs)


def test_wording_never_claims_certification(dist, texts):
    for _page_name, lang, path in ALL:
        text = " ".join(_page(dist, path).text).replace(texts[lang]["footer_disclaimer"], "")
        for code in QUOTED_CODES:
            text = text.replace(code, "")
        found = FORBIDDEN.findall(text)
        assert not found, f"{path}: {found}"


def test_footer_says_we_do_not_certify(dist, texts):
    for _page_name, lang, path in ALL:
        assert texts[lang]["footer_disclaimer"] in " ".join(_page(dist, path).text)


def test_sitemap_and_robots(dist):
    sitemap = (dist / "sitemap.xml").read_text(encoding="utf-8")
    for _, _, path in ALL:
        assert f"<loc>https://lintvoice.com{path}</loc>" in sitemap
    assert "Sitemap: https://lintvoice.com/sitemap.xml" in (dist / "robots.txt").read_text()


def test_sitemap_dates_each_rule_page_by_the_date_it_shows(dist_rules, texts):
    """Search engines trust a lastmod that matches the page: a rule page carries the date its text last changed,
    a guide the date its facts were checked, the one it shows, the same in both languages. The other pages carry
    none."""
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    dates = {}
    for url in ElementTree.parse(dist_rules / "sitemap.xml").getroot().findall("s:url", ns):  # noqa: S314 (our build)
        path = url.findtext("s:loc", namespaces=ns).removeprefix("https://lintvoice.com")
        lastmods = [e.text for e in url.findall("s:lastmod", ns)]
        rule = re.fullmatch(r"(?:/rules|/fr/regles|/guides|/fr/guides)/([^/]+)/", path)
        if not rule:
            assert lastmods == [], path
            continue
        assert len(lastmods) == 1, path
        day = date.fromisoformat(lastmods[0])
        assert day <= date.today() + timedelta(days=1), path  # a day's margin for time zones
        t = texts["fr" if path.startswith("/fr/") else "en"]
        html = (dist_rules / path.lstrip("/") / "index.html").read_text(encoding="utf-8")
        updated = t["guide"]["checked_line"] if "/guides/" in path else t["rule"]["updated_line"]
        assert f'<p class="updated">{updated} {day}</p>' in html, path
        guide = {path: g["key"] for g in guides.load() for path in g["meta"]["paths"].values()}.get(path)
        dates.setdefault(("guide", guide) if guide else ("rule", rule[1]), []).append(day)
    assert dates and all(len(days) == 2 and days[0] == days[1] for days in dates.values())


def test_every_page_carries_its_share_card(dist_rules, texts):
    """A link pasted into a chat or a feed shows the page's own title and description, and the share card of its
    language: 1200x630, the size LinkedIn asks for. Every page of the sitemap, the rule pages included."""
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    urls = [u.findtext("s:loc", namespaces=ns) for u in ElementTree.parse(dist_rules / "sitemap.xml").getroot()]  # noqa: S314
    assert urls
    for url in urls:
        path = url.removeprefix("https://lintvoice.com")
        p = _page(dist_rules, path)
        image = f"https://lintvoice.com/static/social/og-{p.lang}.png"
        assert p.og["og:url"] == p.canonical == url, path
        assert p.og["og:title"] == p.title.strip(), path
        assert p.og["og:description"] == p.description, path
        assert p.og["og:image"] == image, path
        assert p.og["og:image:alt"] == texts[p.lang]["share_image_alt"], path
        assert p.og["og:locale"] == texts[p.lang]["locale"], path
        assert (p.og["og:type"], p.og["og:site_name"]) == ("website", "lintvoice"), path
        png = (dist_rules / image.removeprefix("https://lintvoice.com/")).read_bytes()
        width, height = int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")  # the PNG header
        assert png[:8] == b"\x89PNG\r\n\x1a\n" and (width, height) == (1200, 630), image
        assert (p.og["og:image:width"], p.og["og:image:height"]) == (str(width), str(height)), path


def test_strict_build_refuses_a_legal_notice_with_gaps(tmp_path):
    site, _ = build.load()
    if not build.missing_legal(site):
        pytest.skip("the legal notice is complete")
    with pytest.raises(build.NotReady):
        build.build(tmp_path / "dist", strict=True)


def test_build_refuses_to_wipe_a_folder_it_did_not_make(tmp_path):
    (tmp_path / "keep.txt").write_text("not ours")
    with pytest.raises(SystemExit):
        build.build(tmp_path)
    assert (tmp_path / "keep.txt").exists()


def test_two_builds_give_the_same_bytes(dist, tmp_path):
    again = build.build(tmp_path / "dist")

    def digest(folder):
        return {
            p.relative_to(folder).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*"))
            if p.is_file()
        }

    assert digest(dist) == digest(again)


def test_every_licence_named_on_a_page_links_to_its_text(dist):
    for _, _, path in ALL:
        links = {href for kind, href in _page(dist, path).refs if kind == "link"}
        assert "https://github.com/lintvoice/website/blob/main/LICENSE" in links, path  # the footer
    for path in ("/examples/", "/fr/exemples/", "/legal/", "/fr/mentions-legales/"):
        assert "https://creativecommons.org/publicdomain/zero/1.0/" in {h for k, h in _page(dist, path).refs}, path


def test_text_links_are_escaped_and_only_https_or_local():
    assert (
        str(build.links("a <b> [x](https://e.org/) [y](javascript:alert(1))"))
        == 'a &lt;b&gt; <a href="https://e.org/">x</a> [y](javascript:alert(1))'
    )


def test_strict_mode_spots_any_todo_left_in_the_legal_notice():
    """Kept even once the legal notice is complete: the guard itself stays tested."""
    site = {"legal": {"phone": "TODO", "legal_form": "SAS au capital de TODO €", "address": "5 rue X, 74000 Annecy"}}
    assert build.missing_legal(site) == ["phone", "legal_form"]


def test_external_links_carry_the_external_mark(dist):
    css = (dist / "static/site.css").read_text()
    assert 'a[href^="https://"]::after' in css and "mask:url(" in css
    for _, _, path in ALL:  # and every link to another site is an absolute https URL, so the rule reaches it
        for kind, href in _page(dist, path).refs:
            if kind == "link" and not href.startswith(("/", "mailto:", "tel:")):
                assert href.startswith("https://"), f"{path}: {href}"


def test_the_check_page_asks_only_for_rule_files_the_build_compiles():
    """engine.mjs names the compiled rule files it loads; checkassets.py compiles exactly those."""
    engine = (ROOT / "static/check/engine.mjs").read_text(encoding="utf-8")
    asked = set(re.findall(r'sef: "([a-z0-9-]+)"', engine))
    asked |= {f"facturx-{p}" for p in ("basicwl", "en16931", "extended")}  # sef: `facturx-${d.profile}`
    assert asked == set(checkassets.STYLESHEETS)
