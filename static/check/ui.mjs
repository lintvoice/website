// The check page: take a file (dropped, chosen, or one of our example invoices), check it in this page with
// engine.mjs, then show the analysis next to a preview of the invoice: what was detected, and for each error the
// values the invoice holds, why they fail, and how to fix them, without leaving the page.
import { check } from "./engine.mjs";
import { errorCard, esc, families, fill, marksOf, note, preview, profile, rulePages, setCurrency, setup } from "./report.mjs";

const T = JSON.parse(document.getElementById("check-texts").textContent);
const lang = document.documentElement.lang;
const page = document.getElementById("check-page");
const result = document.getElementById("result");
const drop = document.getElementById("drop");
const input = document.getElementById("file");
const rulesUsed = document.getElementById("rules-used");
setup(T, lang, page.dataset.base);

function filebar(name, r) {
  const what = r.document ? `${r.document.source.startsWith("PDF") ? "PDF" : "XML"} · ${profile(r.document)}` : "";
  return `<div class="filebar"><p><span class="file">${esc(name)}</span>${what ? `<span class="what">${esc(what)}</span>` : ""}</p>
    <button type="button" class="btn" data-again>${esc(T.again)}</button></div>`;
}

function render(name, r, pages) {
  if (r.status === "unreadable" || r.status === "too-large") {
    const lines = (r.error.match(/^(\d+) lines/) || [])[1];
    const why = fill(T.reasons[r.code] || r.error, { lines, max: 300 });
    return `${filebar(name, r)}<div class="verdict-line ${r.status === "too-large" ? "v-warn" : "v-muted"}"><p><strong>${esc(r.status === "too-large" ? T.verdict_too_large : T.verdict_unreadable)}</strong> · ${esc(why)}</p></div>`;
  }
  const inv = r.values || { terms: {}, schemes: {}, lines: [], notes: [] }; // read by the engine, as lintvoice reads it
  setCurrency(inv.terms["BT-5"]);
  const errors = r.findings.filter((g) => g.severity === "error");
  const warnings = r.findings.filter((g) => g.severity !== "error");
  // each finding gets a number, shown on its card and next to the invoice fields it is about
  const marks = marksOf([...errors, ...warnings], pages);
  // the count of errors as the title, then what the check applied, then one card per error
  const n = r.summary.rules_failed;
  const title = n === 0
    ? `<h2 class="tally v-ok">✓ ${esc(T.verdict_ok)}</h2><p class="ok-text">${esc(T.verdict_ok_text)}</p>`
    : `<h2 class="tally v-err">${esc(fill(n === 1 ? T.verdict_one : T.verdict_many, { n }))}</h2>`;
  const said = r.notes.map(note).filter(Boolean);
  const notRun = r.not_run.length ? `<p class="rules">${esc(T.not_run)} ${r.not_run.map((x) => esc(x.name)).join(", ")}</p>` : "";
  const context = said.length || notRun ? `<div class="context">${said.length ? `<p>${said.map(esc).join(" ")}</p>` : ""}${notRun}</div>` : "";
  // the rule sets and their versions go to the note at the bottom, next to the engine's
  rulesUsed.textContent = fill(T.rules_line, { names: families(r.rule_sets).join(", ") });
  rulesUsed.hidden = false;
  const cards = (list, offset) => `<ol class="errors">${list.map((g, i) => errorCard(g, offset + i + 1, inv, pages, { first: offset + i === 0 })).join("")}</ol>`;
  const warned = warnings.length
    ? `<h2 class="tally v-warn">${esc(fill(warnings.length === 1 ? T.warn_one : T.warn_many, { n: warnings.length }))}</h2>${cards(warnings, errors.length)}`
    : "";
  return `${filebar(name, r)}<div class="analysis">
    <div class="findings-col">${title}${context}${errors.length ? cards(errors, 0) : ""}${warned}</div>
    <div class="preview-col"><h2>${esc(T.detected_title)}</h2><p class="col-sub">${esc(T.detected_sub)}</p>${preview(inv, marks)}</div>
  </div>`;
}

// The file bar and the preview stay in view under the site's top bar: they need its height, and the bar's.
const topbar = document.querySelector(".topbar");
function bars() {
  const fb = result.querySelector(".filebar");
  document.documentElement.style.setProperty("--bar-top", `${topbar.offsetHeight}px`);
  document.documentElement.style.setProperty("--bars", `${topbar.offsetHeight + (fb ? fb.offsetHeight : 0)}px`);
}
new ResizeObserver(bars).observe(topbar);

async function run(name, bytes) {
  page.classList.add("checked", "busy");
  result.innerHTML = `<p class="checking">${esc(T.checking)}</p>`;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); // let "checking" paint first
  const [r, pages] = await Promise.all([check(name, bytes), rulePages()]);
  result.innerHTML = render(name, r, pages);
  bars();
  page.classList.remove("busy");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function fromFile(file) {
  if (file) await run(file.name, new Uint8Array(await file.arrayBuffer()));
}

function reset() {
  page.classList.remove("checked");
  rulesUsed.hidden = true;
  result.innerHTML = "";
  input.value = "";
}

input.addEventListener("change", () => fromFile(input.files[0]));
// a file dropped anywhere on the page is checked, before or after a first check
document.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) drop.classList.remove("over"); });
document.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); fromFile(e.dataTransfer.files[0]); });
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
async function example(path, name) {
  const response = await fetch(`/examples/fr/${path}`);
  if (response.ok) await run(name, new Uint8Array(await response.arrayBuffer()));
}
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => example(b.dataset.example, b.dataset.name)));
result.addEventListener("click", (e) => {
  if (e.target.closest("[data-again]")) { reset(); return; }
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    const said = copy.parentElement.querySelector(".copied");
    navigator.clipboard.writeText(copy.dataset.copy).then(
      () => { said.textContent = copy.dataset.what === "message" ? T.message_copied : T.copied; },
      () => { said.textContent = `${T.copy_failed} ${copy.dataset.copy}`; }, // no clipboard: the address to copy by hand
    );
    return;
  }
  const mark = e.target.closest("[data-mark]");
  if (mark) document.getElementById(`error-${mark.dataset.mark.split(",")[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
});
window.lintvoiceReady = true;
// an address can name one of our failing example invoices, checked on arrival (the home page's « try » line):
// /fr/verifier/?exemple=BR-FR-05-PMD, /check/?example=BR-FR-05-PMD; only a code's letters, digits and hyphens
const asked = new URLSearchParams(location.search).get(page.dataset.exampleParam);
if (asked && /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(asked)) example(`invalid/${asked}.pdf`, `${page.dataset.filePrefix}-${asked}.pdf`);
