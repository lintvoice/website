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

// The rule pages (title, brief, sections, subject) and each subject's name and icon, fetched once.
let subjects = {};
const json = (url) => fetch(url).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
export async function rulePages() {
  if (!rules) [rules, subjects] = await Promise.all([json("/static/check/rules.json"), json("/static/check/subjects.json")]);
  return rules;
}

// The family of a rule without a page (its title says which kind of rule it is): the longest prefix the texts know.
function familyOf(id) {
  const keys = Object.keys(T.families || {}).sort((a, b) => b.length - a.length);
  return keys.find((k) => id === k || id.startsWith(`${k}-`)) || "BR";
}

const label = (bt) => T.terms[bt] || bt;
const isAmount = (bt) => /^BT-(92|99|1(0[6-9]|1[0-7]|31|46))$/.test(bt);
const isDate = (bt) => ["BT-2", "BT-7", "BT-9", "BT-26"].includes(bt);
const isRate = (bt) => ["BT-96", "BT-103", "BT-119", "BT-152"].includes(bt);
// A rate with its unit, as written (the format itself may be the error), with the page's decimal sign: "5,5 %".
const rate = (v) => (/^-?\d+(\.\d+)?$/.test(v) ? `${lang === "fr" ? v.replace(".", ",") : v}\u00a0%` : v);
export function show(bt, v) {
  if (!v) return `<em class="absent">${esc(T.absent)}</em>`;
  if (isAmount(bt)) return esc(money(v, lang, currency));
  if (isDate(bt)) return esc(day(v, lang));
  if (isRate(bt)) return esc(rate(v));
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
      <td${attr("BT-146")}>${show("BT-146", l["BT-146"])}</td><td${attr("BT-152")}>${show("BT-152", l["BT-152"])}</td><td${attr("BT-131")}>${show("BT-131", l["BT-131"])}</td></tr>`).join("");
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
// The card, in this order: what is wrong (code, subject, plain title), the rule in plain words, the invoice's values,
// why (the common causes), how to fix, then two quiet folds (more about the rule; the technical details). On the
// rule's own page (own), it keeps the invoice's values and the link to copy: the page around it says the rest. The
// causes are visible on the first card only (first), folded on the others.
export function errorCard(g, n, inv, pages, { own = false, first = true } = {}) {
  const id = pageOf(g.rule);
  const p = pages[id];
  const official = g.messages[0]?.message || "";
  const title = g.rule === "XSD" ? T.xsd_title : p ? p.title[lang] : fill(T.not_explained, { family: T.families[familyOf(g.rule)] });
  const calc = g.computation;
  let observed = "";
  if (calc) {
    const gap = calc.gap.replace(/^-/, "");
    const op = (s, i) => (s === "×" ? "×" : s === "-" ? "−" : i ? "+" : "");
    const row = ([s, v, bt], i) => `<tr><td class="op">${op(s, i)}</td><td class="k">${esc(label(bt))}</td><td class="v">${show(bt, v)}</td></tr>`;
    // more than six parts: each run of the same term (the lines) in one row that counts them
    const runs = [];
    for (const p of calc.parts) {
      const last = runs[runs.length - 1];
      if (last && last.part[0] === p[0] && last.part[2] === p[2]) last.n += 1;
      else runs.push({ part: p, n: 1 });
    }
    const rows = !calc.parts.length
      ? `<tr><td></td><td class="k">${esc(T.calc_nothing)}</td><td></td></tr>` // no line, allowance or charge at all
      : calc.parts.length > 6
      ? runs.map(({ part, n }, i) => (n > 1 ? `<tr><td class="op">${op(part[0], i)}</td><td class="k">${esc(fill(T.calc_lines, { n, what: label(part[2]) }))}</td><td></td></tr>` : row(part, i))).join("")
      : calc.parts.map(row).join("");
    // a rule checked rate by rate says which rate
    const of = calc.group ? `<p class="calc-of">${fill(esc(T.calc_group), { rate: show("BT-119", calc.group["BT-119"]) })}</p>` : "";
    observed = `${of}<table class="calc"><tbody>${rows}
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
  const xsd = g.rule === "XSD";
  const subject = p && subjects[p.topic] ? `<span class="subject">${subjects[p.topic].icon}${esc(subjects[p.topic].name[lang])}</span>` : "";
  const copy = (value, label, what) =>
    `<span class="share"><button type="button" class="link" data-copy="${esc(value)}" data-what="${what}">${esc(label)}</button><span class="copied" role="status"></span></span>`;
  const publisher = p && SENDS_TO_PUBLISHER.test(p.sections[lang].fix) ? copy(base + p.href[lang], T.copy_link, "link") : "";
  const observedBlock = observed ? `<div class="in-invoice"><p class="label">${esc(T.in_your_invoice)}</p>${observed}</div>` : "";
  const head = `<p class="head"><span class="marker">${n}</span><span class="idm">${esc(xsd ? "XSD" : id)}</span>${g.count > 1 ? `<span class="count">${esc(fill(T.occurrences, { n: g.count }))}</span>` : ""}${subject}</p>`;
  const card = (body) => `<li class="card ${g.severity === "error" ? "sev-err" : "sev-warn"}" id="error-${n}">${head}${body}</li>`;
  if (own) return card(`${observedBlock}${publisher ? `<p>${publisher}</p>` : ""}`);
  // the rule in plain words; for a rule without a page, what it is and its official message to pass on
  const ruleLine = p?.brief?.[lang] ? `<p class="rule-line"><b>${esc(T.rule_label)}</b> ${esc(p.brief[lang])}</p>` : "";
  const unexplained = !p && !xsd ? `<p class="rule-line">${esc(T.not_explained_line)}</p><p>${copy(official, T.copy_message, "message")}</p>` : "";
  // why: the common causes, three at most, visible on the first card, folded under the same words on the others
  let why = "";
  const causes = p?.sections[lang].causes;
  if (causes) {
    const items = causes.match(/<li>[\s\S]*?<\/li>/g);
    const list = items ? `<ul>${items.slice(0, 3).join("")}</ul>` : causes;
    why = first ? `<div class="why"><p class="label">${esc(T.why_title)}</p>${list}</div>`
      : `<details class="why"><summary class="label">${esc(T.why_title)}</summary>${list}</details>`;
  }
  // how to fix; the publisher's link as words, at the end of the step that names the publisher
  let fix = "";
  if (p?.sections[lang].fix) {
    let placed = false;
    const steps = p.sections[lang].fix.replace(/<li>([\s\S]*?)<\/li>/g, (m, inner) => {
      if (placed || !publisher || !SENDS_TO_PUBLISHER.test(inner)) return m;
      placed = true;
      return `<li>${inner} ${publisher}</li>`;
    });
    fix = `<div class="fix"><p class="label">${esc(T.how_to_fix)}</p>${steps}${publisher && !placed ? `<p>${publisher}</p>` : ""}</div>`;
  }
  // two quiet folds: more about the rule, then the technical details (the official message once)
  const more = section("checks") || section("why") ? `<details class="more"><summary>${esc(T.more_title)}</summary>${section("checks")}${section("why")}</details>` : "";
  const english = !/^BR-FR/.test(g.rule) && T.in_english;
  const tech = `<details class="more"><summary>${esc(T.technical)}</summary><div class="rule-text tech-mark">
      <p><code>${esc(g.rule)}</code> · ${esc(g.rule_set)}</p>
      ${xsd ? "" : `<p class="label">${esc(T.official_message)}${english ? ` ${esc(T.in_english)}` : ""}</p><p class="official">${esc(official)}</p>`}
      ${locations.length ? `<p class="where">${locations.slice(0, 5).map((l) => `<code>${esc(l)}</code>`).join(" ")}${locations.length > 5 ? " …" : ""}</p>` : ""}</div></details>`;
  return card(`<p class="title">${esc(title)}</p>${ruleLine}${unexplained}${observedBlock}${xsd ? `<p class="official">${esc(official)}</p>` : ""}${why}${fix}${more}${tech}`);
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
