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
const AMOUNTS = [92, 93, 99, 100, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 131, 136, 137, 141, 142, 146, 147, 148];
const isAmount = (bt) => AMOUNTS.includes(Number(bt.slice(3)));
const isDate = (bt) => ["BT-2", "BT-7", "BT-9", "BT-26", "BT-72", "BT-73", "BT-74", "BT-134", "BT-135"].includes(bt);
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

// The business terms an error is about: the ones its id names (BR-FR-01_BT-25; BR-FR-CO-10_BT-60-1 names BT-60), when
// these texts know them; else the rule page's and the ones its messages name (BR-FR-CO-04_BT-4: BT-4 is no business
// term, its message names BT-3, BT-25 and BT-26).
export function termsOf(g, pages) {
  const named = (g.rule.match(/BT-\d+/g) || []).filter((bt) => bt in T.terms);
  if (named.length) return [...new Set(named)];
  const set = new Set(pages[pageOf(g.rule)]?.terms || []);
  for (const m of g.messages) for (const bt of m.message.match(/BT-\d+/g) || []) set.add(bt);
  return [...set];
}

// An error about an identifier's scheme (BR-FR-CO-10: a scheme missing or repeated; BR-FR-32: an identifier declared
// with scheme 0002; BR-62: "shall have a Scheme identifier"): the identifier is shown with its scheme.
const aboutScheme = (g) => g.messages.some((m) => /schemeID|scheme identifier|\bBT-\d+-1\b/i.test(m.message));

// The note subject code an error is about (BR-FR-05_BT-22_PMD, or "(code PMD)" in its message), if any.
const noteCode = (g) => (g.rule.match(/_BT-2[12]_([A-Z0-9]+)$/) || g.messages.map((m) => m.message.match(/\(code ([A-Z0-9]+)\)/)).find(Boolean) || [])[1];

// The parties that may be absent from an invoice: a term of an absent party is not shown, there is nothing to point at.
const PARTIES = [["BT-59", "BT-60", "BT-61"], ["BT-70", "BT-71"]];
const partyAbsent = (inv, bt) => PARTIES.some((p) => p.includes(bt) && p.every((x) => !inv.terms[x]));

// Every value of a term in the invoice, wherever it is: the header, each line with its allowances, charges and item
// attributes, the VAT breakdown, the document level allowances and charges, the supporting documents. BT-18 is the
// identifier of a document of type 130, BT-xx-1 the scheme of BT-xx. Empty when the invoice has no place for it.
export function valuesOf(inv, bt) {
  const scheme = bt.match(/^(BT-\d+)-1$/);
  if (scheme && scheme[1] in inv.terms) return [inv.schemes[scheme[1]] || ""];
  if (bt in inv.terms) return partyAbsent(inv, bt) ? [] : [inv.terms[bt]];
  const docs = inv.documents || [];
  const objects = docs.filter((d) => d.type === "130");
  if (bt === "BT-18") return objects.map((d) => d["BT-122"]);
  const rows = [
    ...inv.lines.flatMap((l) => [l, ...(l.allowances || []), ...(l.charges || []), ...(l.attributes || [])]),
    ...(inv.vat_breakdown || []), ...(inv.allowances || []), ...(inv.charges || []), ...(bt === "BT-18-1" ? objects : docs),
  ];
  return rows.filter((r) => bt in r).map((r) => r[bt]);
}

// Each finding's number (errors first, then warnings, as the cards are numbered) next to what it is about: its terms
// (a computation's result and parts), "BT-xx-1" when it is about BT-xx's scheme, and for the notes "note-missing:PMD"
// (a missing note), "note-code:PMT" (a repeated note) or "notes" (the notes as a whole).
export function marksOf(list, pages) {
  const marks = new Map();
  const add = (key, n) => marks.set(key, [...(marks.get(key) || []), n]);
  list.forEach((g, i) => {
    const calc = g.computation;
    const terms = calc ? [calc.result, ...calc.parts.map(([, , bt]) => bt)] : termsOf(g, pages);
    for (const bt of terms) add(bt, i + 1);
    if (!calc && aboutScheme(g)) for (const bt of terms) add(`${bt}-1`, i + 1);
    if (terms.includes("BT-21") || terms.includes("BT-22")) {
      const code = noteCode(g);
      add(!code ? "notes" : terms.includes("BT-22") ? `note-missing:${code}` : `note-code:${code}`, i + 1);
    }
  });
  return marks;
}

