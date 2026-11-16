// The check page: take a file (dropped, chosen, or one of our example invoices), check it in this page with
// engine.mjs, and show the result in the visitor's language, each error leading to its rule page when there is one.
import { check } from "./engine.mjs";

const T = JSON.parse(document.getElementById("check-texts").textContent);
const lang = document.documentElement.lang;
const layout = new URLSearchParams(location.search).get("v") || "b"; // review only: compare result layouts
const result = document.getElementById("result");
const drop = document.getElementById("drop");
const input = document.getElementById("file");
let rules = null;

document.body.dataset.layout = layout;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

// The page a reported id belongs to: BR-FR-10_BT-30 -> BR-FR-10 (as the rules repository names its folders).
function pageOf(id) {
  if (id === "BR-FR-MV-BD") return "BR-FR-BD-13";
  const m = id.match(/^(BR-FR-(?:CO-|DEC-|MV-|BD-)?\d+|BR-(?:[A-Z]+-)?\d+)/);
  return m ? m[1] : id;
}

async function rulePages() {
  rules ??= await fetch("/static/check/rules.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return rules;
}

function errorItem(g, pages, i) {
  const id = pageOf(g.rule);
  const page = pages[id];
  const official = g.messages[0]?.message || "";
  const title = g.rule === "XSD" ? T.xsd_title : page ? page.title[lang] : official;
  const brief = page ? page.brief[lang] : "";
  const link = page ? `<a class="understand" href="${esc(page.href[lang])}">${esc(T.understand)} →</a>` : "";
  const count = g.count > 1 ? `<span class="count">${esc(fill(T.occurrences, { n: g.count }))}</span>` : "";
  const locations = g.messages.flatMap((m) => m.locations).filter(Boolean);
  const details = `<details><summary>${esc(T.technical)}</summary>
    <p><code>${esc(g.rule)}</code> · ${esc(g.rule_set)}</p>
    ${g.messages.map((m) => `<p class="official">${esc(m.message)}</p>`).join("")}
    ${locations.length ? `<p class="where">${locations.slice(0, 5).map((l) => `<code>${esc(l)}</code>`).join(" ")}${locations.length > 5 ? " …" : ""}</p>` : ""}
  </details>`;
  const badge = `<span class="idm">${esc(g.rule === "XSD" ? "XSD" : id)}</span>`;
  const sev = g.severity === "error" ? "sev-err" : "sev-warn";
  if (layout === "a")
    return `<li class="row ${sev}">${badge}<div class="what"><p class="title">${esc(title)} ${count}</p>${details}</div>${link}</li>`;
  if (layout === "c")
    return `<li class="${sev}"><h3>${badge} ${esc(title)} ${count}</h3>${brief ? `<p>${esc(brief)}</p>` : ""}${link}${details}</li>`;
  return `<li class="card ${sev}"><p class="head">${badge}${count}</p><p class="title">${esc(title)}</p>${brief ? `<p class="fix"><strong>${esc(T.fix_label)}</strong> ${esc(brief)}</p>` : ""}<p class="actions">${link}</p>${details}</li>`;
}

function render(name, r, pages) {
  if (r.status === "unreadable" || r.status === "too-large") {
    const lines = (r.error.match(/^(\d+) lines/) || [])[1];
    const why = fill(T.reasons[r.code] || r.error, { lines, max: 300 });
    return `<div class="verdict ${r.status === "too-large" ? "v-warn" : "v-muted"}"><p class="big">${esc(r.status === "too-large" ? T.verdict_too_large : T.verdict_unreadable)}</p><p class="file">${esc(name)}</p><p>${esc(why)}</p></div>${again()}`;
  }
  const errors = r.findings.filter((g) => g.severity === "error");
  const warnings = r.findings.filter((g) => g.severity !== "error");
  const n = r.summary.rules_failed;
  const verdict = n === 0
    ? `<div class="verdict v-ok"><p class="big">✓ ${esc(T.verdict_ok)}</p><p class="file">${esc(name)}</p><p>${esc(T.verdict_ok_text)}</p></div>`
    : `<div class="verdict v-err"><p class="big">× ${esc(fill(n === 1 ? T.verdict_one : T.verdict_many, { n }))}</p><p class="file">${esc(name)}</p><p>${esc(T.verdict_err_text)}</p></div>`;
  const facts = `<dl class="facts-row"><div><dt>${esc(T.fact_format)}</dt><dd>${esc(r.document.syntax)} · ${esc(r.document.source.startsWith("PDF") ? "PDF" : "XML")}</dd></div>
    <div><dt>${esc(T.fact_profile)}</dt><dd>${esc(profile(r.document))}</dd></div>
    <div><dt>${esc(T.fact_rules)}</dt><dd>${r.rule_sets.map((s) => esc(s.name)).join(" · ")}</dd></div></dl>`;
  const list = (items, title) => (items.length
    ? `<h2>${esc(title)}</h2><${layout === "c" ? "ol class=\"steps\"" : "ul class=\"errors\""}>${items.map((g, i) => errorItem(g, pages, i)).join("")}</${layout === "c" ? "ol" : "ul"}>`
    : "");
  const said = r.notes.map(note).filter(Boolean);
  const notes = said.length ? `<p class="notes">${said.map(esc).join(" ")}</p>` : "";
  const notRun = r.not_run.length ? `<p class="notes">${esc(T.not_run)} ${r.not_run.map((x) => esc(x.name)).join(", ")}</p>` : "";
  const body = list(errors, T.errors_title) + list(warnings, T.warnings_title);
  if (layout === "c")
    return `<div class="report"><aside>${verdict}${facts}${notes}${notRun}${again()}</aside><div class="main">${body || ""}</div></div>`;
  return verdict + facts + body + notes + notRun + again();
}

// The CLI's notes, in the visitor's language; a note this page does not know is not shown.
function note(n) {
  let m;
  if (/^BR-FR rules applied/.test(n)) return T.note_brfr_applied;
  if ((m = n.match(/^BR-FR rules not applied: the seller's country is (.+?) \(/))) return fill(T.note_brfr_not_applied, { country: m[1] === "not given" ? T.not_given : m[1] });
  if ((m = n.match(/^No Factur-X (\w+) profile rules/))) return fill(T.note_no_profile_rules, { profile: m[1] });
  if ((m = n.match(/^(XRechnung|Peppol BIS) rules are not in this version/))) return fill(T.note_other_rules, { name: m[1] });
  if (/^Unknown specification identifier/.test(n)) return T.note_unknown;
  return "";
}

function profile(d) {
  const name = T.profiles[d.profile] || d.profile;
  return d.source.startsWith("PDF") && d.syntax === "CII" && !name.startsWith("Factur-X") && !["XRechnung", "Peppol BIS"].includes(name) ? `Factur-X ${name}` : name;
}

const again = () => `<p class="again"><button type="button" class="btn" data-again>${esc(T.again)}</button></p>`;

async function run(name, bytes) {
  result.innerHTML = `<p class="checking">${esc(T.checking)}</p>`;
  document.getElementById("check").classList.add("busy");
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); // let "checking" paint first
  const [r, pages] = await Promise.all([check(name, bytes), rulePages()]);
  result.innerHTML = render(name, r, pages);
  document.getElementById("check").classList.remove("busy");
  document.getElementById("check").classList.add("done");
  result.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function fromFile(file) {
  if (file) await run(file.name, new Uint8Array(await file.arrayBuffer()));
}

input.addEventListener("change", () => fromFile(input.files[0]));
drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); fromFile(e.dataTransfer.files[0]); });
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", async () => {
  const path = b.dataset.example;
  const bytes = new Uint8Array(await (await fetch(`/examples/fr/${path}`)).arrayBuffer());
  await run(`${T.example_prefix}-${path.split("/").pop()}`, bytes);
}));
result.addEventListener("click", (e) => {
  if (e.target.matches("[data-again]")) {
    result.innerHTML = "";
    document.getElementById("check").classList.remove("done");
    input.value = "";
    drop.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
window.lintvoiceReady = true;
