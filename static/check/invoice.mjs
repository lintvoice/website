// What the invoice says, read from its XML: the values the check page shows (detected data, the invoice preview,
// the values behind an error). Business terms (BT-…) are the numbers EN 16931 gives each piece of data.

// Header-level terms: a path of element local names from the root, for CII and UBL. "@schemeID=X" filters on the
// attribute. Line-level terms are read per line (LINE).
const PATHS = {
  CII: {
    "BT-1": "ExchangedDocument/ID",
    "BT-2": "ExchangedDocument/IssueDateTime/DateTimeString",
    "BT-3": "ExchangedDocument/TypeCode",
    "BT-5": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/InvoiceCurrencyCode",
    "BT-7": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/ApplicableTradeTax/TaxPointDate/DateString",
    "BT-9": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradePaymentTerms/DueDateDateTime/DateTimeString",
    "BT-13": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/BuyerOrderReferencedDocument/IssuerAssignedID",
    "BT-23": "ExchangedDocumentContext/BusinessProcessSpecifiedDocumentContextParameter/ID",
    "BT-25": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/InvoiceReferencedDocument/IssuerAssignedID",
    "BT-26": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/InvoiceReferencedDocument/FormattedIssueDateTime/DateTimeString",
    "BT-27": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/SellerTradeParty/Name",
    "BT-29": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/SellerTradeParty/GlobalID[@schemeID=0009]",
    "BT-30": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/SellerTradeParty/SpecifiedLegalOrganization/ID",
    "BT-31": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/SellerTradeParty/SpecifiedTaxRegistration/ID[@schemeID=VA]",
    "BT-34": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/SellerTradeParty/URIUniversalCommunication/URIID",
    "BT-40": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/SellerTradeParty/PostalTradeAddress/CountryID",
    "BT-44": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/BuyerTradeParty/Name",
    "BT-46": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/BuyerTradeParty/GlobalID[@schemeID=0009]",
    "BT-47": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/BuyerTradeParty/SpecifiedLegalOrganization/ID",
    "BT-48": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/BuyerTradeParty/SpecifiedTaxRegistration/ID[@schemeID=VA]",
    "BT-49": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/BuyerTradeParty/URIUniversalCommunication/URIID",
    "BT-55": "SupplyChainTradeTransaction/ApplicableHeaderTradeAgreement/BuyerTradeParty/PostalTradeAddress/CountryID",
    "BT-106": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation/LineTotalAmount",
    "BT-107": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation/AllowanceTotalAmount",
    "BT-108": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation/ChargeTotalAmount",
    "BT-109": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation/TaxBasisTotalAmount",
    "BT-110": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation/TaxTotalAmount",
    "BT-112": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation/GrandTotalAmount",
    "BT-113": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation/TotalPrepaidAmount",
    "BT-114": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation/RoundingAmount",
    "BT-115": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/SpecifiedTradeSettlementHeaderMonetarySummation/DuePayableAmount",
    "BT-117": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/ApplicableTradeTax/CalculatedAmount",
    "BT-119": "SupplyChainTradeTransaction/ApplicableHeaderTradeSettlement/ApplicableTradeTax/RateApplicablePercent",
    LINE: "SupplyChainTradeTransaction/IncludedSupplyChainTradeLineItem",
    "BT-153": "SpecifiedTradeProduct/Name",
    "BT-129": "SpecifiedLineTradeDelivery/BilledQuantity",
    "BT-146": "SpecifiedLineTradeAgreement/NetPriceProductTradePrice/ChargeAmount",
    "BT-152": "SpecifiedLineTradeSettlement/ApplicableTradeTax/RateApplicablePercent",
    "BT-131": "SpecifiedLineTradeSettlement/SpecifiedTradeSettlementLineMonetarySummation/LineTotalAmount",
  },
  UBL: {
    "BT-1": "ID",
    "BT-2": "IssueDate",
    "BT-3": "InvoiceTypeCode",
    "BT-5": "DocumentCurrencyCode",
    "BT-7": "TaxPointDate",
    "BT-9": "DueDate",
    "BT-13": "OrderReference/ID",
    "BT-23": "ProfileID",
    "BT-25": "BillingReference/InvoiceDocumentReference/ID",
    "BT-26": "BillingReference/InvoiceDocumentReference/IssueDate",
    "BT-27": "AccountingSupplierParty/Party/PartyLegalEntity/RegistrationName",
    "BT-29": "AccountingSupplierParty/Party/PartyIdentification/ID",
    "BT-30": "AccountingSupplierParty/Party/PartyLegalEntity/CompanyID",
    "BT-31": "AccountingSupplierParty/Party/PartyTaxScheme/CompanyID",
    "BT-34": "AccountingSupplierParty/Party/EndpointID",
    "BT-40": "AccountingSupplierParty/Party/PostalAddress/Country/IdentificationCode",
    "BT-44": "AccountingCustomerParty/Party/PartyLegalEntity/RegistrationName",
    "BT-46": "AccountingCustomerParty/Party/PartyIdentification/ID",
    "BT-47": "AccountingCustomerParty/Party/PartyLegalEntity/CompanyID",
    "BT-48": "AccountingCustomerParty/Party/PartyTaxScheme/CompanyID",
    "BT-49": "AccountingCustomerParty/Party/EndpointID",
    "BT-55": "AccountingCustomerParty/Party/PostalAddress/Country/IdentificationCode",
    "BT-106": "LegalMonetaryTotal/LineExtensionAmount",
    "BT-107": "LegalMonetaryTotal/AllowanceTotalAmount",
    "BT-108": "LegalMonetaryTotal/ChargeTotalAmount",
    "BT-109": "LegalMonetaryTotal/TaxExclusiveAmount",
    "BT-110": "TaxTotal/TaxAmount",
    "BT-112": "LegalMonetaryTotal/TaxInclusiveAmount",
    "BT-113": "LegalMonetaryTotal/PrepaidAmount",
    "BT-114": "LegalMonetaryTotal/PayableRoundingAmount",
    "BT-115": "LegalMonetaryTotal/PayableAmount",
    "BT-117": "TaxTotal/TaxSubtotal/TaxAmount",
    "BT-119": "TaxTotal/TaxSubtotal/TaxCategory/Percent",
    LINE: "InvoiceLine|CreditNoteLine",
    "BT-153": "Item/Name",
    "BT-129": "InvoicedQuantity|CreditedQuantity",
    "BT-146": "Price/PriceAmount",
    "BT-152": "Item/ClassifiedTaxCategory/Percent",
    "BT-131": "LineExtensionAmount",
  },
};
const LINE_TERMS = ["BT-153", "BT-129", "BT-146", "BT-152", "BT-131"];

