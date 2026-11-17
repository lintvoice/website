"""Rule pages: one page per rule, in English and French, from a checkout of the lintvoice/invoice-rules repository.

Each rule folder holds meta.yaml (the facts) and en.md / fr.md (the page): a title, one sentence, then the sections
of the rules repository's FORMAT.md, always in the same order. The site keeps the business rules of EN 16931 and of
the French reform (BR-FR); other rule sets wait until lintvoice runs them.
"""

import difflib
import json
import re
import subprocess
import sys
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


def example_valid(meta):
    """The passing counterpart's path inside the target's folder: valid.xml, or the same invoice without the
    mistake (fixed/<name>.xml) when the failing example first adds something to the invoice."""
    valid = (meta.get("examples") or {}).get("valid") or "examples/fr/valid.xml"
    return valid.split("/", 2)[2]


def example_diff(examples_dir, meta, context=2):
    """The change that makes the example invoice fail the rule, read from the two generated files: lines removed
    from the failing file (del) and added by the fix (add), with a little context. None when there is no example."""
    name = example_file(meta)
    failing = Path(examples_dir) / name if name else None
    if not failing or not failing.is_file():
        return None
    before = failing.read_text(encoding="utf-8").splitlines()
    after = (Path(examples_dir) / example_valid(meta)).read_text(encoding="utf-8").splitlines()
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


# What a rule is about on the invoice (meta.yaml's topic, invoice-rules FORMAT.md), in the order the rules index shows.
TOPICS = ("addresses", "identifiers", "payment", "totals", "vat", "invoice", "lines", "corrections", "attachments")
# each subject's icon (static/icons/), the same on the home page, the rules index, the rule pages and the check page
TOPIC_ICONS = {
    "addresses": "email",
    "identifiers": "identification",
    "payment": "wallet",
    "totals": "calculator",
    "vat": "percentage",
    "invoice": "calendar",
    "lines": "list--bulleted",
    "corrections": "document--subtract",
    "attachments": "attachment",
}


def origin(rule_id):
    """fr for the French reform's rules (BR-FR), eu for the European standard's."""
    return "fr" if rule_id.startswith("BR-FR") else "eu"


def inventory(rules_dir, rules_cache, manifest):
    """Every business rule the official rule files hold (the rules repository's tools/inventory.py), or [] when the
    rule packs are not at hand (a build without the check page)."""
    script = Path(rules_dir) / "tools" / "inventory.py"
    if not (script.is_file() and Path(rules_cache).is_dir() and Path(manifest).is_file()):
        return []
    run = subprocess.run(  # noqa: S603 (the pinned rules repository's own script)
        [sys.executable, str(script), str(rules_cache), str(manifest)], check=True, capture_output=True, text=True
    )
    return json.loads(run.stdout)


def _message(entry):
    """One official message for a rule without a page: the first, without its "[ID]-" prefix."""
    text = sorted(entry["messages"])[0]
    return re.sub(r"^\[[^\]]+\]\s*-\s*", "", text)


def index(rules, found, versions):
    """The rules index's data: every rule with a page (title, brief, topic, search words, ids), then every other rule
    of the official files with its official message, so that any code can be found."""
    explained = []
    for r in rules:
        m = r["meta"]
        explained.append(
            {
                "id": r["id"],
                "title": {lang: r["pages"][lang]["title"] for lang in PATHS},
                "brief": m.get("brief", {}),
                "topic": m["topic"],
                "origin": origin(r["id"]),
                "example": bool((m.get("examples") or {}).get("invalid")),
                "href": {lang: href(r["id"], lang) for lang in PATHS},
                "words": {lang: " ".join(m["search"][lang][1:]) for lang in PATHS},
                "bt": m.get("business_terms", []),
                "ids": m.get("reported_ids", []),
            }
        )
    # a page covers its own id and every id it is reported under (BR-FR-32 covers BR-FR-32-GLOBALID and others)
    known = {e["id"] for e in explained} | {i for e in explained for i in e["ids"]}
    others = [
        {
            "id": e["id"],
            "origin": origin(e["id"]),
            "message": _message(e),
            "lang": "fr" if e["set"] == "brfr" else "en",
            "source": versions[e["set"]],
            "ids": sorted(e["asserts"]),
        }
        for e in found
        if e["id"] not in known and not set(e["asserts"]) & known and rule_set(e["id"])
    ]
    return {"explained": explained, "others": sorted(others, key=lambda e: e["id"])}
