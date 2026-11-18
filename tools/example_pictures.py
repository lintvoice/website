"""The pictures of the example invoice that fails BR-CO-15, a paper sheet: the rules index's thumbnail, cut to its red
notice and its totals, and the home page's sheet, from its specimen line and red notice down to its totals, where the
wrong amount shows in red. Run it again when the example changes:

    uv run --frozen python build.py --no-check --out /tmp/site
    uv run --no-project --with pypdfium2==5.15.2 --with pillow==12.0.0 python tools/example_pictures.py \
        /tmp/site/examples/fr/invalid/BR-CO-15.pdf static

Writes static/rules/example-invoice.png, static/home/invoice.webp and static/home/sizes.json (the home picture's
width and height, which the build gives the page). The example invoices are fictitious and in the public domain
(CC0), from lintvoice/invoice-examples.
"""

import json
import sys
from pathlib import Path

import pypdfium2
from PIL import Image

pdf, static = sys.argv[1], Path(sys.argv[2])
image = pypdfium2.PdfDocument(pdf)[0].render(scale=2).to_pil().convert("RGB")
w, h = image.size


def cut(left, top, right, bottom):
    """A part of the A4 page, in fractions of its width and height."""
    return image.crop((int(w * left), int(h * top), int(w * right), int(h * bottom)))


# the rules index: the notice band under the header, then the lines and totals block
notice, totals = cut(0.06, 0.055, 0.94, 0.105), cut(0.06, 0.385, 0.94, 0.605)
gap = 24
sheet = Image.new("RGB", (notice.width, notice.height + gap + totals.height), "white")
sheet.paste(notice, (0, 0))
sheet.paste(totals, (0, notice.height + gap))
sheet.thumbnail((720, 720))
sheet.save(static / "rules" / "example-invoice.png", optimize=True)
print(static / "rules" / "example-invoice.png", sheet.size)

# the home page: the page from its specimen line down to its totals
home = cut(0.06, 0.018, 0.94, 0.605)
home.save(static / "home" / "invoice.webp", "WEBP", quality=82, method=6)
sizes = {"invoice.webp": list(home.size)}
(static / "home" / "sizes.json").write_text(json.dumps(sizes, indent=1, sort_keys=True) + "\n", encoding="utf-8")
print(static / "home" / "invoice.webp", home.size)
