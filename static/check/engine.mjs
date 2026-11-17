// lintvoice's check in the browser: a port of lintvoice's document.py, engine.py and report.py, with the same
// official rule files, compiled for SaxonJS, and the same XSD files, validated by libxml2 in WebAssembly. Nothing
// leaves the page: the invoice is read from the visitor's computer and checked here.
//
// Two limits keep the page responsive. SaxonJS needs the DOM, so the rules run in the page itself, and their time
// grows faster than the invoice: at most MAX_LINES lines (300 lines take about 1.3 to 2 s on a desktop browser).
// A PDF's attached files are inflated by our own stream, stopped at MAX_ATTACHMENT_BYTES, before pdf.js reads
// them, so that a small PDF cannot unfold into gigabytes.
import { validateXML, memoryPages } from "./vendor/index-browser.mjs";
import * as pdfjs from "./vendor/pdf.min.mjs";
import { computation, read } from "./invoice.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;

const CII_NS = "urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100";
const RAM = "urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100";
const UBL_INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const UBL_CREDIT_NOTE_NS = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
const CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
const CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const SVRL = "http://purl.oclc.org/dsdl/svrl";
const EMBEDDED_NAMES = ["factur-x.xml", "zugferd-invoice.xml", "ZUGFeRD-invoice.xml", "xrechnung.xml"];
const PROFILES = {
  "urn:factur-x.eu:1p0:minimum": "minimum",
  "urn:factur-x.eu:1p0:basicwl": "basicwl",
  "urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic": "basic",
  "urn:cen.eu:en16931:2017": "en16931",
  "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended": "extended",
  "urn:cen.eu:en16931:2017#conformant#urn.cpro.gouv.fr:1p0:extended-ctc-fr": "extended-ctc-fr",
  "urn:ferd:CrossIndustryDocument:invoice:1p0:comfort": "zugferd-comfort",
};
const PROFILE_PREFIXES = {
  "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung": "xrechnung",
  "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0": "peppol",
};
const FACTURX_DIRS = { basicwl: "BASICWL", en16931: "EN16931", extended: "EXTENDED" };
const FX_LABEL = { basicwl: "BASIC WL", en16931: "EN 16931", extended: "EXTENDED" };
const NOT_FULL_INVOICE = ["minimum", "basicwl"];
const DOCTYPE_REFUSED =
  "declares a DOCTYPE: e-invoices never do, and lintvoice refuses it so that no file can make it read other files or reach the network";
const LAYER_ORDER = { en16931: 0, "factur-x": 1, "br-fr": 2, "extended-ctc-fr": 3, xsd: 4 };
export const MAX_LINES = 300;
export const MAX_ATTACHMENT_BYTES = 5_000_000; // about 14 times a 300-line invoice

class NotAnInvoice extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // for the page, which says it in the visitor's language
  }
}

