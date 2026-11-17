// A rule page's own check: the visitor's invoice against the rule they came for. The full official rule sets run, as
// on the check page, so the answer is the official one; the page shows this rule's answer first (fails, no error
// found, does not apply, could not be checked), then one line on the rest, which opens every other error in place.
// Nothing of the check loads until a file is picked, and nothing is sent: the invoice is read and checked here.
//
// "Does not apply" comes from the official files themselves: they report each rule context that fired, and the build
// gives this page the contexts of its rule (contexts.json, from the compiled rule files).

const box = document.getElementById("rule-check");
const D = JSON.parse(document.getElementById("rule-check-data").textContent);
const W = D.texts;
const lang = document.documentElement.lang;
const out = box.querySelector(".rule-check-result");
const input = document.getElementById("rule-file");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

// SaxonJS (a classic script), the engine, the display and the check's texts: once, on the first file.
let tools;
let copyTexts = {}; // the check's "copied" texts, once loaded
function saxon() {
  return new Promise((ok, ko) => {
    if (window.SaxonJS) return ok();
    const s = document.createElement("script");
    s.src = "/static/check/vendor/SaxonJS2.rt.js";
    s.onload = ok;
    s.onerror = ko;
    document.head.append(s);
  });
}
function load() {
  tools ??= (async () => {
    await saxon();
    const [engine, report, T] = await Promise.all([
      import("./engine.mjs"),
      import("./report.mjs"),
      fetch(`/static/check/texts.${lang}.json`).then((r) => r.json()),
    ]);
    report.setup(T, lang, D.base);
    return { engine, report, T };
  })();
  tools.catch(() => { tools = undefined; }); // a failed download is tried again on the next file
  return tools;
}

const mine = (g) => D.ids.includes(g.rule);
const SYNTAX = (sef) => (sef.endsWith("-ubl") ? "UBL" : "CII");

// Why the rule does not apply, in the visitor's words.
function reason(r, report) {
  const own = Object.keys(D.contexts);
  const ran = own.filter((s) => s in r.fired);
  if (!ran.length) {
    if (r.notes.some((n) => /^BR-FR rules not applied/.test(n)) && own.every((s) => /^(br-fr|extended-ctc-fr)/.test(s))) return W.reason_brfr;
    const syntaxes = [...new Set(own.map(SYNTAX))];
    if (!syntaxes.includes(r.document.syntax)) return fill(W.reason_syntax, { theirs: syntaxes.join(", "), yours: r.document.syntax });
    return fill(W.reason_profile, { profile: report.profile(r.document) });
  }
  return /^BR-(S|Z|E|AE|IC|G|O|B)-/.test(D.id) ? W.reason_vat : W.reason_other;
}

