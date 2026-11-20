# Facture rejetée ou refusée par Chorus Pro via une plateforme agréée

Une facture adressée à un acheteur public peut passer par votre plateforme agréée, qui la transmet à Chorus Pro. Quand elle revient, deux statuts se ressemblent mais n'ont pas le même auteur : « Rejetée » vient des contrôles de Chorus Pro, « Refusée » vient de l'acheteur public. Ils ne demandent pas la même réponse.

*Cette page s'appuie sur les documents publics de l'AIFE, qui gère Chorus Pro, à sa version 5.3.0, sauf mention contraire. Ces règles changent avec les versions de Chorus Pro.*

## Rejetée ou refusée : qui a dit non ?

| | Rejetée (code 213) | Refusée (code 210) |
| --- | --- | --- |
| Qui décide | Chorus Pro, à la réception, quand l'un de ses contrôles échoue | L'acheteur public, après avoir reçu la facture |
| Ce que le statut contient | Un code motif, un message d'erreur et, le plus souvent, la règle et le champ (BT) en cause | Toujours un code motif de refus |
| Ce que vous faites | Corriger la facture et l'envoyer à nouveau | Annuler la facture dans vos comptes, puis émettre une nouvelle facture, avec un nouveau numéro |

**« À recycler » n'existe plus sur ce canal.** Avant, l'acheteur pouvait vous renvoyer une facture avec une erreur de SIRET, de code service ou d'engagement, et vous la corrigiez sous le même numéro. Depuis le 23 septembre 2026, ces erreurs donnent un refus : la facture est annulée et une nouvelle est émise.

**Annuler, c'est émettre un avoir interne.** Cet avoir n'est pas envoyé à l'acheteur : il annule la facture dans vos comptes. L'AIFE déconseille de répondre à un refus par une facture rectificative, car Chorus Pro ne permet pas à l'acheteur de la distinguer de la facture d'origine.

**Quand le rejet ne nomme ni la règle ni le champ.** Si l'anomalie est trouvée en dehors du Schematron (le fichier de règles que Chorus Pro applique au contenu de la facture), le statut ne contient que le code motif et le message. C'est le cas des contrôles que Chorus Pro fait avec ses propres données : votre SIRET actif dans Chorus Pro, l'adresse de facturation de l'acheteur dans l'annuaire, une facture déjà reçue sous le même numéro.

## Refusée : ce que cache le code motif

L'acheteur public choisit un motif dans Chorus Pro. Chorus Pro le traduit ensuite en un code de la norme pour votre plateforme, et plusieurs motifs deviennent le même code. Ce tableau permet de remonter aux motifs possibles.

| Code reçu | Ce que l'acheteur a pu choisir dans Chorus Pro |
| --- | --- |
| `DEST_ERR` | un mauvais valideur ; un service exécutant incorrect ; un créancier inconnu, ou différent de celui de l'engagement ; un autre motif qu'une erreur de valideur |
| `CMD_ERR` | un engagement juridique incorrect ou inexistant ; une erreur dans les données de l'engagement |
| `MONTANTTOTAL_ERR` | un montant de facture erroné |
| `LIVR_INCOMP` | une livraison incomplète ou non effectuée ; une commande impossible à honorer |
| `CONTRAT_TERM` | un marché terminé |
| `AUTRE` | un autre motif ; un retraitement manuel par les services ; une suppression en masse |

Ces codes arrivent tels que l'acheteur les a choisis : `DOUBLE_FACT` (facturé deux fois), `FACT_NON_CONFORME` (la facture ne correspond pas à la commande), `TX_TVA_ERR` (taux de TVA erroné), et cinq codes propres à Chorus Pro, hors de la norme : `CONTACT_ACHTR` (contactez votre acheteur), `COORD_BANC_ERR` (coordonnées bancaires erronées), `ST_CT_NON_DECLAR` (sous-traitant ou cotraitant non déclaré), `SUPPR_COMP_AVOIR` (supprimée pour compensation d'avoirs), `TRANSF_PMNT_REGIE` (transférée pour paiement en régie).

## Ce que Chorus Pro rejette d'office depuis le 10 novembre 2026

Depuis la version 5.3.0 de Chorus Pro, une facture envoyée par une plateforme agréée à un acheteur public est rejetée dans trois cas :

- l'autofacturation, quand l'acheteur émet la facture au nom de son fournisseur ;
- les factures avec des sous-lignes ou des regroupements de lignes ;
- les factures multi-vendeurs.