// Each stream of the PDF that declares itself an attached file (/Type /EmbeddedFile), inflated as a stream and
// stopped past the limit. A stream objects cannot sit inside an object stream, so its dictionary is in clear.
async function guardAttachments(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  const objects = /\d+\s+\d+\s+obj\s*<<([\s\S]*?)>>\s*stream\r?\n/g;
  for (let m; (m = objects.exec(text)); ) {
    const dict = m[1];
    if (!/\/Type\s*\/EmbeddedFile\b/.test(dict)) continue;
    // The stream's bytes: its /Length when the PDF gives it as a number, else up to "endstream" without the line end
    // before it. Those extra bytes matter: Firefox stops inflating at once on input after the end of the data.
    const start = m.index + m[0].length;
    const length = [...dict.matchAll(/\/Length\s+(\d+)(\s+\d+\s+R)?/g)].at(-1);
    let end;
    if (length && !length[2]) end = Math.min(start + Number(length[1]), bytes.length);
    else {
      end = text.indexOf("endstream", start);
      if (end === -1) end = bytes.length;
      while (end > start && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end--;
    }
    const data = bytes.subarray(start, end);
    let size = 0;
    if (/\/FlateDecode\b/.test(dict)) {
      const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
      try {
        for (let r; !(r = await reader.read()).done; ) {
          size += r.value.length;
          if (size > MAX_ATTACHMENT_BYTES) break;
        }
      } catch {
        // a damaged stream: pdf.js will say the PDF cannot be read
      } finally {
        reader.cancel().catch(() => {});
      }
    } else {
      size = data.length;
    }
    if (size > MAX_ATTACHMENT_BYTES)
      throw new NotAnInvoice("attachment-too-large", `an attached file is larger than ${MAX_ATTACHMENT_BYTES / 1e6} MB once decompressed`);
  }
}

const base = new URL(".", import.meta.url);
let manifest;

async function xmlFromPdf(bytes) {
  await guardAttachments(bytes);
  // pdf.js 6 lists attachments as a Map (id -> {filename, ...}) and reads a content only when asked.
  try {
    const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const byName = new Map();
    for (const [id, a] of (await pdf.getAttachments()) || []) byName.set(a.filename, id);
    const names = [...byName.keys()];
    const name = EMBEDDED_NAMES.find((n) => names.includes(n)) || names.find((n) => n.toLowerCase().endsWith(".xml"));
    if (!name) return null;
    return { xml: new Uint8Array(await pdf.getAttachmentContent(byName.get(name))), name };
  } catch (e) {
    throw new NotAnInvoice("pdf-unreadable", `cannot read this PDF (${e.message})`);
  }
}

function profileOf(spec) {
  if (spec in PROFILES) return PROFILES[spec];
  for (const [prefix, p] of Object.entries(PROFILE_PREFIXES)) if (spec.startsWith(prefix)) return p;
  return "unknown";
}

function childText(el, steps) {
  let cur = el;
  for (const [ns, name] of steps) {
    cur = cur && [...cur.children].find((c) => c.namespaceURI === ns && c.localName === name);
  }
  return cur ? cur.textContent.trim() : "";
}

export async function load(name, bytes) {
  let source = "XML";
  if (new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") {
    const found = await xmlFromPdf(bytes);
    if (!found) throw new NotAnInvoice("no-xml", "this PDF has no embedded invoice XML (not a Factur-X, ZUGFeRD or XRechnung PDF)");
    bytes = found.xml;
    source = `PDF (${found.name})`;
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.slice(3);
  const text = new TextDecoder().decode(bytes);
  // Refused before parsing, as the CLI does: a DOCTYPE in the prolog (before the root element) is never parsed, so
  // its entities are never expanded (billion laughs) and its DTD never fetched.
  const prolog = text.slice(0, text.search(/<[A-Za-z_]/) === -1 ? text.length : text.search(/<[A-Za-z_]/));
  if (/<!DOCTYPE/i.test(prolog)) throw new NotAnInvoice("doctype", DOCTYPE_REFUSED);
  const lines = (text.match(/<(?:[\w.-]+:)?(?:IncludedSupplyChainTradeLineItem|InvoiceLine|CreditNoteLine)[\s>]/g) || []).length;
  if (lines > MAX_LINES)
    throw new NotAnInvoice("too-large", `${lines} lines: more than ${MAX_LINES}, too many for a check in the browser`);
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const error = doc.getElementsByTagName("parsererror")[0];
  if (error) throw new NotAnInvoice("not-well-formed", `not well-formed XML (${error.textContent.trim().split("\n")[0]})`);
  if (doc.doctype) throw new NotAnInvoice("doctype", DOCTYPE_REFUSED);
  const root = doc.documentElement;
  let syntax, spec, country;
  if (root.namespaceURI === CII_NS) {
    syntax = "CII";
    const ctx = [...root.children].find((c) => c.localName === "ExchangedDocumentContext");
    spec = ctx ? childText(ctx, [[RAM, "GuidelineSpecifiedDocumentContextParameter"], [RAM, "ID"]]) : "";
    const seller = [...root.getElementsByTagNameNS(RAM, "SellerTradeParty")].find((s) => s.parentElement.localName === "ApplicableHeaderTradeAgreement");
    country = seller ? childText(seller, [[RAM, "PostalTradeAddress"], [RAM, "CountryID"]]) : "";
  } else if (root.namespaceURI === UBL_INVOICE_NS || root.namespaceURI === UBL_CREDIT_NOTE_NS) {
    syntax = "UBL";
    spec = childText(root, [[CBC, "CustomizationID"]]);
    country = childText(root, [[CAC, "AccountingSupplierParty"], [CAC, "Party"], [CAC, "PostalAddress"], [CAC, "Country"], [CBC, "IdentificationCode"]]);
  } else {
    throw new NotAnInvoice("not-invoice", `not a CII or UBL invoice (root element '${root.localName}')`);
  }
  const profile = profileOf(spec);
  const d = { path: name, xml: text, source, syntax, profile, specification_id: spec, seller_country: country || null, root: root.localName };
  d.facturx = !["xrechnung", "peppol"].includes(profile) && syntax === "CII" && (source.startsWith("PDF") || spec.includes("factur-x") || profile === "extended-ctc-fr");
  return d;
}

// A port of engine.select(), "auto" rules only.
export function select(d) {
  const notes = [];
  const wanted = new Set(["en16931", "factur-x", "br-fr"]);
  if (d.seller_country === "FR") notes.push("BR-FR rules applied: the seller's country is FR.");
  else {
    wanted.delete("br-fr");
    if (d.profile !== "minimum")
      notes.push(`BR-FR rules not applied: the seller's country is ${d.seller_country || "not given"} (--rules en16931,factur-x,br-fr applies them).`);
  }
  const sets = [];
  const full = !NOT_FULL_INVOICE.includes(d.profile);
  if (d.syntax === "CII") {
    const fx = FACTURX_DIRS[d.profile];
    if (d.facturx && fx) {
      sets.push({ id: "xsd", name: `Factur-X 1.09.2 ${FX_LABEL[d.profile]} schema`, kind: "xsd", top: `Factur-X/${fx}/1xsd`, main: `Factur-X/${fx}/1xsd/Factur-X_${fx}.xsd` });
    } else {
      sets.push({ id: "xsd", name: "CII D22B schema", kind: "xsd", top: "CII/1xsd-CII_D22B_uncoupled", main: "CII/1xsd-CII_D22B_uncoupled/CrossIndustryInvoice_100pD22B.xsd" });
    }
    if (full && wanted.has("en16931")) sets.push({ id: "en16931", name: "EN 16931 1.3.17 (CII)", sef: "en16931-cii" });
    if (d.facturx && wanted.has("factur-x")) {
      if (fx) sets.push({ id: "factur-x", name: `Factur-X 1.09.2 ${FX_LABEL[d.profile]}`, sef: `facturx-${d.profile}` });
      else if (["minimum", "basic"].includes(d.profile))
        notes.push(`No Factur-X ${d.profile.toUpperCase()} profile rules in France_RFE 1.4.0.04: profile rules skipped.`);
    }
    if (wanted.has("br-fr") && d.profile !== "minimum") {
      sets.push({ id: "br-fr", name: "BR-FR 1.4.0.04 (CII)", sef: "br-fr-cii" });
      if (d.profile === "extended-ctc-fr") sets.push({ id: "extended-ctc-fr", name: "EXTENDED-CTC-FR 1.4.0.04 (CII)", sef: "extended-ctc-fr" });
    }
  } else {
    sets.push({ id: "xsd", name: "UBL 2.1 schema", kind: "xsd", top: "UBL/1xsd_UBL2.1", main: `UBL/1xsd_UBL2.1/maindoc/UBL-${d.root}-2.1.xsd` });
    if (wanted.has("en16931")) sets.push({ id: "en16931", name: "EN 16931 1.3.17 (UBL)", sef: "en16931-ubl" });
    if (wanted.has("br-fr")) sets.push({ id: "br-fr", name: "BR-FR 1.4.0.04 (UBL)", sef: "br-fr-ubl" });
  }
  if (["xrechnung", "peppol"].includes(d.profile))
    notes.push(`${d.profile === "xrechnung" ? "XRechnung" : "Peppol BIS"} rules are not in this version: only EN 16931 was checked.`);
  if (d.profile === "unknown") notes.push(`Unknown specification identifier (BT-24) '${d.specification_id}': EN 16931 rules only.`);
  return { sets, notes };
}

const STEP = /^(?:\*:|Q\{[^}]*\})([A-Za-z0-9_.-]+)(?:\[namespace-uri\(\)='[^']*'\])?(?:\[(\d+)\])?$/;
export function prettyLocation(location) {
  if (!location) return "";
  return "/" + location.split("/").slice(1).map((part) => {
    const m = part.match(STEP);
    if (!m) return part;
    return m[2] && m[2] !== "1" ? `${m[1]}[${m[2]}]` : m[1];
  }).join("/");
}

function clean(text) {
  text = text.split(/\s+/).filter(Boolean).join(" ");
  text = text.replace(/^\[[A-Z0-9_-]+\]\s*-\s*/, "");
  return text.replace(/^BR-FR[A-Z]*-[0-9A-Z]+\/([A-Z0-9-]+)\s*:\s*/, "$1: ");
}

// Downloads are kept for the next checks; a failed one is forgotten, so that a passing network error does not fail
// every later check in the same visit.
function cached(cache, key, load) {
  if (!cache.has(key)) {
    const pending = load();
    pending.catch(() => cache.delete(key));
    cache.set(key, pending);
  }
  return cache.get(key);
}

async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

// Where each business term is read and the totals computations: lintvoice's own terms.json, copied at build time.
const termsCache = new Map();
const terms = () => cached(termsCache, "terms", () => download(new URL("terms.json", base)).then((r) => r.json()));

const fileCache = new Map();
async function fetchText(path) {
  return cached(fileCache, path, () => download(new URL(path, base)).then((r) => r.text()));
}

async function runXsd(set, d) {
  manifest ??= await (await download(new URL("xsd/manifest.json", base))).json();
  const files = manifest[set.main];
  const preload = await Promise.all(files.map(async (f) => ({ fileName: f, contents: await fetchText(`xsd/${f}`) })));
  const main = preload.find((f) => f.fileName === set.main);
  const result = await validateXML({
    xml: [{ fileName: "invoice.xml", contents: d.xml }],
    schema: [main],
    preload: preload.filter((f) => f !== main),
    initialMemoryPages: 256,
    maxMemoryPages: memoryPages.GiB,
  });
  if (result.valid) return [];
  return result.errors.filter((e) => e.loc && e.loc.fileName === "invoice.xml").map((e) => ({
    rule: "XSD",
    severity: "error",
    message: e.message.replace(/^.*?Schemas validity error : /, "").replace(/\{[^}]*\}/g, ""),
    location: `line ${e.loc.lineNumber}`,
    rule_set: set.id,
  }));
}

const stylesheets = new Map();
async function runSchematron(set, d) {
  // Each compiled rule set is fetched and parsed once, then reused for every file.
  const url = new URL(`sef/${set.sef}.sef.json`, base).href;
  const json = await cached(stylesheets, set.sef, () => download(url).then((r) => r.json()));
  const result = await SaxonJS.transform(
    { stylesheetInternal: json, stylesheetBaseURI: url, sourceText: d.xml, destination: "serialized" },
    "async",
  );
  const svrl = new DOMParser().parseFromString(result.principalResult, "application/xml");
  const findings = [];
  for (const f of svrl.getElementsByTagNameNS(SVRL, "*")) {
    if (f.localName !== "failed-assert" && f.localName !== "successful-report") continue;
    const flag = (f.getAttribute("flag") || "fatal").toLowerCase();
    const textEl = [...f.children].find((c) => c.localName === "text");
    findings.push({
      rule: f.getAttribute("id") || `${set.id}:no-id`,
      severity: flag === "fatal" || flag === "error" ? "error" : "warning",
      message: clean(textEl ? textEl.textContent : ""),
      location: prettyLocation(f.getAttribute("location") || ""),
      rule_set: set.id,
    });
  }
  return findings;
}

function group(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.rule}\u0000${f.severity}`;
    if (!groups.has(key)) groups.set(key, { rule: f.rule, severity: f.severity, rule_set: f.rule_set, messages: new Map() });
    const g = groups.get(key);
    if (!g.messages.has(f.message)) g.messages.set(f.message, []);
    g.messages.get(f.message).push(f.location);
  }
  const sev = { error: 0, warning: 1 };
  return [...groups.values()].sort((a, b) =>
    sev[a.severity] - sev[b.severity] || (LAYER_ORDER[a.rule_set] ?? 9) - (LAYER_ORDER[b.rule_set] ?? 9) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
}

// The same JSON as one entry of `lintvoice check --format json`'s "files".
export async function check(name, bytes) {
  let d;
  try {
    d = await load(name, bytes);
  } catch (e) {
    if (e instanceof NotAnInvoice) return { path: name, status: e.code === "too-large" ? "too-large" : "unreadable", code: e.code, error: e.message };
    throw e;
  }
  const { sets, notes } = select(d);
  const findings = [], seen = new Map(), notRun = [];
  const timings = {};
  for (const set of sets) {
    const t0 = performance.now();
    let found;
    const run = () => (set.kind === "xsd" ? runXsd(set, d) : runSchematron(set, d));
    try {
      // A rule set that fails is tried once more (a passing network or browser error) before the check is
      // reported as incomplete.
      found = await run().catch(() => run());
    } catch (e) {
      notRun.push({ rule_set: set.id, name: set.name, error: String(e.message || e).split(/\s+/).join(" ") });
      continue;
    } finally {
      timings[set.id] = Math.round(performance.now() - t0);
    }
    for (const f of found) {
      if (!seen.has(f.rule)) seen.set(f.rule, set.id);
      if (seen.get(f.rule) === set.id) findings.push(f);
    }
  }
  const errors = findings.filter((f) => f.severity === "error");
  let spec = null;
  let values = null;
  try {
    spec = await terms();
    values = read(d.xml, spec);
  } catch {
    // the values are an aid: a file the rules could check never fails for them
  }
  return {
    path: name,
    status: errors.length ? "errors" : notRun.length ? "incomplete" : "ok",
    document: { syntax: d.syntax, profile: d.profile, specification_id: d.specification_id, source: d.source, seller_country: d.seller_country },
    rule_sets: sets.map((s) => ({ id: s.id, name: s.name })),
    notes,
    not_run: notRun,
    summary: { errors: errors.length, warnings: findings.length - errors.length, rules_failed: new Set(errors.map((f) => f.rule)).size },
    findings: group(findings).map((g) => {
      const calc = values && computation(g.rule, values, spec);
      return {
        rule: g.rule, severity: g.severity, rule_set: g.rule_set,
        count: [...g.messages.values()].reduce((n, l) => n + l.length, 0),
        messages: [...g.messages.entries()].map(([message, locations]) => ({ message, locations })),
        ...(calc ? { computation: calc } : {}),
      };
    }),
    // what the invoice says, read as lintvoice reads it (terms.json): to show an error with the invoice's values
    values,
    timings_ms: timings,
  };
}