function answer(name, r, pages, { report, T }) {
  const head = (cls, text) => `<h3 class="tally ${cls}">${esc(text)}</h3>`;
  const file = `<p class="what">${esc(name)}${r.document ? ` · ${esc(`${r.document.source.startsWith("PDF") ? "PDF" : "XML"} · ${report.profile(r.document)}`)}` : ""}</p>`;
  const picker = (label) => `<p class="actions-row"><label class="btn secondary" for="rule-file">${esc(label)}</label></p>`;
  if (r.status === "unreadable" || r.status === "too-large") {
    const lines = (r.error.match(/^(\d+) lines/) || [])[1];
    const why = fill(T.reasons[r.code] || r.error, { lines, max: 300 });
    return `${file}${head("v-warn", W.could_not)}<p>${esc(why)}</p><p>${esc(W.could_not_more)} <a href="${esc(D.check)}">${esc(D.check)}</a></p>${picker(W.another)}`;
  }
  const inv = r.values || { terms: {}, schemes: {}, lines: [], notes: [] };
  report.setCurrency(inv.terms["BT-5"]);
  const own = r.findings.filter(mine);
  const others = r.findings.filter((g) => g.severity === "error" && !mine(g));
  const n = new Set(others.map((g) => report.pageOf(g.rule))).size;
  const ownSets = Object.keys(D.contexts);
  let verdict;
  let failed = false;
  if (own.length) {
    failed = own.some((g) => g.severity === "error");
    verdict = `${head(failed ? "v-err" : "v-warn", fill(failed ? W.fails : W.warns, { id: D.id }))}
      <ol class="errors">${own.map((g, i) => report.errorCard(g, i + 1, inv, pages, { own: true })).join("")}</ol><p>${esc(W.again)}</p>${picker(W.choose)}`;
  } else if (r.not_run.some((x) => ownSets.includes(x.sef)) && !ownSets.some((s) => s in r.fired)) {
    verdict = `${head("v-warn", W.could_not)}<p>${esc(W.could_not_rule)}</p>${picker(W.another)}`;
  } else if (ownSets.some((s) => s in r.fired && D.contexts[s].some((c) => r.fired[s].includes(c)))) {
    verdict = `${head("v-ok", `✓ ${fill(W.passes, { id: D.id })}`)}<p>${esc(W.passes_line)}</p>${picker(W.another)}`;
  } else {
    verdict = `${head("v-muted", fill(W.not_applies, { id: D.id }))}<p>${esc(reason(r, report))}</p>${picker(W.another)}`;
  }
  // the rest of what the run found: one line, which opens the other errors here, with the same file
  const rest = n
    ? `<p class="others">${esc(fill(n === 1 ? (failed ? W.others_one : W.elsewhere_one) : failed ? W.others_many : W.elsewhere_many, { n }))}
        <button type="button" class="link" data-all>${esc(W.see_all)}</button></p>
      <div class="all-errors" hidden><h3>${esc(W.all_title)}</h3><ol class="errors">${others.map((g, i) => report.errorCard(g, own.length + i + 1, inv, pages, { first: false })).join("")}</ol></div>`
    : r.status === "incomplete" ? "" : `<p class="others">${esc(failed ? W.none_other : W.none_elsewhere)}</p>`;
  return `${file}${verdict}${rest}`;
}

async function run(name, bytes) {
  box.classList.add("checked"); // the result replaces the first invitation; it has its own file picker
  out.innerHTML = `<p class="checking">${esc(W.checking)}</p>`;
  try {
    const t = await load();
    copyTexts = t.T;
    const [r, pages] = await Promise.all([t.engine.check(name, bytes), t.report.rulePages()]);
    out.innerHTML = answer(name, r, pages, t);
  } catch {
    out.innerHTML = `<h3 class="tally v-warn">${esc(W.could_not)}</h3><p>${esc(W.could_not_rule)}</p>`;
  }
  out.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function fromFile(file) {
  if (file) await run(file.name, new Uint8Array(await file.arrayBuffer()));
  input.value = "";
}

input.addEventListener("change", () => fromFile(input.files[0]));
box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("over"); });
box.addEventListener("dragleave", (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove("over"); });
box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("over"); fromFile(e.dataTransfer.files[0]); });
box.querySelector("[data-example]")?.addEventListener("click", async () => {
  const bytes = new Uint8Array(await (await fetch(`/examples/fr/${D.example}`)).arrayBuffer());
  await run(D.example_name, bytes);
});
out.addEventListener("click", (e) => {
  if (e.target.closest("[data-all]")) {
    const all = out.querySelector(".all-errors");
    all.hidden = false;
    e.target.closest(".others").hidden = true;
    all.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    const said = copy.parentElement.querySelector(".copied");
    navigator.clipboard.writeText(copy.dataset.copy).then(
      () => { said.textContent = copy.dataset.what === "message" ? copyTexts.message_copied : copyTexts.copied; },
      () => { said.textContent = `${copyTexts.copy_failed} ${copy.dataset.copy}`; }, // no clipboard: the address to copy by hand
    );
  }
});
window.lintvoiceRuleCheckReady = true;