L'AIFE annonce aussi le rejet des factures autofacturées affacturées (types de facture 501, 473 et 502).

Pour ces cas, l'AIFE tolère « de manière temporaire » les canaux historiques de Chorus Pro : le portail, l'EDI et l'API.

Le même jour, deux contrôles ont été assouplis : un numéro de ligne qui n'est pas numérique est accepté, et Chorus Pro ne vérifie plus que le code service existe dans son référentiel.

## Côté fichier : ce que Chorus Pro vérifie en plus

Chorus Pro applique les règles françaises publiées par le FNFE-MPE, dans leur version de septembre 2026 depuis le 21 octobre 2026. Il y ajoute des règles propres aux acheteurs publics, nommées `BR-FR-CPRO`. Leur texte n'est pas public : il figure dans la norme AFNOR XP Z12-012, et aucun fichier de règles officiel n'est publié. Voici ce que l'AIFE en dit elle-même :

- **Le numéro de facture :** 20 caractères au plus pour un acheteur public, la longueur historique de Chorus Pro. Les règles françaises en acceptent 35 ([BR-FR-01](/fr/regles/BR-FR-01/)).
- **Un numéro unique :** Chorus Pro refuse une facture qui reprend l'année d'émission (BT-2), le SIREN de l'émetteur (BT-30) et le numéro (BT-1) d'une facture déjà reçue.
- **L'adresse de facturation de l'acheteur (BT-49) :** obligatoire ; absente ou erronée, la facture est rejetée. Prenez-la dans l'[annuaire de la facturation électronique](https://facturation.chorus-pro.gouv.fr/annuaire), pour le service visé. L'AIFE indique la forme `SIREN_SIRET_CodeService`.
- **Les deux parties :** votre SIRET doit être créé et actif dans Chorus Pro, et l'acheteur doit être une entité publique.

**Un acheteur, un seul identifiant.** Les règles européennes n'acceptent qu'un identifiant pour l'acheteur (BT-46) : en UBL, quel que soit le profil (UBL-SR-16) ; en Factur-X, dans les profils BASIC WL et EN 16931 (FX-SCH-A-000164). Seul le profil Factur-X EXTENDED en accepte plusieurs. Or un acheteur public est identifié par son SIRET, et souvent par un service. Une plateforme agréée a observé dans l'environnement de test de Chorus Pro que si l'adresse de facturation nomme un service, l'identifiant de l'acheteur doit nommer le même, faute de quoi Chorus Pro rejette la facture (`REJ_COH`) : le service va aux deux endroits, ou à aucun.

## Vérifier la facture avant de l'envoyer

lintvoice applique les règles européennes (EN 16931) et les règles françaises du FNFE-MPE dans leur version de septembre 2026 (v1.4.0.04), celle que Chorus Pro annonce appliquer depuis le 21 octobre 2026. Il ne vérifie pas les règles `BR-FR-CPRO`, dont le texte n'est pas public. Il vérifie la facture contre les règles ; il ne promet pas que Chorus Pro ou l'acheteur l'accepteront.

[Vérifier une facture](/fr/verifier/) · [Les règles de facturation](/fr/regles/)

## Sources

- AIFE, [Dossier de spécifications externes FE de Chorus Pro](https://portail.chorus-pro.gouv.fr/sys_attachment.do?sys_id=835fc34f3bd187d49a4625b693e45a91&view=true), version 1.1 du 30 avril 2026 : les statuts (§ 2.4.2, 3.4.2, 3.5.2), les codes motifs (tableaux 3 et 4), les contrôles (§ 3.1.1, 3.2.1.4), les cas d'usage (chapitre 6).
- AIFE, [note de version 5.2.4 de Chorus Pro](https://portail.chorus-pro.gouv.fr/sys_attachment.do?sys_id=e5f44e802ba41b106d58f0baec91bf9a), en production le 21 octobre 2026 : la fin de « à recycler », l'adresse de facturation, les règles de septembre.
- AIFE, [note de version 5.3.0 de Chorus Pro](https://portail.chorus-pro.gouv.fr/sys_attachment.do?sys_id=af15c6842ba41b106d58f0baec91bfcb), en production le 10 novembre 2026 : les cas rejetés, les contrôles assouplis.
- Invopop, [test d'une facture B2G contre Chorus Pro](https://github.com/invopop/docs.invopop.com/pull/645) : l'identifiant de l'acheteur et le service.
- Les règles européennes et françaises appliquées par lintvoice : EN 16931 1.3.17, FNFE-MPE v1.4.0.04 ([les règles](/fr/regles/)).