function find(el, path) {
  let nodes = [el];
  for (const step of path.split("/")) {
    const [names, filter] = step.split("[@");
    const wanted = names.split("|");
    const [attr, value] = filter ? filter.replace("]", "").split("=") : [];
    nodes = nodes.flatMap((n) => [...n.children].filter((c) => wanted.includes(c.localName) && (!attr || c.getAttribute(attr) === value)));
  }
  return nodes;
}

export function read(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const root = doc.documentElement;
  const syntax = root.localName === "CrossIndustryInvoice" ? "CII" : "UBL";
  const paths = PATHS[syntax];
  const terms = {};
  const schemes = {}; // the identifier scheme, when the invoice gives one: 0002 is a SIREN, 0009 a SIRET
  for (const [bt, path] of Object.entries(paths)) {
    if (bt === "LINE" || LINE_TERMS.includes(bt)) continue;
    // BT-110: the VAT total in the invoice currency (CII may give a second one in the VAT accounting currency)
    const found = find(root, path);
    terms[bt] = found.length ? found[0].textContent.trim() : "";
    if (found[0]?.getAttribute("schemeID")) schemes[bt] = found[0].getAttribute("schemeID");
  }
  const lines = find(root, paths.LINE).map((line) =>
    Object.fromEntries(LINE_TERMS.map((bt) => [bt, (find(line, paths[bt])[0]?.textContent || "").trim()])),
  );
  // invoice notes (BT-22), with their subject code (BT-21); UBL puts the code in the text: "#PMT#…"
  const notes = syntax === "CII"
    ? find(root, "ExchangedDocument/IncludedNote").map((n) => ({ code: (find(n, "SubjectCode")[0]?.textContent || "").trim(), text: (find(n, "Content")[0]?.textContent || "").trim() }))
    : find(root, "Note").map((n) => { const m = n.textContent.trim().match(/^#(\w+)#([\s\S]*)$/); return m ? { code: m[1], text: m[2].trim() } : { code: "", text: n.textContent.trim() }; });
  return { syntax, terms, schemes, lines, notes };
}

// Amounts as integers of a thousandth, so that sums are exact.
function milli(v) {
  if (!/^-?\d+(\.\d+)?$/.test(v || "")) return null;
  const [w, d = ""] = v.replace("-", "").split(".");
  const n = BigInt(w) * 1000n + BigInt((d + "000").slice(0, 3));
  return v.startsWith("-") ? -n : n;
}

export function money(v, lang, currency = "EUR") {
  if (!v) return null;
  if (!/^-?\d+(\.\d+)?$/.test(v)) return v; // shown as written: the format itself may be the error
  const [w, d = ""] = v.replace("-", "").split(".");
  const sep = lang === "fr" ? " " : ",";
  const dec = lang === "fr" ? "," : ".";
  const grouped = w.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return `${v.startsWith("-") ? "−" : ""}${grouped}${dec}${(d || "00").padEnd(2, "0")} ${!currency || currency === "EUR" ? "€" : currency}`;
}

export function day(v, lang) {
  if (!/^\d{8}$/.test(v || "") && !/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return v || null;
  const s = v.replace(/-/g, "");
  return lang === "fr" ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const fromMilli = (n) => {
  const neg = n < 0n, a = neg ? -n : n;
  return `${neg ? "-" : ""}${a / 1000n}.${String(a % 1000n).padStart(3, "0").replace(/0$/, "")}`;
};

// For the arithmetic rules: the computation the rule makes, with the invoice's values, and the gap.
const SUMS = {
  "BR-CO-10": { result: "BT-106", parts: (inv) => inv.lines.map((l) => ["+", l["BT-131"], "BT-131"]) },
  "BR-CO-13": { result: "BT-109", parts: (inv) => [["+", inv.terms["BT-106"], "BT-106"], ["-", inv.terms["BT-107"], "BT-107"], ["+", inv.terms["BT-108"], "BT-108"]] },
  "BR-CO-15": { result: "BT-112", parts: (inv) => [["+", inv.terms["BT-109"], "BT-109"], ["+", inv.terms["BT-110"], "BT-110"]] },
  "BR-CO-16": { result: "BT-115", parts: (inv) => [["+", inv.terms["BT-112"], "BT-112"], ["-", inv.terms["BT-113"], "BT-113"], ["+", inv.terms["BT-114"], "BT-114"]] },
};

export function computation(rule, inv) {
  const sum = SUMS[rule];
  if (!sum) return null;
  const parts = sum.parts(inv).filter(([, v]) => v);
  let total = 0n;
  for (const [sign, v] of parts) {
    const m = milli(v);
    if (m === null) return null;
    total += sign === "-" ? -m : m;
  }
  const stated = milli(inv.terms[sum.result]);
  if (stated === null) return null;
  return { parts, expected: fromMilli(total), stated: inv.terms[sum.result], result: sum.result, gap: fromMilli(stated - total) };
}
