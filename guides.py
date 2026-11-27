"""Guides: pages that explain one situation from start to finish, in both languages.

Each guide is a folder in guides/: meta.yaml gives its path and description in each language and the day its facts
were last checked; {en,fr}.md hold the page itself: '# <title>', an opening paragraph, then Markdown (tables allowed).
"""

import re
from pathlib import Path

import yaml
from markdown_it import MarkdownIt
from markupsafe import Markup

FOLDER = Path(__file__).parent / "guides"

# Markdown only: raw HTML in a guide would show as text.
_md = MarkdownIt("commonmark", {"html": False}).enable("table")
_LOCAL = re.compile(r'<a href="(/[^"#]*)(#[^"]*)?">(.*?)</a>')


def html(markdown, known):
    """Markdown to HTML. A link to one of our pages stays a link only when the build has that page (`known`, a set of
    paths); a wide table scrolls inside its own box on a small screen."""
    out = _md.render(markdown)
    out = _LOCAL.sub(lambda m: m.group(0) if m.group(1) in known else m.group(3), out)
    out = out.replace("<table>", '<div class="table-wrap"><table>').replace("</table>", "</table></div>")
    return Markup(out)  # noqa: S704 (our own Markdown, from this repository)


def inline(markdown):
    return Markup(_md.renderInline(markdown))  # noqa: S704 (our own Markdown, from this repository)


def _split(text):
    """# title, the opening paragraph, then the rest."""
    lines = text.strip("\n").split("\n")
    if not lines[0].startswith("# "):
        raise ValueError("a guide starts with '# <title>'")
    brief, _, body = "\n".join(lines[1:]).strip().partition("\n\n")
    return lines[0][2:].strip(), brief, body


def load(folder=FOLDER):
    """Every guide, sorted by folder name: its meta.yaml plus its page in each language, as Markdown."""
    guides = []
    for meta_file in sorted(Path(folder).glob("*/meta.yaml")):
        meta = yaml.safe_load(meta_file.read_text(encoding="utf-8"))
        pages = {}
        for lang in meta["paths"]:
            title, brief, body = _split((meta_file.parent / f"{lang}.md").read_text(encoding="utf-8"))
            pages[lang] = {"title": title, "brief": brief, "body": body}
        guides.append({"key": meta_file.parent.name, "meta": meta, "pages": pages})
    return guides
