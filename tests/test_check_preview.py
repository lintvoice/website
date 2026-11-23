"""The check page's invoice preview ("What your invoice contains") next to the errors: every failing example of the
gallery marks at least one of its errors in it, every business term a rule page names is read from the invoice and
has a label, and an invoice without errors shows nothing of what only an error brings up. Runs the page's own
report.mjs in Node on the JSON of `lintvoice check`."""

import json
import subprocess
import sys
from importlib.resources import files
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
import build  # noqa: E402 (after the sys.path insert)
import checkassets  # noqa: E402
import rulepages  # noqa: E402
from lintvoice import rulepacks  # noqa: E402

# Business terms that terms.json does not read, and why. A rule page may name them; the check shows no value for them.
NOT_READ = {
    "BT-111": "EN 16931 tells it from BT-110 by its currency (BT-6), which a path in terms.json does not express",
}


@pytest.fixture(scope="session")
def rules():
    """The rule pages, from the pinned commit of the rules repository."""
    return rulepages.load(build.fetch_rules(build.load()[0]["rules_source"]))


@pytest.fixture(scope="session")
def previews(dist, rules, texts, tmp_path_factory):
    """Each example the site serves, checked by lintvoice and shown by report.mjs: the French target's (the gallery's)
    in French, by file name; the European target's (the English rule pages') in English, by en16931/<file name>."""
    tmp = tmp_path_factory.mktemp("preview")
    packs = checkassets.CACHE / "rules"
    for pack in rulepacks.PACKS.values():
        rulepacks.install(pack, packs)
    pages = {r["id"]: {"terms": r["meta"].get("business_terms", [])} for r in rules}
    (tmp / "pages.json").write_text(json.dumps(pages), encoding="utf-8")
    found = {}
    for target, lang, prefix in (("fr", "fr", ""), ("en16931", "en", "en16931/")):
        folder = dist / "examples" / target
        examples = [folder / "valid.xml", *sorted((folder / "invalid").glob("*.xml"))]
        command = [sys.executable, "-m", "lintvoice", "check", "--format", "json", "--rules-dir", str(packs), *examples]
        check = subprocess.run(command, capture_output=True, text=True, check=False)
        (tmp / f"check-{target}.json").write_text(check.stdout, encoding="utf-8")
        (tmp / f"texts-{lang}.json").write_text(json.dumps(texts[lang]["check"]["ui"]), encoding="utf-8")
        args = [tmp / f"texts-{lang}.json", tmp / "pages.json", tmp / f"check-{target}.json", lang]
        command = ["node", ROOT / "tests" / "preview.mjs", *args]
        out = subprocess.run(command, capture_output=True, text=True, check=True)
        found |= {prefix + Path(f["path"]).stem: f for f in json.loads(out.stdout)}
    return found


def test_every_failing_example_marks_one_of_its_errors_in_the_preview(previews):
    failing = {name: f for name, f in previews.items() if f["findings"]}
    # an example whose errors name only data the check does not read (BR-DEC-15: BT-111) cannot mark them
    unread = {
        name
        for name, f in failing.items()
        if all(g["terms"] and set(g["terms"]) <= set(NOT_READ) for g in f["findings"])
    }
    blind = sorted(
        name for name, f in failing.items() if name not in unread and not any(g["marked"] for g in f["findings"])
    )
    assert unread <= {"en16931/BR-DEC-15"}, unread
    assert not blind, f"{len(blind)} of {len(failing)} failing examples mark no error in the preview: {blind}"
    # an error goes unmarked only when it names no data (a syntax rule), or only data the check does not read
    unmarked = [
        (name, g["rule"])
        for name, f in failing.items()
        for g in f["findings"]
        if not g["marked"] and set(g["terms"]) - set(NOT_READ)
    ]
    assert not unmarked, unmarked
    assert "en16931/BR-CO-15" in failing and "BR-CO-15" in failing, "both targets are previewed"


def test_a_missing_note_is_named_in_the_preview(previews, texts):
    html = previews["BR-FR-05-PMD"]["html"]
    assert texts["fr"]["check"]["ui"]["note_missing"] in html
    assert '<li class="bad" data-mark="1"><span class="code">PMD</span>' in html


def test_an_invoice_without_errors_shows_nothing_only_errors_bring_up(previews, texts):
    valid = previews["valid"]
    assert not valid["findings"]
    ui = texts["fr"]["check"]["ui"]
    for key in ("deliver_to", "payee", "references", "allowances_charges", "vat_breakdown", "notes_label", "delivery"):
        assert ui[key] not in valid["html"], key
    assert 'class="sub"' not in valid["html"] and "data-mark" not in valid["html"]


def _read_terms():
    """Every business term terms.json reads: the header's, each group's, the notes' (BT-21, BT-22) and the invoiced
    object identifier (BT-18, a supporting document of type 130)."""
    spec = json.loads(files("lintvoice").joinpath("terms.json").read_text(encoding="utf-8"))
    read = set(spec["header"]) | {"BT-21", "BT-22", "BT-18"}
    for key, group in spec.items():
        if key.endswith("_terms"):
            read |= set(group)
    return read


def test_every_term_a_rule_page_names_is_read_and_labelled(rules, texts):
    read = _read_terms()
    named = {(bt, r["id"]) for r in rules for bt in r["meta"].get("business_terms", [])}
    assert not [(bt, rule) for bt, rule in named if bt not in read and bt not in NOT_READ]
    for lang in build.LANGS:
        labels = texts[lang]["check"]["ui"]["terms"]
        assert not [(bt, rule) for bt, rule in named if bt not in labels], lang
