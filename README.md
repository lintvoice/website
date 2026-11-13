# lintvoice.com

The website of [lintvoice](https://github.com/lintvoice/lintvoice), which checks e-invoices against official rules and standards. A static site, in English and French:

| Page | English | French |
| --- | --- | --- |
| Home | `/` | `/fr/` |
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

`--strict` refuses a legal notice still marked `TODO` in `site.toml`, so a deployment cannot go out with a gap. The tests run in GitHub Actions (`.github/workflows/ci.yml`).

## Layout

| Path | What |
| --- | --- |
| `build.py` | The whole build: pages, examples, zip, sitemap |
| `templates/` | Jinja templates, code only (no prose) |
| `content/en.toml`, `content/fr.toml` | Every text of the site, one file per language |
| `site.toml` | Base URL, rule set versions, legal notice |
| `wrangler.jsonc` | Cloudflare Workers: where the built site is, the 404 page, and lintvoice.com as its only address |
| `static/` | Styles (`tokens.css`, `components.css`, `site.css`), the IBM Plex fonts and the logo |
| `tests/` | Checks on the built site |

## Principles

- **No third party at runtime:** no external font, script or analytics; no cookie.
- **Accessible by construction:** the text colour pairs in `static/tokens.css` reach 4.5:1, and status is never colour alone.

## Licence

The code is under the MIT licence. The texts (`content/`) and the logo (`static/logo/`) are © AllGood Services SAS, all rights reserved; "lintvoice" is a trademark filed by AllGood Services SAS. The fonts are under the SIL Open Font License 1.1. Details in [LICENSE](LICENSE).
