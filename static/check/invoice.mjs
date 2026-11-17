// What the invoice says, read from its XML, and the computation behind each totals rule: the values the check page
// shows next to an error. Where each business term (BT-…) is read, in CII and UBL, and the computations come from
// terms.json, the file the lintvoice command-line tool uses too (copied from its package at build time), so the page
// and the command line show the same values. The parity test compares them.

const NUMBER = /^-?\d+(\.\d+)?$/;

// The elements at the end of a path of local names ("|" for alternatives, "[@attr=value]" as a filter).
function find(el, path) {
  let nodes = [el];
  for (const step of path.split("/")) {
    const [names, condition = ""] = step.split("[@");
    const wanted = names.split("|");
    const [attr, value] = condition.replace("]", "").split("=");
    nodes = nodes.flatMap((n) => [...n.children].filter((c) => wanted.includes(c.localName) && (!attr || c.getAttribute(attr) === value)));
  }
  return nodes;
}

const text = (nodes) => (nodes.length ? nodes[0].textContent.trim() : "");

// The invoice's values: header terms (an empty string when absent), the identifier schemes given, each line's terms,
// and the notes with their subject code. Same shape as the "values" of lintvoice's JSON.
export function read(xmlText, spec) {
  const root = new DOMParser().parseFromString(xmlText, "application/xml").documentElement;
  const syntax = root.localName === "CrossIndustryInvoice" ? "CII" : "UBL";
  const terms = {};
  const schemes = {};
  for (const [bt, paths] of Object.entries(spec.header)) {
    const found = find(root, paths[syntax]);
    terms[bt] = text(found);
    if (found[0]?.getAttribute("schemeID")) schemes[bt] = found[0].getAttribute("schemeID");
  }
  const lines = find(root, spec.lines[syntax]).map((line) =>
    Object.fromEntries(Object.entries(spec.line_terms).map(([bt, paths]) => [bt, text(find(line, paths[syntax]))])),
  );
  const n = spec.notes[syntax];
  const notes = find(root, n.path).map((note) => {
    if (syntax === "CII") return { code: text(find(note, n.code)), text: text(find(note, n.text)) };
    const all = note.textContent.trim();
    const m = all.match(new RegExp(`${n.code_in_text}([\\s\\S]*)$`));
    return m ? { code: m[1], text: m[2].trim() } : { code: "", text: all };
  });
  return { syntax, terms, schemes, lines, notes };
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

// The computation a totals rule makes, with the invoice's values: parts [sign, value, BT], expected, stated and the
// gap (stated - expected). null when the rule has none or a value is not a number. Same shape as lintvoice's JSON.
export function computation(rule, values, spec) {
  const c = spec.computations[rule];
  if (!c) return null;
  const parts = c.parts.flatMap(([sign, bt, scope]) =>
    (scope ? values.lines.map((l) => l[bt] || "") : [values.terms[bt] || ""]).filter(Boolean).map((v) => [sign, v, bt]),
  );
  const stated = values.terms[c.result] || "";
  const all = [...parts.map(([, v]) => v), stated];
  if (!all.every((v) => NUMBER.test(v))) return null;
  const places = Math.max(2, ...all.map(decimals));
  const expected = parts.reduce((sum, [sign, v]) => sum + (sign === "-" ? -1n : 1n) * scaled(v, places), 0n);
  return { result: c.result, parts, expected: written(expected, places), stated, gap: written(scaled(stated, places) - expected, places) };
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
