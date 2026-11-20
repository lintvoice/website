// What the invoice says, read from its XML, and the computation behind each totals and VAT rule: the values the check page
// shows next to an error. Where each business term (BT-…) is read, in CII and UBL, and the computations come from
// terms.json, the file the lintvoice command-line tool uses too (copied from its package at build time), so the page
// and the command line show the same values. The parity test compares them.

const NUMBER = /^-?\d+(\.\d+)?$/;

// The elements at the end of a path of local names ("|" for alternatives, "[@attr=value]" as a filter); a last step
// "@name" gives that attribute's values instead.
function find(el, path) {
  let nodes = [el];
  for (const step of path.split("/")) {
    if (step.startsWith("@")) return nodes.filter((n) => n.hasAttribute(step.slice(1))).map((n) => n.getAttribute(step.slice(1)));
    const [names, condition = ""] = step.split("[@");
    const wanted = names.split("|");
    const [attr, value] = condition.replace("]", "").split("=");
    nodes = nodes.flatMap((n) => [...n.children].filter((c) => wanted.includes(c.localName) && (!attr || c.getAttribute(attr) === value)));
  }
  return nodes;
}

// What the first path that finds something finds: a term's path, or its list of paths.
function first(el, paths) {
  for (const path of typeof paths === "string" ? [paths] : paths) {
    const found = find(el, path);
    if (found.length) return found;
  }
  return [];
}

const text = (nodes) => (!nodes.length ? "" : (typeof nodes[0] === "string" ? nodes[0] : nodes[0].textContent).trim());

// A group item's terms; a term with no path for this syntax is not read.
const termsOf = (node, spec, syntax) =>
  Object.fromEntries(Object.entries(spec).filter(([, paths]) => syntax in paths).map(([bt, paths]) => [bt, text(first(node, paths[syntax]))]));

// The allowances and the charges under a node (the invoice, or a line), told apart by their charge indicator.
function split(node, ac, allowanceTerms, chargeTerms, syntax) {
  const allowances = [];
  const charges = [];
  for (const item of find(node, ac[syntax].path)) {
    if (text(find(item, ac[syntax].charge)).toLowerCase() === "true") charges.push(termsOf(item, chargeTerms, syntax));
    else allowances.push(termsOf(item, allowanceTerms, syntax));
  }
  return [allowances, charges];
}

// The invoice's values: header terms (an empty string when absent), the identifier schemes given, each line's terms
// with its allowances, charges and item attributes, the notes with their subject code, the VAT breakdown, the document
// level allowances and charges, and the additional supporting documents. Same shape as the "values" of lintvoice's JSON.
export function read(xmlText, spec) {
  const root = new DOMParser().parseFromString(xmlText, "application/xml").documentElement;
  const syntax = root.localName === "CrossIndustryInvoice" ? "CII" : "UBL";
  const terms = {};
  const schemes = {};
  for (const [bt, paths] of Object.entries(spec.header)) {
    if (!(syntax in paths)) continue;
    const found = first(root, paths[syntax]);
    terms[bt] = text(found);
    if (typeof found[0] === "object" && found[0].getAttribute("schemeID")) schemes[bt] = found[0].getAttribute("schemeID");
  }
  const lines = find(root, spec.lines[syntax]).map((line) => {
    const [allowances, charges] = split(line, spec.line_allowances_charges, spec.line_allowance_terms, spec.line_charge_terms, syntax);
    const attributes = find(line, spec.line_attributes[syntax]).map((a) => termsOf(a, spec.line_attribute_terms, syntax));
    return { ...termsOf(line, spec.line_terms, syntax), allowances, charges, attributes };
  });
  const breakdown = find(root, spec.vat_breakdown[syntax]).map((tax) => termsOf(tax, spec.vat_breakdown_terms, syntax));
  const [allowances, charges] = split(root, spec.allowances_charges, spec.allowance_terms, spec.charge_terms, syntax);
  const documents = find(root, spec.documents[syntax]).map((d) => termsOf(d, spec.document_terms, syntax));
  const n = spec.notes[syntax];
  const notes = find(root, n.path).map((note) => {
    if (syntax === "CII") return { code: text(find(note, n.code)), text: text(find(note, n.text)) };
    const all = note.textContent.trim();
    const m = all.match(new RegExp(`${n.code_in_text}([\\s\\S]*)$`));
    return m ? { code: m[1], text: m[2].trim() } : { code: "", text: all };
  });
  return { syntax, terms, schemes, lines, notes, vat_breakdown: breakdown, allowances, charges, documents };
}

