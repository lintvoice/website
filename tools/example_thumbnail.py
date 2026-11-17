"""The example invoice thumbnail of the rules index: the page of an invalid example invoice, cut to its red notice and
its totals, where the wrong amount shows in red. Run it again when the example changes:

    uv run --no-project --with pypdfium2==5.15.2 --with pillow==12.0.0 python tools/example_thumbnail.py \
        ../invoice-examples/examples/fr/invalid/BR-CO-15.pdf static/rules/example-invoice.png

The example invoices are in the public domain (CC0), from lintvoice/invoice-examples.
"""

import sys

import pypdfium2
from PIL import Image

pdf, out = sys.argv[1], sys.argv[2]
page = pypdfium2.PdfDocument(pdf)[0]
image = page.render(scale=2).to_pil().convert("RGB")
w, h = image.size
# fractions of the A4 page: the notice band under the header, then the lines and totals block
notice = image.crop((int(w * 0.06), int(h * 0.055), int(w * 0.94), int(h * 0.105)))
totals = image.crop((int(w * 0.06), int(h * 0.385), int(w * 0.94), int(h * 0.605)))
gap = 24
sheet = Image.new("RGB", (notice.width, notice.height + gap + totals.height), "white")
sheet.paste(notice, (0, 0))
sheet.paste(totals, (0, notice.height + gap))
sheet.thumbnail((720, 720))
sheet.save(out, optimize=True)
print(out, sheet.size)
