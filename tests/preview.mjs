// The check page's invoice preview, run in Node on the JSON of `lintvoice check --format json`, as the page runs it
// (ui.mjs): each file's findings, errors first, numbered and marked with report.mjs, and for each finding the terms
// it is about and whether the preview marks it. Prints JSON, one entry per file, with the preview's HTML.
//
//   node tests/preview.mjs <texts.json> <pages.json> <check.json> <lang>
//
// texts.json: the check page's texts ([check.ui]); pages.json: each rule page's business terms, by rule id.
import fs from "node:fs";
import { marksOf, preview, setCurrency, setup, termsOf } from "../static/check/report.mjs";

const [texts, pagesFile, check, lang] = process.argv.slice(2);
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const pages = read(pagesFile);
setup(read(texts), lang, "");

const out = read(check).files.map((r) => {
  const inv = r.values;
  setCurrency(inv.terms["BT-5"]);
  const list = [...r.findings.filter((g) => g.severity === "error"), ...r.findings.filter((g) => g.severity !== "error")];
  const html = preview(inv, marksOf(list, pages));
  const marked = new Set([...html.matchAll(/data-mark="([\d,]+)"/g)].flatMap((m) => m[1].split(",").map(Number)));
  const findings = list.map((g, i) => ({
    rule: g.rule,
    terms: g.computation ? [g.computation.result, ...g.computation.parts.map(([, , bt]) => bt)] : termsOf(g, pages),
    marked: marked.has(i + 1),
  }));
  return { path: r.path, findings, html };
});
process.stdout.write(JSON.stringify(out));