// Exact decimals: each amount as an integer of 10^-places, places being the most decimals any amount carries (two
// at least), written back with that many decimals, as lintvoice does.
const decimals = (v) => (v.split(".")[1] || "").length;
function scaled(v, places) {
  const [w, d = ""] = v.replace("-", "").split(".");
  const n = BigInt(w + d.padEnd(places, "0"));
  return v.startsWith("-") ? -n : n;
}
function written(n, places) {
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(places + 1, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -places)}.${digits.slice(-places)}`;
}

// Exact decimals as [integer, scale]: 12.5 is [125n, 1].
const exact = (v) => [scaled(v, decimals(v)), decimals(v)];
const align = ([n, s], scale) => n * 10n ** BigInt(scale - s);
const add = (a, b) => { const s = Math.max(a[1], b[1]); return [align(a, s) + align(b, s), s]; };
const negate = ([n, s]) => [-n, s];
const absolute = (n) => (n < 0n ? -n : n);
// To `places` decimals: half away from zero (the rules' rounding) or half to even (Python's formatting of a decimal).
function rounded([n, s], places, even = false) {
  if (s <= places) return [align([n, s], places), places];
  const unit = 10n ** BigInt(s - places);
  let q = absolute(n) / unit;
  const twice = 2n * (absolute(n) % unit);
  if (twice > unit || (twice === unit && (!even || q % 2n === 1n))) q += 1n;
  return [n < 0n ? -q : q, places];
}
const writtenAt = (x, places) => written(rounded(x, places, true)[0], places);

// Two values of the invoice match: as numbers when both are (a rate 20 is 20.00), else as written.
function same(a, b) {
  const [x, y] = [(a ?? "").trim(), (b ?? "").trim()];
  if (NUMBER.test(x) && NUMBER.test(y)) { const s = Math.max(decimals(x), decimals(y)); return align(exact(x), s) === align(exact(y), s); }
  return x === y;
}

const SCOPES = { "each line": "lines", "each charge": "charges", "each allowance": "allowances", "each VAT breakdown": "vat_breakdown" };

// One computation, on the header terms or on one group item (a VAT breakdown): null when a value is not a number.
function compute(c, values, item = null) {
  const source = item ?? values.terms;
  const parts = c.parts.flatMap(([sign, bt, scope, match = {}]) => {
    const sources = scope
      ? (values[SCOPES[scope]] || []).filter((row) => Object.entries(match).every(([mine, theirs]) => same(row[mine], (item || {})[theirs]))).map((row) => row[bt] ?? "")
      : [bt in source ? source[bt] : (values.terms[bt] ?? "")];
    return sources.filter(Boolean).map((v) => [sign, v, bt]);
  });
  const stated = source[c.result] ?? "";
  const all = [...parts.map(([, v]) => v), stated];
  if (!all.every((v) => NUMBER.test(v))) return null;
  const places = Math.max(2, ...all.map(decimals));
  let expected = [0n, 0];
  for (const [sign, v] of parts) {
    if (sign === "×") { const [n, s] = exact(v); expected = [expected[0] * n, expected[1] + s + 2]; }
    else expected = add(expected, sign === "-" ? negate(exact(v)) : exact(v));
  }
  if ("round" in c) expected = rounded(expected, c.round);
  const gap = add(exact(stated), negate(expected));
  const calc = { result: c.result, parts, expected: writtenAt(expected, places), stated, gap: writtenAt(gap, places) };
  if (item) calc.group = { ...item };
  return calc;
}

// How far an item's stated amount is from its expected amount, as its rule measures it: without the signs when the rule
// compares absolute values ("absolute": BR-CO-17 and BR-S-09 accept a VAT amount whose sign differs from its base's,
// so a breakdown with only its sign flipped passes them). On a common scale, beyond any amount's decimals.
function deviation(calc, c) {
  let [stated, expected] = [exact(calc.stated), exact(calc.expected)];
  if (c.absolute) [stated, expected] = [[absolute(stated[0]), stated[1]], [absolute(expected[0]), expected[1]]];
  return absolute(align(add(stated, negate(expected)), 40));
}

// The computation a totals or VAT rule makes, with the invoice's values: parts [sign, value, BT], expected, stated and
// the gap (stated - expected); for a rule checked per VAT breakdown, the breakdown furthest from its expected amount as
// the rule measures it (the one the rule rejects), as group. null when the rule has none or a value is not a number.
// Same shape as lintvoice's JSON.
export function computation(rule, values, spec) {
  const c = spec.computations[rule];
  if (!c) return null;
  if (!c.each) return compute(c, values);
  const items = (values[c.each] || []).filter((item) => Object.entries(c.where || {}).every(([bt, v]) => same(item[bt], v)));
  let best = null;
  let bestDeviation = -1n;
  for (const item of items) {
    const calc = compute(c, values, item);
    if (!calc) continue;
    const d = deviation(calc, c);
    if (d > bestDeviation) [best, bestDeviation] = [calc, d];
  }
  return best;
}

export function money(v, lang, currency = "EUR") {
  if (!v) return null;
  if (!NUMBER.test(v)) return v; // shown as written: the format itself may be the error
  const [w, d = ""] = v.replace("-", "").split(".");
  const sep = lang === "fr" ? " " : ",";
  const dec = lang === "fr" ? "," : ".";
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return `${v.startsWith("-") ? "−" : ""}${grouped}${dec}${(d || "00").padEnd(2, "0")} ${!currency || currency === "EUR" ? "€" : currency}`;
}

export function day(v, lang) {
  if (!/^\d{8}$/.test(v || "") && !/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return v || null;
  const s = v.replace(/-/g, "");
  return lang === "fr" ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
