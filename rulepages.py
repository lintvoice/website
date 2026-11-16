"""Rule pages: one page per rule, in English and French, from a checkout of the lintvoice/invoice-rules repository.

Each rule folder holds meta.yaml (the facts) and en.md / fr.md (the page): a title, one sentence, then the sections
of the rules repository's FORMAT.md, always in the same order. The site keeps the business rules of EN 16931 and of
the French reform (BR-FR); other rule sets wait until lintvoice runs them.
"""

import difflib
import re
from pathlib import Path

import yaml
from markdown_it import MarkdownIt
from markupsafe import Markup

PATHS = {"en": "/rules/", "fr": "/fr/regles/"}
SECTIONS = ("checks", "why", "fix", "causes", "technical", "official", "related")  # FORMAT.md order

_md = MarkdownIt("commonmark")
_RELATED = re.compile(r'<a href="\.\./([A-Z0-9-]+)/">([^<]*)</a>')


def rule_set(rule_id):
    """Which rule set a rule belongs to, from its id: brfr, en16931, or None when the site does not cover it yet."""
    if rule_id.startswith("BR-FR-"):
        return "brfr"
    if rule_id.startswith("BR-DE-"):
        return None  # XRechnung: lintvoice does not run these rules yet
    return "en16931" if rule_id.startswith("BR-") else None


def href(rule_id, lang):
    return f"{PATHS[lang]}{rule_id}/"


def _split(text):
    """# title, the opening paragraph, then the ## sections in file order."""
    lines = text.strip("\n").split("\n")
    if not lines[0].startswith("# "):
        raise ValueError("a rule page starts with '# <title>'")
    title, body = lines[0][2:].strip(), "\n".join(lines[1:])
    parts = re.split(r"(?m)^## (.+)$", body)
    intro, rest = parts[0].strip(), parts[1:]
    sections = [(rest[i].strip(), rest[i + 1].strip()) for i in range(0, len(rest), 2)]
    if len(sections) != len(SECTIONS):
        raise ValueError(f"expected {len(SECTIONS)} sections, found {len(sections)}")
    return title, intro, sections


def _html(markdown, lang, known):
    """Markdown to HTML. Links to a sibling rule (../BR-XX/) point to its page, or become plain text when the site
    has no page for it."""
    html = _md.render(markdown)

    def related(m):
        rule_id, label = m.group(1), m.group(2)
        return f'<a href="{href(rule_id, lang)}">{label}</a>' if rule_id in known else label

    html = _RELATED.sub(related, html)
    html = html.replace("<blockquote>", '<blockquote class="source">')
    return Markup(html)  # noqa: S704 (our own Markdown, from the rules repository)


def load(rules_dir):
    """Every covered rule, sorted by id: meta.yaml plus the parsed page in each language."""
    folders = sorted(p for p in (Path(rules_dir) / "rules").iterdir() if (p / "meta.yaml").is_file())
    metas = {p.name: yaml.safe_load((p / "meta.yaml").read_text(encoding="utf-8")) for p in folders}
    known = {rule_id for rule_id in metas if rule_set(rule_id)}
    rules = []
    for folder in folders:
        rule_id, meta = folder.name, metas[folder.name]
        if rule_id not in known:
            continue
        pages = {}
        for lang in PATHS:
            title, intro, sections = _split((folder / f"{lang}.md").read_text(encoding="utf-8"))
            pages[lang] = {
                "title": title,
                "intro": _html(intro, lang, known),
                "sections": {
                    key: {"heading": heading, "html": _html(text, lang, known)}
                    for key, (heading, text) in zip(SECTIONS, sections, strict=True)
                },
            }
        rules.append({"id": rule_id, "set": rule_set(rule_id), "meta": meta, "pages": pages})
    return rules


def example_file(meta):
    """The failing example's path inside the target's folder (invalid/<name>.xml), or None."""
    invalid = (meta.get("examples") or {}).get("invalid")
    return invalid.split("/", 2)[2] if invalid else None


def example_diff(examples_dir, meta, context=2):
    """The change that makes the example invoice fail the rule, read from the two generated files: lines removed
    from the failing file (del) and added by the fix (add), with a little context. None when there is no example."""
    name = example_file(meta)
    failing = Path(examples_dir) / name if name else None
    if not failing or not failing.is_file():
        return None
    before = failing.read_text(encoding="utf-8").splitlines()
    after = (Path(examples_dir) / "valid.xml").read_text(encoding="utf-8").splitlines()
    lines = []
    for line in difflib.unified_diff(before, after, n=context, lineterm=""):
        if line.startswith(("---", "+++")):
            continue
        if line.startswith("@@"):
            if lines:
                lines.append(("gap", "…"))
            continue
        kind = {"-": "del", "+": "add"}.get(line[0], "ctx")
        lines.append((kind, line[1:]))
    indent = min(
        (len(text) - len(text.lstrip(" ")) for kind, text in lines if kind != "gap" and text.strip()), default=0
    )
    return [(kind, text if kind == "gap" else text[indent:]) for kind, text in lines]
