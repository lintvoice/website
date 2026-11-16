// The check page: take a file (dropped, chosen, or one of our example invoices), check it in this page with
// engine.mjs, then show the analysis next to a preview of the invoice: what was detected, and for each error the
// values the invoice holds, why they fail, and how to fix them, without leaving the page.
import { check } from "./engine.mjs";
import { computation, day, money, read } from "./invoice.mjs";

const T = JSON.parse(document.getElementById("check-texts").textContent);
const lang = document.documentElement.lang;
const page = document.getElementById("check-page");
const result = document.getElementById("result");
const drop = document.getElementById("drop");
const input = document.getElementById("file");
let rules = null;
let currency = "EUR"; // the checked invoice's (BT-5)

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
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

const label = (bt) => T.terms[bt] || bt;
const isAmount = (bt) => /^BT-1(0[6-9]|1[0-7]|31|46)$/.test(bt);
const isDate = (bt) => ["BT-2", "BT-7", "BT-9", "BT-26"].includes(bt);
function show(bt, v) {
  if (!v) return `<em class="absent">${esc(T.absent)}</em>`;
  if (isAmount(bt)) return esc(money(v, lang, currency));
  if (isDate(bt)) return esc(day(v, lang));
  return esc(v);
}

// The business terms an error is about: the one its id names (BR-FR-01_BT-25), else the rule page's and the ones
// its message names.
function termsOf(g, pages) {
  const named = g.rule.match(/BT-\d+/g);
  if (named) return named;
  const set = new Set(pages[pageOf(g.rule)]?.terms || []);
  for (const m of g.messages) for (const bt of m.message.match(/BT-\d+/g) || []) set.add(bt);
  return [...set];
}

// What an identifier is: a SIREN or SIRET when the invoice says so (scheme 0002, 0009) or, without a scheme, when the
// party is in France; a company number or an identifier otherwise.
function idLabel(inv, bt) {
  const country = inv.terms[["BT-30", "BT-29"].includes(bt) ? "BT-40" : "BT-55"];
  const scheme = inv.schemes[bt];
  const siren = ["BT-30", "BT-47"].includes(bt);
  if (scheme ? scheme === (siren ? "0002" : "0009") : country === "FR" || !inv.terms[bt]) return siren ? "SIREN" : "SIRET";
  return siren ? T.legal_id : T.party_id;
}

// --- the invoice preview, laid out like our example invoices, with the fields in error marked
function preview(inv, marks) {
  const t = inv.terms;
  const laid = new Set(); // the terms this preview lays out; the other marked ones are listed under it
  const attr = (bt) => (laid.add(bt), marks.has(bt) ? ` class="bad" data-mark="${marks.get(bt).join(",")}"` : "");
  const field = (bt, v) => `<span${attr(bt)}>${show(bt, v)}</span>`;
  const shown = (bt) => t[bt] || marks.has(bt);
  const line = (bt, k) => (shown(bt) ? `<p class="ids"><span class="k">${esc(k)}</span> ${field(bt, t[bt])}</p>` : "");
  const party = (who, name, siren, siret, vat, address) => `<div class="party"><p class="who">${esc(who)}</p>
      <p class="name">${field(name, t[name])}</p>
      ${line(siren, idLabel(inv, siren))}${line(siret, idLabel(inv, siret))}${line(vat, T.vat_number)}${line(address, T.e_address)}</div>`;
  const lines = inv.lines.slice(0, 12).map((l) => `<tr><td>${esc(l["BT-153"])}</td><td${attr("BT-129")}>${esc(l["BT-129"])}</td>
      <td${attr("BT-146")}>${show("BT-146", l["BT-146"])}</td><td${attr("BT-152")}>${esc(l["BT-152"])} %</td><td${attr("BT-131")}>${show("BT-131", l["BT-131"])}</td></tr>`).join("");
  const more = inv.lines.length > 12 ? `<tr><td colspan="5" class="more">${esc(fill(T.more_lines, { n: inv.lines.length - 12 }))}</td></tr>` : "";
  const total = (bt, strong) => (shown(bt) ? `<div${strong ? ' class="strong"' : ""}><span>${esc(label(bt))}</span>${field(bt, t[bt])}</div>` : "");
  const body = `<div class="invoice">
    <div class="inv-top">${party(T.seller, "BT-27", "BT-30", "BT-29", "BT-31", "BT-34")}
      <div class="inv-title"><p class="doc">${esc(T.doc_types[t["BT-3"]] || T.doc_types["380"])}</p><p class="num">${field("BT-1", t["BT-1"])}</p>
        <p class="dates">${esc(label("BT-2"))} ${field("BT-2", t["BT-2"])}${shown("BT-9") ? `<br>${esc(label("BT-9"))} ${field("BT-9", t["BT-9"])}` : ""}</p></div></div>
    ${party(T.buyer, "BT-44", "BT-47", "BT-46", "BT-48", "BT-49")}
    <table class="inv-lines"><thead><tr><th>${esc(T.col_item)}</th><th>${esc(T.col_qty)}</th><th>${esc(T.col_price)}</th><th>${esc(T.col_vat)}</th><th>${esc(T.col_net)}</th></tr></thead><tbody>${lines}${more}</tbody></table>
    <div class="inv-totals">${total("BT-106")}${total("BT-107")}${total("BT-108")}${total("BT-109")}${total("BT-110")}${total("BT-112", true)}${total("BT-113")}${total("BT-114")}${total("BT-115", true)}</div>`;
  for (const bt of ["BT-129", "BT-146", "BT-152", "BT-131", "BT-153"]) if (inv.lines.length) laid.add(bt);
  const others = [...marks.keys()].filter((bt) => !laid.has(bt) && bt in t);
  return `${body}${others.length ? `<dl class="inv-others"><p class="who">${esc(T.other_terms)}</p>${others.map((bt) => `<div><dt>${esc(label(bt))}</dt><dd>${field(bt, t[bt])}</dd></div>`).join("")}</dl>` : ""}
    <p class="inv-note">${esc(T.preview_note)}</p>
  </div>`;
}

