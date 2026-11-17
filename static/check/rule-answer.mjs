// One rule's answer on a checked invoice: it fails (or warns), finds no error, does not apply (and why), or could not
// be checked. The same answers and reasons as `lintvoice check --rule` (its rulecheck.py), which the parity test
// compares. rule: { id, ids (the official ids reported under it), contexts: { compiled rule file: [rule contexts] } },
// as the build gives each rule page; r: the engine's result, with the rule contexts that fired in each file.

export const syntaxOf = (file) => (file.endsWith("-ubl") ? "UBL" : "CII");

export function answer(r, rule) {
  const out = (a, reason = null) => ({ rule: rule.id, answer: a, reason });
  const own = r.findings.filter((g) => rule.ids.includes(g.rule));
  if (own.length) return out(own.some((g) => g.severity === "error") ? "fails" : "warns");
  const holders = Object.keys(rule.contexts);
  const ran = holders.filter((f) => f in r.fired);
  if (!ran.length && r.not_run.some((x) => holders.includes(x.sef))) return out("not-checked");
  if (ran.some((f) => rule.contexts[f].some((c) => r.fired[f].includes(c)))) return out("no-error");
  if (ran.length) return out("does-not-apply", "not-in-invoice");
  // none of the files that hold the rule ran on this invoice
  if (r.notes.some((n) => n.startsWith("BR-FR rules not applied")) && holders.every((f) => /^(br-fr|extended-ctc-fr)/.test(f)))
    return out("does-not-apply", "seller-not-in-france");
  if (!holders.map(syntaxOf).includes(r.document.syntax)) return out("does-not-apply", "other-syntax");
  return out("does-not-apply", "other-profile");
}