// What an identifier is: a SIREN or SIRET when the invoice says so (scheme 0002, 0009) or, without a scheme, when the
// party is in France; a company number or an identifier otherwise.
export function idLabel(inv, bt) {
  const country = inv.terms[{ "BT-29": "BT-40", "BT-30": "BT-40", "BT-46": "BT-55", "BT-47": "BT-55" }[bt]];
  const scheme = inv.schemes[bt];
  const siren = ["BT-30", "BT-47", "BT-61"].includes(bt);
  if (scheme ? scheme === (siren ? "0002" : "0009") : country === "FR" || !inv.terms[bt]) return siren ? "SIREN" : "SIRET";
  return siren ? T.legal_id : T.party_id;
}

// An identifier's scheme, as the preview and the error card show it: "scheme 0009", "no scheme".
const schemeOf = (inv, bt) => esc(inv.schemes[bt] ? fill(T.scheme, { scheme: inv.schemes[bt] }) : T.no_scheme);

// A note, as "code — text"; a missing note says so.
const cut = (s) => (s.length > 90 ? `${s.slice(0, 90)}…` : s);
const noteLine = (code, text) => `${code ? `<span class="code">${esc(code)}</span> — ` : ""}${text === null ? `<em class="absent">${esc(T.note_missing)}</em>` : esc(cut(text))}`;