// --- one error, with what the invoice holds and how to fix it
function errorCard(g, n, inv, pages) {
  const id = pageOf(g.rule);
  const p = pages[id];
  const official = g.messages[0]?.message || "";
  const title = g.rule === "XSD" ? T.xsd_title : p ? p.title[lang] : official;
  const calc = computation(id, inv);
  let observed = "";
  if (calc) {
    const gap = calc.gap.replace(/^-/, "");
    const rows = calc.parts.length > 6
      ? `<tr><td></td><td class="k">${esc(fill(T.calc_lines, { n: calc.parts.length, what: label(calc.parts[0][2]) }))}</td><td></td></tr>`
      : calc.parts.map(([s, v, bt], i) => `<tr><td class="op">${i ? (s === "-" ? "−" : "+") : s === "-" ? "−" : ""}</td><td class="k">${esc(label(bt))}</td><td class="v">${show(bt, v)}</td></tr>`).join("");
    observed = `<table class="calc"><tbody>${rows}
      <tr class="sum"><td class="op">=</td><td class="k">${esc(T.calc_expected)}</td><td class="v">${show(calc.result, calc.expected)}</td></tr>
      <tr class="stated"><td></td><td class="k">${esc(fill(T.calc_stated, { what: label(calc.result) }))}</td><td class="v">${show(calc.result, calc.stated)}</td></tr></tbody></table>
      ${/^0\.0*$/.test(gap) ? "" : `<p class="gap">${fill(esc(T.calc_gap), { gap: `<strong>${show(calc.result, gap)}</strong>` })}</p>`}`;
  } else {
    const has = (bt) => bt in inv.terms || inv.lines.some((l) => bt in l);
    const value = (bt) => (bt in inv.terms ? show(bt, inv.terms[bt]) : inv.lines.map((l) => show(bt, l[bt])).join(" · "));
    const all = termsOf(g, pages);
    const rows = all.filter(has).map((bt) => `<div><dt>${esc(label(bt))}</dt><dd>${value(bt)}</dd></div>`);
    if (all.includes("BT-21") || all.includes("BT-22")) {
      const cut = (s) => (s.length > 90 ? `${s.slice(0, 90)}…` : s);
      const notes = inv.notes.map((x) => `${x.code ? `<span class="code">${esc(x.code)}</span> ` : ""}${esc(cut(x.text))}`);
      rows.push(`<div><dt>${esc(T.notes_label)}</dt><dd>${notes.length ? notes.join("<br>") : `<em class="absent">${esc(T.no_notes)}</em>`}</dd></div>`);
    }
    if (rows.length) observed = `<dl class="observed">${rows.join("")}</dl>`;
  }
  const section = (key) => (p?.sections[lang][key] ? `<div class="rule-text"><h4>${esc(p.headings[lang][key])}</h4>${p.sections[lang][key]}</div>` : "");
  const locations = g.messages.flatMap((m) => m.locations).filter(Boolean);
  return `<li class="card ${g.severity === "error" ? "sev-err" : "sev-warn"}" id="error-${n}">
    <p class="head"><span class="marker">${n}</span><span class="idm">${esc(g.rule === "XSD" ? "XSD" : id)}</span>${g.count > 1 ? `<span class="count">${esc(fill(T.occurrences, { n: g.count }))}</span>` : ""}</p>
    <p class="title">${esc(title)}</p>
    ${observed ? `<div class="in-invoice"><p class="label">${esc(T.in_your_invoice)}</p>${observed}</div>` : ""}
    ${p?.sections[lang].fix ? `<div class="fix"><p class="label">${esc(T.how_to_fix)}</p>${p.sections[lang].fix}</div>` : `<p class="official">${esc(official)}</p>`}
    <details><summary>${esc(T.learn_more)}</summary>${section("causes")}${section("checks")}${section("why")}
      <div class="rule-text"><h4>${esc(T.technical)}</h4><p><code>${esc(g.rule)}</code> · ${esc(g.rule_set)}</p>${p ? `<p class="official">${esc(official)}</p>` : ""}
      ${locations.length ? `<p class="where">${locations.slice(0, 5).map((l) => `<code>${esc(l)}</code>`).join(" ")}${locations.length > 5 ? " …" : ""}</p>` : ""}</div>
    </details>
  </li>`;
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
  const inv = read(r.xml);
  currency = inv.terms["BT-5"] || "EUR";
  const errors = r.findings.filter((g) => g.severity === "error");
  const warnings = r.findings.filter((g) => g.severity !== "error");
  // each finding gets a number, shown on its card and next to the invoice fields it is about
  const marks = new Map();
  [...errors, ...warnings].forEach((g, i) => {
    const calc = computation(pageOf(g.rule), inv);
    const terms = calc ? [calc.result, ...calc.parts.map(([, , bt]) => bt)] : termsOf(g, pages);
    for (const bt of terms) marks.set(bt, [...(marks.get(bt) || []), i + 1]);
  });
  const n = r.summary.rules_failed;
  const verdict = n === 0
    ? `<div class="verdict-line v-ok"><p><strong>✓ ${esc(T.verdict_ok)}</strong> ${esc(T.verdict_ok_text)}</p></div>`
    : `<div class="verdict-line v-err"><p><strong>× ${esc(fill(n === 1 ? T.verdict_one : T.verdict_many, { n }))}</strong>${warnings.length ? ` ${esc(fill(warnings.length === 1 ? T.verdict_warn_one : T.verdict_warn_many, { n: warnings.length }))}` : ""}</p></div>`;
  const t = inv.terms;
  const party = (nm, siren) => `${show(nm, t[nm])}${t[siren] || marks.has(siren) ? `<span class="sub">${esc(idLabel(inv, siren))} <span class="mono">${show(siren, t[siren])}</span></span>` : ""}`;
  const detected = `<section class="detected"><h2>${esc(T.detected_title)}</h2><dl>
    <div><dt>${esc(T.doc_types[t["BT-3"]] || T.doc_types["380"])}</dt><dd><span class="mono">${show("BT-1", t["BT-1"])}</span><span class="sub">${esc(label("BT-2"))} ${show("BT-2", t["BT-2"])}</span></dd></div>
    <div><dt>${esc(label("BT-112"))}</dt><dd class="amount">${show("BT-112", t["BT-112"])}</dd></div>
    <div><dt>${esc(T.seller)}</dt><dd>${party("BT-27", "BT-30")}</dd></div>
    <div><dt>${esc(T.buyer)}</dt><dd>${party("BT-44", "BT-47")}</dd></div>
    <div class="full"><dt>${esc(T.fact_rules)}</dt><dd>${r.rule_sets.map((s) => esc(s.name)).join(" · ")}</dd></div></dl></section>`;
  const cards = (list, offset, title) => (list.length ? `<h2>${esc(title)}</h2><ol class="errors">${list.map((g, i) => errorCard(g, offset + i + 1, inv, pages)).join("")}</ol>` : "");
  const said = r.notes.map(note).filter(Boolean);
  const notes = said.length || r.not_run.length
    ? `<p class="notes">${said.map(esc).join(" ")}${r.not_run.length ? ` ${esc(T.not_run)} ${r.not_run.map((x) => esc(x.name)).join(", ")}` : ""}</p>`
    : "";
  return `${filebar(name, r)}<div class="analysis">
    <div class="findings-col">${verdict}${detected}${cards(errors, 0, T.errors_title)}${cards(warnings, errors.length, T.warnings_title)}${notes}</div>
    <div class="preview-col"><p class="col-title">${esc(T.preview_title)}</p>${preview(inv, marks)}</div>
  </div>`;
}

