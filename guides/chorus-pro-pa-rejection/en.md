# Invoice rejected or refused on Chorus Pro through an approved platform

Chorus Pro is the platform through which French public buyers receive their invoices. An invoice to a French public buyer can go through your approved platform, which passes it to Chorus Pro. When it comes back, two statuses look alike but come from different places: "Rejected" comes from Chorus Pro's own checks, "Refused" comes from the public buyer. They call for different answers.

*This page rests on the public documents of AIFE, the French agency that runs Chorus Pro, at its version 5.3.0, unless it says otherwise. These rules change with each Chorus Pro version.*

## Rejected or refused: who said no?

| | Rejected (code 213) | Refused (code 210) |
| --- | --- | --- |
| Who decides | Chorus Pro, on receipt, when one of its functional checks fails; your own platform can also issue this status | The public buyer, after receiving the invoice |
| What the status carries | A reason code, an error message and, when the error comes from the Schematron, the rule and the field (BT) at fault | Always a refusal reason code |
| What you do | Fix the invoice and issue it again (see below) | Cancel the invoice in your books, then issue a new invoice with a new number |

There is a third outcome: a file that fails Chorus Pro's technical checks, a wrong UBL profile for instance, is not rejected but declared inadmissible ("irrecevable", codes `IRR_…`).

**"À recycler" (send back for correction) is gone, on every channel.** The buyer used to send back an invoice with a wrong SIRET, service code or commitment number, and you fixed it under the same number. Since 23 September 2026, these errors lead to a refusal: the invoice is cancelled and a new one is issued.

**Cancelling means an internal credit note.** It is not sent to the buyer: it cancels the invoice in your books. AIFE advises against answering a refusal with a corrective invoice, because Chorus Pro does not let the buyer tell it apart from the original invoice.

**After a rejection, cancel or send again?** AIFE does not say for this channel. When a public body bills a company and Chorus Pro rejects the invoice, AIFE asks for it to be cancelled by an internal credit note, then a new invoice issued, pointing to the rules of the AFNOR standard. If unsure, check with your platform or your accountant.

**When a rejection names neither the rule nor the field.** The Schematron is the rule file Chorus Pro runs on the invoice's content. If the problem is found outside the Schematron, the status carries only the reason code and the message. AIFE does not say which checks these are; most likely those that rest on Chorus Pro's own data: your SIRET active in Chorus Pro, the buyer's billing address in the directory, an invoice already received under the same number.

## Refused: what the reason code hides

The public buyer picks a reason in Chorus Pro. Chorus Pro then turns it into a code for your platform, and several reasons become the same code. This table takes you back to the possible reasons.

| Code received | What the buyer may have picked in Chorus Pro |
| --- | --- |
| `DEST_ERR` | the wrong approver; a wrong executing service; a creditor that is unknown, or not the one on the commitment; a reason other than a wrong approver |
| `CMD_ERR` | a commitment number that is wrong or does not exist; an error in the commitment's data |
| `MONTANTTOTAL_ERR` | a wrong invoice amount |
| `LIVR_INCOMP` | a delivery incomplete or not made; an order that cannot be fulfilled |
| `CONTRAT_TERM` | a contract that has ended |
| `AUTRE` | another reason; manual reprocessing by the buyer's departments; a bulk deletion |

These codes arrive as the buyer picked them: `DOUBLE_FACT` (invoiced twice), `FACT_NON_CONFORME` (the invoice does not match the order), `TX_TVA_ERR` (wrong VAT rate), `CONTACT_ACHTR` (contact your buyer), `COORD_BANC_ERR` (wrong bank details), `ST_CT_NON_DECLAR` (undeclared subcontractor or co-contractor), `SUPPR_COMP_AVOIR` (deleted to offset credit notes), `TRANSF_PMNT_REGIE` (passed on for payment by an imprest account).

**Eight codes are Chorus Pro's own, outside the French AFNOR standard,** and approved platforms must handle them: `AUTRE`, `CONTACT_ACHTR`, `COORD_BANC_ERR`, `LIVR_INCOMP`, `RETRAIT_MAN_SERV`, `ST_CT_NON_DECLAR`, `SUPPR_COMP_AVOIR` and `TRANSF_PMNT_REGIE`. AIFE lists `RETRAIT_MAN_SERV` among them, yet its mapping table turns it into `AUTRE`.

**A gap between two public texts.** FNFE-MPE's status rules, version v1.4.0.04 (`BR-FR-CDV-CL-09`), accept neither `FACT_NON_CONFORME` nor `CONTACT_ACHTR` in a public buyer's refusal, while AIFE says it sends both codes. A platform that checks the statuses it receives against these rules could flag them as errors.

## What Chorus Pro rejects outright since 10 November 2026

Since Chorus Pro version 5.3.0, an invoice sent by an approved platform to a public buyer is rejected in three use cases:

- self-billing with the supplier's validation (case 19b): the buyer issues the invoice on behalf of its supplier, who accepts or refuses it through a status. Self-billing under a mandate without that validation (case 19a) is still accepted;
- invoices with sub-lines or groups of lines (case 38);
- invoices with several sellers (case 39.2).

AIFE also announces that factored self-billed invoices (invoice types 501, 473 and 502) are rejected.

For these cases, AIFE tolerates "temporarily" Chorus Pro's historic channels: the portal, EDI and the API.

The same day, Chorus Pro stopped wrongly rejecting a line number that is not numeric, and switched off, for UBL and Factur-X, the rejection "the service code does not exist in the service-code list".

## In the file: what Chorus Pro checks on top

Chorus Pro runs the French rules published by FNFE-MPE, the French e-invoicing forum, in their September 2026 version since 21 October 2026. It adds rules of its own for public buyers, named `BR-FR-CPRO`. Their text sits in the French standard AFNOR XP Z12-012, free to consult on AFNOR's website, but no official, machine-readable rule file is published. Here is what AIFE itself says:

- **The invoice number:** at most 20 characters for a public buyer, Chorus Pro's historic length. The French rules allow 35 ([BR-FR-01](/rules/BR-FR-01/)).
- **A unique number:** Chorus Pro rejects an invoice that repeats the issue year (BT-2), the issuer's SIREN (BT-30) and the number (BT-1) of an invoice it already received.
- **The buyer's billing address (BT-49):** mandatory; missing or wrong, the invoice is rejected. AIFE gives the form `SIREN_SIRET_CodeService` (release note 5.2.4); its specification also describes `SIREN_SIRET`, and an approved platform describes it with an optional service code. Copy the exact address from the [e-invoicing directory](https://facturation.chorus-pro.gouv.fr/annuaire), for the service you bill.
- **Both parties:** your SIRET must be registered and active in Chorus Pro, and the buyer must be a public entity.

**One buyer, one identifier.** The rules limit the buyer identifier (BT-46): in UBL, one, whatever the profile (UBL-SR-16, blocking); in CII, one too, but only as a warning (CII-SR-450); in Factur-X BASIC WL and EN 16931, one identifier with a scheme (FX-SCH-A-000164). The Factur-X EXTENDED profile has no such limit. Yet a French public buyer is identified by its SIRET and, when it requires one, by a service code. An approved platform (Invopop) described in October 2026, before version 5.3.0, that when the billing address names a service, the buyer's identifier must name the same one, or Chorus Pro rejects the invoice (`REJ_COH`): the service goes in both places, or in neither.

## Check the invoice before you send it

lintvoice runs the European rules (EN 16931) and FNFE-MPE's French rules in their September 2026 version (v1.4.0.04, the only one released in September), the one Chorus Pro announces it applies since 21 October 2026. It does not check the `BR-FR-CPRO` rules, for which no official rule file is published. It checks the invoice against the rules; it does not promise that Chorus Pro or the buyer will accept it.

[Check an invoice](/check/) · [The invoicing rules](/rules/)

## Sources

- AIFE, [Chorus Pro's external specifications for e-invoicing](https://portail.chorus-pro.gouv.fr/sys_attachment.do?sys_id=835fc34f3bd187d49a4625b693e45a91&view=true) (in French), version 1.1 of 30 April 2026: the statuses (§ 2.4.2, 3.4.2, 3.5.2, 4.2.2.3), the reason codes (tables 3 and 4), the checks (§ 3.1.1, 3.2.1.4), the use cases (chapter 6).
- AIFE, [Chorus Pro release note 5.2.4](https://portail.chorus-pro.gouv.fr/sys_attachment.do?sys_id=e5f44e802ba41b106d58f0baec91bf9a) (in French), in production on 21 October 2026: the end of "à recycler", the billing address, the September rules.
- AIFE, [Chorus Pro release note 5.3.0](https://portail.chorus-pro.gouv.fr/sys_attachment.do?sys_id=af15c6842ba41b106d58f0baec91bfcb) (in French), in production on 10 November 2026: the cases rejected, the checks fixed, the inadmissible file.
- FNFE-MPE, [lifecycle status rules, v1.4.0.04](https://github.com/fnfempe/France_RFE/blob/v1.4.0.04/FNFE_RFE_INVOICE/CDAR/schematron/BR-FR-CDV-Schematron-CDAR.sch): the reason codes accepted for a refusal.
- AFNOR, [the XP Z12-012 standard's page](https://www.boutique.afnor.org/fr-fr/norme/xp-z12012/formats-et-profils-des-messages-factures-et-statuts-de-cycle-de-vie-constit/fa301169/601641) (in French): free to consult.
- Invopop, [testing a B2G invoice against Chorus Pro](https://github.com/invopop/docs.invopop.com/pull/645): the buyer's identifier and the service.
- The European and French rules lintvoice runs: EN 16931 1.3.17, FNFE-MPE v1.4.0.04 ([the rules](/rules/)).
