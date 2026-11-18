"""The home page's images, taken from the product itself: the check page's first error card on an example invoice, the
top of that rule's page, and the example invoice. Each is cut to what reads at the size the home page shows it: on a
desktop, the card whole and the rule page's header with its first step; on a phone, their tops only. Run it again
whenever the check page, the rule page or the example changes, so the images stay true to what a visitor gets:

    uv run --frozen python build.py --out /tmp/site
    python3 -m http.server 8000 --bind 127.0.0.1 -d /tmp/site &
    uv run --frozen --group parity --with pillow==12.0.0 --with pypdfium2==5.15.2 \
        python tools/home_images.py /tmp/site http://127.0.0.1:8000 static/home

Writes, for each language (fr, en) and theme (light, dark): card-<lang>-<theme>.webp and card-phone-…, rule-<lang>-…
and rule-phone-…; invoice.webp, the example invoice from its notice down to its totals; and sizes.json, each image's
width and height, which the build gives the page. The example invoices are fictitious and in the public domain (CC0),
from lintvoice/invoice-examples.
"""

import io
import json
import sys
from pathlib import Path

import pypdfium2
from PIL import Image
from playwright.sync_api import sync_playwright

RULE = "BR-CO-15"
PATHS = {"fr": ("/fr/verifier/", f"/fr/regles/{RULE}/"), "en": ("/check/", f"/rules/{RULE}/")}
# the viewports the pictures are taken at, so that their text shows near its own size where the home page puts them
DESKTOP, RULE_WIDTH, PHONE = 1100, 760, 390
SCALE = 2


def save(png, path, sizes, top=None):
    """Save as WebP, keeping the picture's top `top` CSS pixels when given; record its size."""
    image = Image.open(io.BytesIO(png)).convert("RGB")
    if top:
        image = image.crop((0, 0, image.width, min(image.height, int(top * SCALE))))
    image.save(path, "WEBP", quality=82, method=6)
    sizes[path.name] = list(image.size)
    print(path, image.size)


def check(page, base, path, example):
    page.goto(f"{base}{path}")
    page.wait_for_load_state("networkidle")
    page.set_input_files("input[type=file]", str(example))
    page.wait_for_selector(".errors > .card", timeout=60000)
    page.wait_for_load_state("networkidle")
    return page.locator(".errors > .card").first


def main(site, base, out):
    site, out, base = Path(site), Path(out), base.rstrip("/")
    out.mkdir(parents=True, exist_ok=True)
    example = site / "examples" / "fr" / "invalid" / f"{RULE}.pdf"
    sizes = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ("light", "dark"):
            for lang, (check_path, rule_path) in PATHS.items():
                for kind, width in (("", DESKTOP), ("phone-", PHONE)):
                    context = browser.new_context(
                        viewport={"width": width, "height": 1200}, device_scale_factor=SCALE, color_scheme=theme
                    )
                    page = context.new_page()
                    card = check(page, base, check_path, example)
                    # on a phone, the card's top: the code, the title, the rule in plain words, the invoice's values
                    top = None
                    if kind:
                        box, values = card.bounding_box(), card.locator(".in-invoice").bounding_box()
                        top = values["y"] + values["height"] - box["y"] + 16
                    save(card.screenshot(), out / f"card-{kind}{lang}-{theme}.webp", sizes, top)
                    context.close()
                for kind, width in (("", RULE_WIDTH), ("phone-", PHONE)):
                    context = browser.new_context(
                        viewport={"width": width, "height": 1600}, device_scale_factor=SCALE, color_scheme=theme
                    )
                    page = context.new_page()
                    page.goto(f"{base}{rule_path}")
                    page.wait_for_load_state("networkidle")
                    # the header and the first step: what the rule page says first
                    band, first = page.locator(".band").first.bounding_box(), page.locator("#checks").bounding_box()
                    clip = {"x": 0, "y": band["y"], "width": width, "height": first["y"] + first["height"] - band["y"]}
                    save(page.screenshot(clip=clip), out / f"rule-{kind}{lang}-{theme}.webp", sizes)
                    context.close()
        browser.close()
    # the example invoice, from its specimen line and red notice down to its totals, where the wrong amount is in red
    image = pypdfium2.PdfDocument(example)[0].render(scale=2).to_pil().convert("RGB")
    w, h = image.size
    buffer = io.BytesIO()
    image.crop((int(w * 0.06), int(h * 0.018), int(w * 0.94), int(h * 0.605))).save(buffer, "PNG")
    save(buffer.getvalue(), out / "invoice.webp", sizes)
    (out / "sizes.json").write_text(json.dumps(sizes, indent=1, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(*sys.argv[1:4])