// --- the invoice preview, laid out like our example invoices, with the fields in error marked. What an invoice
// without errors does not show (the payee, the notes, the VAT breakdown…) appears only when an error points at it,
// whole, with only the faulty items marked.
export function preview(inv, marks) {
  const t = inv.terms;
  const laid = new Set(); // the terms this preview lays out; the other marked ones are listed under it
  const numbers = (bts) => [...new Set(bts.flatMap((bt) => marks.get(bt) || []))].sort((a, b) => a - b);
  // a field's class and mark: the numbers of the findings about any of its terms
  const cattr = (cls, ...bts) => {
    for (const bt of bts) laid.add(bt);
    const n = numbers(bts);
    const c = [cls, n.length ? "bad" : ""].filter(Boolean).join(" ");
    return `${c ? ` class="${c}"` : ""}${n.length ? ` data-mark="${n.join(",")}"` : ""}`;
  };
  const attr = (...bts) => cattr("", ...bts);
  const field = (bt, v, ...also) => `<span${attr(bt, ...also)}>${show(bt, v)}</span>`;
  const marked = (...bts) => bts.some((bt) => marks.has(bt));
  const shown = (bt) => t[bt] || marks.has(bt);
  const kv = (bt, v) => `<span class="k">${esc(label(bt))}</span> ${field(bt, v)}`;
  // an identifier, with its scheme when an error is about it
  const id = (bt) => `<span${attr(bt, `${bt}-1`)}>${show(bt, t[bt])}${marks.has(`${bt}-1`) && t[bt] ? ` · ${schemeOf(inv, bt)}` : ""}</span>`;
  const line = (bt, k) => (bt && shown(bt) ? `<p class="ids"><span class="k">${esc(k)}</span> ${id(bt)}</p>` : "");
  const party = (who, name, siren, siret, vat, address) => `<div class="party"><p class="who">${esc(who)}</p>
      <p class="name">${field(name, t[name])}</p>
      ${line(siren, idLabel(inv, siren))}${line(siret, idLabel(inv, siret))}${line(vat, T.vat_number)}${line(address, T.e_address)}</div>`;
  // the payee and the deliver-to party, when an error points at them and the invoice has them
  const other = (who, terms, name, siren, siret) => {
    if (!marked(...terms, ...terms.map((bt) => `${bt}-1`))) return "";
    if (terms.every((bt) => !t[bt])) return (terms.forEach((bt) => laid.add(bt)), "");
    return `\n    ${party(who, name, siren, siret)}`;
  };
  const doc = t["BT-3"] ? `${esc(T.doc_types[t["BT-3"]] || label("BT-3"))} (${esc(t["BT-3"])})` : show("BT-3", "");
  const title = marked("BT-3") ? `<span${attr("BT-3")}>${doc}</span>` : esc(T.doc_types[t["BT-3"]] || T.doc_types["380"]);
  const delivery = marked("BT-72") ? `<br>${esc(T.delivery)} ${field("BT-72", t["BT-72"])}` : "";
  const period = marked("BT-73", "BT-74") ? `<br>${esc(T.period)} ${field("BT-73", t["BT-73"])} – ${field("BT-74", t["BT-74"])}` : "";
  // the supporting documents: an invoiced object (type 130) with its scheme, any other with its description
  // an attached file (BT-125): its name and MIME code, the type the invoice declares for it
  const file = (d) => (d["BT-125"] || marked("BT-125") ? ` · ${field("BT-125", d["BT-125"] ? `${d["BT-125"]}${d["BT-125-1"] ? ` (${d["BT-125-1"]})` : ""}` : "")}` : "");
  let refs = "";
  if (marked("BT-18", "BT-18-1", "BT-122", "BT-123", "BT-125")) {
    const docs = (inv.documents || []).map((d) => (d.type === "130"
      ? `<div><dt>${esc(T.invoiced_object)}${d["BT-18-1"] || marked("BT-18-1") ? ` (${field("BT-18-1", d["BT-18-1"])})` : ""}</dt><dd>${field("BT-18", d["BT-122"], "BT-122")}</dd></div>`
      : `<div><dt>${esc(T.attachment)}</dt><dd>${field("BT-122", d["BT-122"])}${d["BT-123"] || marked("BT-123") ? ` · ${field("BT-123", d["BT-123"])}` : ""}${file(d)}</dd></div>`));
    refs = `\n    <dl class="inv-others"><p class="who">${esc(T.references)}</p>${docs.join("") || `<div><dt></dt><dd>${field("BT-122", "", "BT-18", "BT-18-1", "BT-123")}</dd></div>`}</dl>`;
  }
  // a group item's other details (base, rate, reason…): each one the invoice gives or an error points at
  const details = (item, bts) => bts.filter((bt) => item[bt] || marked(bt)).map((bt) => ` · ${kv(bt, item[bt])}`).join("");
  // under a line, each detail an error points at: its period, item attributes, price details, allowances and charges
  // a line's own detail shows on the lines that give it, or on every line when none does (its absence is the point)
  const here = (l, ...bts) => marked(...bts) && (bts.some((bt) => l[bt]) || !inv.lines.some((x) => bts.some((bt) => x[bt])));
  const subs = (l) => {
    const rows = [];
    // the line number, on every line when an error is about it (an empty one is the point)
    if (marked("BT-126")) rows.push(kv("BT-126", l["BT-126"]));
    if (here(l, "BT-134", "BT-135")) rows.push(`${esc(T.period)} ${field("BT-134", l["BT-134"])} – ${field("BT-135", l["BT-135"])}`);
    // the item's identifiers, with their scheme, and its country of origin
    for (const bt of ["BT-157", "BT-158", "BT-159"]) if (here(l, bt)) rows.push(`${kv(bt, l[bt])}${l[`${bt}-1`] || marked(`${bt}-1`) ? ` (${field(`${bt}-1`, l[`${bt}-1`])})` : ""}`);
    if (marked("BT-160", "BT-161")) for (const a of l.attributes || []) rows.push(`${field("BT-160", a["BT-160"])} : ${field("BT-161", a["BT-161"])}`);
    for (const bt of ["BT-148", "BT-147", "BT-149"]) if (here(l, bt)) rows.push(kv(bt, l[bt]));
    if (marked("BT-136", "BT-137", "BT-139", "BT-140")) for (const a of l.allowances || []) rows.push(`${kv("BT-136", a["BT-136"])}${details(a, ["BT-137", "BT-139", "BT-140"])}`);
    if (marked("BT-141", "BT-142", "BT-144", "BT-145")) for (const c of l.charges || []) rows.push(`${kv("BT-141", c["BT-141"])}${details(c, ["BT-142", "BT-144", "BT-145"])}`);
    return rows.map((r) => `<tr class="sub"><td colspan="5">${r}</td></tr>`).join("");
  };
  const unit = (l) => (marked("BT-130") ? `<span${cattr("unit", "BT-130")}>${show("BT-130", l["BT-130"])}</span>` : "");
  const category = (l) => (marked("BT-151") ? `<span${cattr("cat", "BT-151")}>${show("BT-151", l["BT-151"])}</span>` : "");
  const lines = inv.lines.slice(0, 12).map((l) => `<tr><td${attr("BT-153")}>${show("BT-153", l["BT-153"])}</td><td${attr("BT-129")}>${esc(l["BT-129"])}${unit(l)}</td>
      <td${attr("BT-146")}>${show("BT-146", l["BT-146"])}</td><td${attr("BT-152")}>${category(l)}${show("BT-152", l["BT-152"])}</td><td${attr("BT-131")}>${show("BT-131", l["BT-131"])}</td></tr>${subs(l)}`).join("");
  const more = inv.lines.length > 12 ? `<tr><td colspan="5" class="more">${esc(fill(T.more_lines, { n: inv.lines.length - 12 }))}</td></tr>` : "";
  // the document level allowances and charges, above the totals
  const AC = [["BT-92", "BT-93", "BT-96", "BT-95", "BT-97", "BT-98"], ["BT-99", "BT-100", "BT-103", "BT-102", "BT-104", "BT-105"]];
  let ac = "";
  if (marked(...AC.flat())) {
    const row = (x, bt) => `<div><dt>${esc(label(bt))}</dt><dd>${field(bt, x[bt])}</dd></div>`;
    const items = [[inv.allowances || [], AC[0]], [inv.charges || [], AC[1]]].flatMap(([list, [amount, ...rest]]) =>
      list.map((x) => [amount, ...rest.filter((bt) => x[bt] || marked(bt))].map((bt) => row(x, bt)).join("")));
    for (const bt of AC.flat()) laid.add(bt);
    // nothing to draw when the invoice has none (BR-51's CII message names BT-97 by mistake, for the card number)
    if (items.length) ac = `<dl class="inv-others"><p class="who">${esc(T.allowances_charges)}</p>${items.join("")}</dl>`;
  }
  const total = (bt, strong) => (shown(bt) ? `<div${strong ? ' class="strong"' : ""}><span>${esc(label(bt))}</span>${field(bt, t[bt])}</div>` : "");
  // the VAT breakdown, rate by rate
  let vat = "";
  if (marked("BT-116", "BT-117", "BT-118", "BT-119", "BT-120", "BT-121")) {
    // the exemption reason and its code; one "no value" for both when the invoice gives neither
    const why = (b) => (!b["BT-120"] && !b["BT-121"]
      ? (marked("BT-120", "BT-121") ? field("BT-120", "", "BT-121") : "")
      : `${b["BT-120"] ? field("BT-120", b["BT-120"]) : ""}${b["BT-121"] ? `${b["BT-120"] ? " " : ""}(${field("BT-121", b["BT-121"])})` : ""}`);
    // the exemption reason's column only when a rate gives one or an error is about it
    const reasons = (inv.vat_breakdown || []).some((b) => b["BT-120"] || b["BT-121"]) || marked("BT-120", "BT-121");
    const cols = T.vat_cols.split(" · ").slice(0, reasons ? 5 : 4);
    const rows = (inv.vat_breakdown || []).map((b) => `<tr><td${attr("BT-118")}>${show("BT-118", b["BT-118"])}</td><td${attr("BT-119")}>${show("BT-119", b["BT-119"])}</td><td${attr("BT-116")}>${show("BT-116", b["BT-116"])}</td><td${attr("BT-117")}>${show("BT-117", b["BT-117"])}</td>${reasons ? `<td>${why(b)}</td>` : ""}</tr>`);
    vat = `\n    <table class="inv-lines inv-vat${reasons ? " inv-why" : ""}"><caption>${esc(T.vat_breakdown)}</caption><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }
  // the notes, at the bottom: a missing note says so, a repeated one is marked, else the block as a whole
  let notes = "";
  const keys = [...marks.keys()];
  const missing = keys.filter((k) => k.startsWith("note-missing:")).map((k) => k.slice(13));
  if (marks.has("notes") || missing.length || keys.some((k) => k.startsWith("note-code:"))) {
    const rows = [...inv.notes.map((x) => `<li${attr(`note-code:${x.code}`)}>${noteLine(x.code, x.text)}</li>`), ...missing.map((c) => `<li${attr(`note-missing:${c}`)}>${noteLine(c, null)}</li>`)];
    notes = `\n    <div class="inv-notes"><p${cattr("who", "notes")}>${esc(T.notes_label)}</p><ul>${rows.join("") || `<li><em class="absent">${esc(T.no_notes)}</em></li>`}</ul></div>`;
  }
  const body = `<div class="invoice">
    <div class="inv-top">${party(T.seller, "BT-27", "BT-30", "BT-29", "BT-31", "BT-34")}
      <div class="inv-title"><p class="doc">${title}</p><p class="num">${field("BT-1", t["BT-1"])}</p>
        <p class="dates">${esc(label("BT-2"))} ${field("BT-2", t["BT-2"])}${shown("BT-9") ? `<br>${esc(label("BT-9"))} ${field("BT-9", t["BT-9"])}` : ""}${delivery}${period}</p></div></div>
    ${party(T.buyer, "BT-44", "BT-47", "BT-46", "BT-48", "BT-49")}${other(T.deliver_to, ["BT-70", "BT-71"], "BT-70", null, "BT-71")}${other(T.payee, ["BT-59", "BT-60", "BT-61"], "BT-59", "BT-61", "BT-60")}${refs}
    <table class="inv-lines"><thead><tr><th>${esc(T.col_item)}</th><th>${esc(T.col_qty)}</th><th>${esc(T.col_price)}</th><th>${esc(T.col_vat)}</th><th>${esc(T.col_net)}</th></tr></thead><tbody>${lines}${more}</tbody></table>
    ${ac}<div class="inv-totals">${total("BT-106")}${total("BT-107")}${total("BT-108")}${total("BT-109")}${total("BT-110")}${total("BT-112", true)}${total("BT-113")}${total("BT-114")}${total("BT-115", true)}</div>${vat}${notes}`;
  for (const bt of ["BT-129", "BT-146", "BT-152", "BT-131", "BT-153", "BT-130", "BT-151"]) if (inv.lines.length) laid.add(bt);
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
    // the same values as the preview's: every value of each term, an identifier with its scheme when the error is
    // about it, an invoiced object with its scheme
    const scheme = aboutScheme(g);
    const value = (bt) => {
      if (bt === "BT-18") return (inv.documents || []).filter((d) => d.type === "130").map((d) => `${show(bt, d["BT-122"])}${d["BT-18-1"] ? ` (${esc(d["BT-18-1"])})` : ""}`).join(" · ");
      const shownAs = valuesOf(inv, bt).map((v) => show(bt, v)).join(" · ");
      return scheme && inv.terms[bt] ? `${shownAs} · ${schemeOf(inv, bt)}` : shownAs;
    };
    const all = termsOf(g, pages);
    const rows = all.filter((bt) => valuesOf(inv, bt).length).map((bt) => `<div><dt>${esc(label(bt))}</dt><dd>${value(bt)}</dd></div>`);
    if (all.includes("BT-21") || all.includes("BT-22")) {
      const code = all.includes("BT-22") && noteCode(g);
      const notes = [...inv.notes.map((x) => noteLine(x.code, x.text)), ...(code ? [noteLine(code, null)] : [])];
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
