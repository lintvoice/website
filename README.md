# lintvoice.com

The website of [lintvoice](https://github.com/lintvoice/lintvoice), which checks e-invoices against official rules and standards. A static site, in English and French:

| Page | English | French |
| --- | --- | --- |
| Home | `/` | `/fr/` |
| Invoicing rules (index, then one page per rule) | `/rules/`, `/rules/<RULE-ID>/` | `/fr/regles/`, `/fr/regles/<RULE-ID>/` |
| Example invoices | `/examples/` | `/fr/exemples/` |
| Legal notice | `/legal/` | `/fr/mentions-legales/` |

The examples gallery runs the [invoice-examples](https://github.com/lintvoice/invoice-examples) generator at the version this project pins, so the files served are the ones its tests check against the official rules.

## Build and preview

```sh
uv run python build.py                 # into dist/
python3 -m http.server -d dist 8000    # http://localhost:8000
uv run pytest                          # links, languages, gallery, wording, reproducible build
```

## Deployment

Cloudflare Workers builds and deploys this repo on every push to `main`, through its Git integration (Workers Builds, set up in the Cloudflare dashboard). The site is served as static assets: `wrangler.jsonc` points to `dist/`, and `dist/404.html` answers unknown paths.

| Setting | Value |
| --- | --- |
| Build command | `pip install uv==0.13.5 && uv run --frozen python build.py --strict` |
| Deploy command | `npx wrangler deploy` (Cloudflare's default) |
| Build variable | `PYTHON_VERSION=3.13` |
| Non-production branch builds | Off: only `main` is built and deployed; GitHub Actions tests the other branches |

`--strict` refuses a legal notice still marked `TODO` in `site.toml`, so a deployment cannot go out with a gap. The build also compiles the check page's rule files with Node (`npm ci` from `package-lock.json`); `--no-check` leaves that page out. The tests run in GitHub Actions (`.github/workflows/ci.yml`).

## Layout

| Path | What |
| --- | --- |
| `build.py` | The whole build: pages, examples, zip, sitemap |
| `checkassets.py`, `package.json` | The check page's files, built at each deployment: the rule files of the pinned lintvoice version compiled for the browser (xslt3, Node), the schemas, SaxonJS, pdf.js and xmllint-wasm, with their licences (`/static/check/NOTICES.txt`) |
| `rulepages.py` | The rule pages, read from the [lintvoice/invoice-rules](https://github.com/lintvoice/invoice-rules) repository at the commit pinned in `site.toml` |
| `templates/` | Jinja templates, code only (no prose) |
| `content/en.toml`, `content/fr.toml` | Every text of the site, one file per language |
| `site.toml` | Base URL, rule set versions, the pinned rules commit, legal notice |
| `wrangler.jsonc` | Cloudflare Workers: where the built site is, the 404 page, and lintvoice.com as its only address |
| `static/` | Styles (`tokens.css`, `components.css`, `site.css`), the IBM Plex fonts, the logo, 13 Carbon icons (`@carbon/icons` 11.92.0, IBM, Apache-2.0, inlined in the pages at build, `static/icons/`), and the images of the home page and the rules index (captures of the site's own pages, example invoices) |
| `tests/` | Checks on the built site |
| `tools/parity.py` | The check page against the lintvoice command-line tool: the same findings on every file of its set (official examples, the gallery's invoices, crafted and hostile files), in Chromium, WebKit and Firefox; run in CI |
| `tools/home_images.py`, `tools/example_thumbnail.py` | The images of the home page and the rules index, taken from the site's own pages and the example invoices; run again when those pages or the examples change |

## Principles

- **No third party at runtime:** no external font, script or analytics; no cookie.
- **Accessible by construction:** the text colour pairs in `static/tokens.css` reach 4.5:1, and status is never colour alone.

## Licence

The code is under the MIT licence. The rule pages' text comes from lintvoice/invoice-rules, under CC BY-SA 4.0. The site's own texts (`content/`) and the logo (`static/logo/`) are © AllGood Services SAS, all rights reserved; "lintvoice" is a trademark filed by AllGood Services SAS. The fonts are under the SIL Open Font License 1.1. The icons are IBM's Carbon icons, under the Apache License 2.0 (`static/icons/`). Details in [LICENSE](LICENSE).