async function run(name, bytes) {
  page.classList.add("checked", "busy");
  result.innerHTML = `<p class="checking">${esc(T.checking)}</p>`;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); // let "checking" paint first
  const [r, pages] = await Promise.all([check(name, bytes), rulePages()]);
  result.innerHTML = render(name, r, pages);
  page.classList.remove("busy");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function fromFile(file) {
  if (file) await run(file.name, new Uint8Array(await file.arrayBuffer()));
}

function reset() {
  page.classList.remove("checked");
  result.innerHTML = "";
  input.value = "";
}

input.addEventListener("change", () => fromFile(input.files[0]));
// a file dropped anywhere on the page is checked, before or after a first check
document.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) drop.classList.remove("over"); });
document.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); fromFile(e.dataTransfer.files[0]); });
drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", async () => {
  const path = b.dataset.example;
  const bytes = new Uint8Array(await (await fetch(`/examples/fr/${path}`)).arrayBuffer());
  await run(`${T.example_prefix}-${path.split("/").pop()}`, bytes);
}));
result.addEventListener("click", (e) => {
  if (e.target.closest("[data-again]")) { reset(); return; }
  const mark = e.target.closest("[data-mark]");
  if (mark) document.getElementById(`error-${mark.dataset.mark.split(",")[0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
});
window.lintvoiceReady = true;
