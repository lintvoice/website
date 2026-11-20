# Invoice rejected or refused by Chorus Pro through an approved platform

Chorus Pro is the platform through which French public buyers receive their invoices. An invoice to a French public buyer can go through your approved platform, which passes it to Chorus Pro. When it comes back, two statuses look alike but come from different places: "Rejected" comes from Chorus Pro's own checks, "Refused" comes from the public buyer. They call for different answers.

*This page rests on the public documents of AIFE, the French agency that runs Chorus Pro, at its version 5.3.0, unless it says otherwise. These rules change with each Chorus Pro version.*

## Rejected or refused: who said no?

| | Rejected (code 213) | Refused (code 210) |
| --- | --- | --- |
| Who decides | Chorus Pro, on receipt, when one of its checks fails | The public buyer, after receiving the invoice |
| What the status carries | A reason code, an error message and, most of the time, the rule and the field (BT) at fault | Always a refusal reason code |
| What you do | Fix the invoice and send it again | Cancel the invoice in your books, then issue a new invoice with a new number |

**"À recycler" (send back for correction) is gone on this channel.** The buyer used to send back an invoice with a wrong SIRET, service code or commitment number, and you fixed it under the same number. Since 23 September 2026, these errors lead to a refusal: the invoice is cancelled and a new one is issued.

**Cancelling means an internal credit note.** It is not sent to the buyer: it cancels the invoice in your books. AIFE advises against answering a refusal with a corrective invoice, because Chorus Pro does not let the buyer tell it apart from the original invoice.

**When a rejection names neither the rule nor the field.** If the problem is found outside the Schematron (the rule file Chorus Pro runs on the invoice's content), the status carries only the reason code and the message. That is the case for the checks Chorus Pro makes against its own data: your SIRET active in Chorus Pro, the buyer's billing address in the directory, an invoice already received under the same number.

## Refused: what the reason code hides

The public buyer picks a reason in Chorus Pro. Chorus Pro then turns it into a code of the French standard for your platform, and several reasons become the same code. This table takes you back to the possible reasons.

| Code received | What the buyer may have picked in Chorus Pro |
| --- | --- |
| `DEST_ERR` | the wrong approver; a wrong executing service; a creditor that is unknown, or not the one on the commitment; a reason other than a wrong approver |
| `CMD_ERR` | a commitment number that is wrong or does not exist; an error in the commitment's data |
| `MONTANTTOTAL_ERR` | a wrong invoice amount |
| `LIVR_INCOMP` | a delivery incomplete or not made; an order that cannot be fulfilled |
| `CONTRAT_TERM` | a contract that has ended |
| `AUTRE` | another reason; manual reprocessing by the buyer's departments; a bulk deletion |

These codes arrive as the buyer picked them: `DOUBLE_FACT` (invoiced twice), `FACT_NON_CONFORME` (the invoice does not match the order), `TX_TVA_ERR` (wrong VAT rate), and five codes of Chorus Pro's own, outside the standard: `CONTACT_ACHTR` (contact your buyer), `COORD_BANC_ERR` (wrong bank details), `ST_CT_NON_DECLAR` (undeclared subcontractor or co-contractor), `SUPPR_COMP_AVOIR` (deleted to offset credit notes), `TRANSF_PMNT_REGIE` (passed on for payment by an imprest account).

## What Chorus Pro rejects outright since 10 November 2026

Since Chorus Pro version 5.3.0, an invoice sent by an approved platform to a public buyer is rejected in three cases:

- self-billing, when the buyer issues the invoice on behalf of its supplier;
- invoices with sub-lines or groups of lines;
- invoices with several sellers.

AIFE also announces that factored self-billed invoices (invoice types 501, 473 and 502) are rejected.

For these cases, AIFE tolerates "temporarily" Chorus Pro's historic channels: the portal, EDI and the API.

The same day, two checks were relaxed: a line number that is not numeric is accepted, and Chorus Pro no longer checks that the service code exists in its directory.

## In the file: what Chorus Pro checks on top

Chorus Pro runs the French rules published by FNFE-MPE, the French e-invoicing forum, in their September 2026 version since 21 October 2026. It adds rules of its own for public buyers, named `BR-FR-CPRO`. Their text is not public: it sits in the French standard AFNOR XP Z12-012, and no official rule file is published. Here is what AIFE itself says:

- **The invoice number:** at most 20 characters for a public buyer, Chorus Pro's historic length. The French rules allow 35 ([BR-FR-01](/rules/BR-FR-01/)).
- **A unique number:** Chorus Pro refuses an invoice that repeats the issue year (BT-2), the issuer's SIREN (BT-30) and the number (BT-1) of an invoice it already received.
- **The buyer's billing address (BT-49):** mandatory; missing or wrong, the invoice is rejected. Take it from the [e-invoicing directory](https://facturation.chorus-pro.gouv.fr/annuaire), for the service you bill. AIFE gives the form `SIREN_SIRET_CodeService`.
- **Both parties:** your SIRET must be registered and active in Chorus Pro, and the buyer must be a public entity.

**One buyer, one identifier.** The European rules accept a single identifier for the buyer (BT-46): in UBL, whatever the profile (UBL-SR-16); in Factur-X, in the BASIC WL and EN 16931 profiles (FX-SCH-A-000164). Only the Factur-X EXTENDED profile accepts several. Yet a French public buyer is identified by its SIRET, and often by a service. An approved platform observed in Chorus Pro's test environment that when the billing address names a service, the buyer's identifier must name the same one, or Chorus Pro rejects the invoice (`REJ_COH`): the service goes in both places, or in neither.

## Check the invoice before you send it

lintvoice runs the European rules (EN 16931) and FNFE-MPE's French rules in their September 2026 version (v1.4.0.04), the one Chorus Pro announces it applies since 21 October 2026. It does not check the `BR-FR-CPRO` rules, whose text is not public. It checks the invoice against the rules; it does not promise that Chorus Pro or the buyer will accept it.

[Check an invoice](/check/) · [The invoicing rules](/rules/)

## Sources

- AIFE, [Chorus Pro's external specifications for e-invoicing](https://portail.chorus-pro.gouv.fr/sys_attachment.do?sys_id=835fc34f3bd187d49a4625b693e45a91&view=true) (in French), version 1.1 of 30 April 2026: the statuses (§ 2.4.2, 3.4.2, 3.5.2), the reason codes (tables 3 and 4), the checks (§ 3.1.1, 3.2.1.4), the use cases (chapter 6).
- AIFE, [Chorus Pro release note 5.2.4](https://portail.chorus-pro.gouv.fr/sys_attachment.do?sys_id=e5f44e802ba41b106d58f0baec91bf9a) (in French), in production on 21 October 2026: the end of "à recycler", the billing address, the September rules.
- AIFE, [Chorus Pro release note 5.3.0](https://portail.chorus-pro.gouv.fr/sys_attachment.do?sys_id=af15c6842ba41b106d58f0baec91bfcb) (in French), in production on 10 November 2026: the cases rejected, the checks relaxed.
- Invopop, [testing a B2G invoice against Chorus Pro](https://github.com/invopop/docs.invopop.com/pull/645): the buyer's identifier and the service.
- The European and French rules lintvoice runs: EN 16931 1.3.17, FNFE-MPE v1.4.0.04 ([the rules](/rules/)).
