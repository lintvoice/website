"""The home page's images, taken from the product itself: the check page's result on an example invoice, the top of
that rule's page, and the example invoice. Run it again whenever the check page, the rule page or the example changes,
so the images stay true to what a visitor gets:

    uv run --frozen python build.py --out /tmp/site
    python3 -m http.server 8000 --bind 127.0.0.1 -d /tmp/site &
    uv run --frozen --group parity --with pillow==12.0.0 --with pypdfium2==5.15.2 \
        python tools/home_images.py /tmp/site http://127.0.0.1:8000 static/home

Writes, for each language (fr, en) and theme (light, dark): check-<lang>-<theme>.webp and rule-<lang>-<theme>.webp;
and invoice.webp, the example invoice cut to its red notice and its totals. The example invoices are fictitious and in
the public domain (CC0), from lintvoice/invoice-examples.
"""

import io
import sys
from pathlib import Path

import pypdfium2
from PIL import Image
from playwright.sync_api import sync_playwright

RULE = "BR-CO-15"
PATHS = {"fr": ("/fr/verifier/", f"/fr/regles/{RULE}/"), "en": ("/check/", f"/rules/{RULE}/")}
WIDTH = 1100  # the site's widest layout (--layout-max)
SHOWN = 1040  # pixels kept: twice the width the home page shows them at


def save(png, path, height=None):
    image = Image.open(io.BytesIO(png)).convert("RGB")
    if height:  # keep the top only
        image = image.crop((0, 0, image.width, min(image.height, height)))
    image.thumbnail((SHOWN, 4 * SHOWN))
    image.save(path, "WEBP", quality=82, method=6)
    print(path, image.size)


def main(site, base, out):
    site, out, base = Path(site), Path(out), base.rstrip("/")
    out.mkdir(parents=True, exist_ok=True)
    example = site / "examples" / "fr" / "invalid" / f"{RULE}.pdf"
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ("light", "dark"):
            context = browser.new_context(
                viewport={"width": WIDTH, "height": 1000}, device_scale_factor=2, color_scheme=theme
            )
            page = context.new_page()
            for lang, (check, rule) in PATHS.items():
                page.goto(f"{base}{check}")
                page.wait_for_load_state("networkidle")
                page.set_input_files("input[type=file]", str(example))
                page.wait_for_selector(".analysis", timeout=60000)
                page.wait_for_load_state("networkidle")
                save(page.locator(".analysis").screenshot(), out / f"check-{lang}-{theme}.webp")
                page.goto(f"{base}{rule}")
                page.wait_for_load_state("networkidle")
                # the header band and the first steps: what the rule page says first
                box = page.locator(".band").first.bounding_box()
                shot = page.screenshot(clip={"x": box["x"], "y": box["y"], "width": box["width"], "height": 700})
                save(shot, out / f"rule-{lang}-{theme}.webp")
            context.close()
        browser.close()
    # the example invoice, from its specimen line and red notice down to its totals, where the wrong amount is in red
    image = pypdfium2.PdfDocument(example)[0].render(scale=2).to_pil().convert("RGB")
    w, h = image.size
    buffer = io.BytesIO()
    image.crop((int(w * 0.06), int(h * 0.018), int(w * 0.94), int(h * 0.605))).save(buffer, "PNG")
    save(buffer.getvalue(), out / "invoice.webp")


if __name__ == "__main__":
    main(*sys.argv[1:4])
