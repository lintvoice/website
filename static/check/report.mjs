// How a check's result is shown, shared by the check page (ui.mjs) and each rule page's own check (rule-check.mjs):
// an error card with the invoice's values and how to fix it, the invoice preview, the notes, in the visitor's language.
import { day, money } from "./invoice.mjs";

let T = {};
let lang = "en";
let base = ""; // the site's address, for the rule links a visitor copies
let rules = null;
let currency = "EUR"; // the checked invoice's (BT-5)

// The texts (the check page's [check.ui]), the page's language and the site's address.
export function setup(texts, language, siteBase) {
  T = texts;
  lang = language;
  base = siteBase;
}

export function setCurrency(code) {
  currency = code || "EUR";
}

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");

// The page a reported id belongs to: BR-FR-10_BT-30 -> BR-FR-10 (as the rules repository names its folders).
export function pageOf(id) {
  if (id === "BR-FR-MV-BD") return "BR-FR-BD-13";
  const m = id.match(/^(BR-FR-(?:CO-|DEC-|MV-|BD-)?\d+|BR-(?:[A-Z]+-)?\d+)/);
  return m ? m[1] : id;
}

export async function rulePages() {
  rules ??= await fetch("/static/check/rules.json").then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return rules;
}

const label = (bt) => T.terms[bt] || bt;
const isAmount = (bt) => /^BT-1(0[6-9]|1[0-7]|31|46)$/.test(bt);
const isDate = (bt) => ["BT-2", "BT-7", "BT-9", "BT-26"].includes(bt);
export function show(bt, v) {
  if (!v) return `<em class="absent">${esc(T.absent)}</em>`;
  if (isAmount(bt)) return esc(money(v, lang, currency));
  if (isDate(bt)) return esc(day(v, lang));
  return esc(v);
}

// The business terms an error is about: the one its id names (BR-FR-01_BT-25), else the rule page's and the ones
// its message names.
export function termsOf(g, pages) {
  const named = g.rule.match(/BT-\d+/g);
  if (named) return named;
  const set = new Set(pages[pageOf(g.rule)]?.terms || []);
  for (const m of g.messages) for (const bt of m.message.match(/BT-\d+/g) || []) set.add(bt);
  return [...set];
}

// What an identifier is: a SIREN or SIRET when the invoice says so (scheme 0002, 0009) or, without a scheme, when the
// party is in France; a company number or an identifier otherwise.
export function idLabel(inv, bt) {
  const country = inv.terms[["BT-30", "BT-29"].includes(bt) ? "BT-40" : "BT-55"];
  const scheme = inv.schemes[bt];
  const siren = ["BT-30", "BT-47"].includes(bt);
  if (scheme ? scheme === (siren ? "0002" : "0009") : country === "FR" || !inv.terms[bt]) return siren ? "SIREN" : "SIRET";
  return siren ? T.legal_id : T.party_id;
}

// --- the invoice preview, laid out like our example invoices, with the fields in error marked
export function preview(inv, marks) {
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
  </div>`;
}

// --- one error, with what the invoice holds and how to fix it
// When the fix sends the visitor to their software's publisher, they get the rule page's address to forward: an
// action that copies it, not a link that leaves this page.
const SENDS_TO_PUBLISHER = /éditeur|publisher|vendor/;
// On the rule's own page (own), the card keeps the invoice's values and the link to copy: the page around it already
// says how to fix and why.
export function errorCard(g, n, inv, pages, { own = false } = {}) {
  const id = pageOf(g.rule);
  const p = pages[id];
  const official = g.messages[0]?.message || "";
  const title = g.rule === "XSD" ? T.xsd_title : p ? p.title[lang] : official;
  const calc = g.computation;
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
    ${own ? "" : p?.sections[lang].fix ? `<div class="fix"><p class="label">${esc(T.how_to_fix)}</p>${p.sections[lang].fix}</div>` : `<p class="official">${esc(official)}</p>`}
    ${p && SENDS_TO_PUBLISHER.test(p.sections[lang].fix) ? `<p class="share"><button type="button" class="btn secondary" data-copy="${esc(base + p.href[lang])}">${esc(T.copy_link)}</button> <span class="copied" role="status"></span></p>` : ""}
    ${own ? "" : `<details><summary>${esc(T.learn_more)}</summary>${section("causes")}${section("checks")}${section("why")}
      <div class="rule-text"><h4>${esc(T.technical)}</h4><p><code>${esc(g.rule)}</code> · ${esc(g.rule_set)}</p>${p ? `<p class="official">${esc(official)}</p>` : ""}
      ${locations.length ? `<p class="where">${locations.slice(0, 5).map((l) => `<code>${esc(l)}</code>`).join(" ")}${locations.length > 5 ? " …" : ""}</p>` : ""}</div>
    </details>`}
  </li>`;
}

// The rule sets as families with their version, in a fixed order: "EN 16931 1.3.17, Factur-X 1.09.2, BR-FR 1.4.0.04".
const FAMILIES = ["EN 16931", "Factur-X", "BR-FR", "EXTENDED-CTC-FR", "UBL", "CII"];
export function families(sets) {
  const names = sets.map((s) => (s.name.match(/^(EN 16931|Factur-X|BR-FR|EXTENDED-CTC-FR|UBL|CII) [\w.]+/) || [s.name])[0]);
  const rank = (n) => { const i = FAMILIES.findIndex((f) => n.startsWith(f)); return i < 0 ? FAMILIES.length : i; };
  return [...new Set(names)].sort((a, b) => rank(a) - rank(b));
}

// The CLI's notes, in the visitor's language; a note this page does not know is not shown.
export function note(n) {
  let m;
  if (/^BR-FR rules applied/.test(n)) return T.note_brfr_applied;
  if ((m = n.match(/^BR-FR rules not applied: the seller's country is (.+?) \(/))) return fill(T.note_brfr_not_applied, { country: m[1] === "not given" ? T.not_given : m[1] });
  if ((m = n.match(/^No Factur-X (\w+) profile rules/))) return fill(T.note_no_profile_rules, { profile: m[1] });
  if ((m = n.match(/^(XRechnung|Peppol BIS) rules are not in this version/))) return fill(T.note_other_rules, { name: m[1] });
  if (/^Unknown specification identifier/.test(n)) return T.note_unknown;
  return "";
}

export function profile(d) {
  const name = T.profiles[d.profile] || d.profile;
  return d.source.startsWith("PDF") && d.syntax === "CII" && !name.startsWith("Factur-X") && !["XRechnung", "Peppol BIS"].includes(name) ? `Factur-X ${name}` : name;
}
