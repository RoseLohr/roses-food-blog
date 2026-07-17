# Claims-Ledger — Phase 1′ (Security/Privacy/Assurance-Delta)

Außerplanmäßige Re-Extraktion (Part 1 §9.2, Artikel X), auf die von Track C
geprüften Aussagen fokussiert. Jede Aussage: Quelle → geprüft durch → Status.
Aussagen, die in Part 1 (Track A/B) bereits abgeglichen wurden, sind dort
verankert; hier stehen nur die sicherheits-, datenschutz- und assurance-nahen.

| # | Aussage (Quelle) | Belegt durch | Track-C-Prüfung | Status Phase 1′ |
|---|---|---|---|---|
| CL-1 | „First-Party-Tracking DSGVO-konform" (`tracking.ts:2`) | IP normalisiert (Task #80), Rohdaten nach Aggregation gelöscht in EINER Transaktion (`tracking.ts:132`), Aggregat-Retention 730 T (`:69`) | C-04, C-23 | belegt — end-to-end-Erasure-Test fehlt (→ C-04-Remediation) |
| CL-2 | „Double-Opt-in, DSGVO" (`newsletter.ts:2`) | `contact.consentAt` = Einwilligungszeitpunkt (Art. 6(1)(a)); Status-Maschine unbestätigt→aktiv→abgemeldet | C-04 | belegt — Rechtsgrundlage dokumentiert, DPIA/RoPA fehlen (→ C-04) |
| CL-3 | „DSGVO-Anonymisierung … unwiderruflich" (`contacts.ts:51`) | `anonymizeContact` kaskadiert über contact/interest/tag/segment/activity/queue/sequenceLog | C-04 | belegt — Kanaldeckung nicht per Test bewiesen; emailQueue-Rest bei contactId=null (→ C-04) |
| CL-4 | „Nie personenbezogen" (Logs, `observability.ts:29`) | `logJson` schreibt level/event/fields; Eingabetext des KI-Laufs nie persistiert (`ai-recipe.ts`) | C-23, C-24 | belegt per Design — kein erzwungener PII-Scan am Emitter (→ C-23) |
| CL-5 | „Kein Hot-Swap-Pfad an einem Gate vorbei" (Prompt-Registry, `recipe-draft.ts:5`) | source-gate verbietet Inline-Prompts; Prompt lebt an genau einem Ort | C-24, C-33 | belegt (A-20 PASS) |
| CL-6 | „Modell gepinnt" (`ai-recipe.ts:165` `claude-opus-4-8`) | source-gates Alias-Lint (B-13 PASS) | C-05, C-33, C-34 | belegt |
| CL-7 | „Strukturierte Ausgabe (JSON-Schema)" (`ai-recipe.ts:167`) | `zodOutputFormat(recipeDraftSchema)` bindet die Modellausgabe strikt | C-05, C-07, C-08 | belegt — Containment-Argument, Injektions-Suite fehlt (→ C-07) |
| CL-8 | „Kein modellgesteuerter Egress/Tool-Pfad" (Findings B-20 N/A) | kein `tools:`-Aufruf im KI-Pfad; Ausgabe nur JSON an den Admin | C-06, C-08, C-12, C-17 | belegt — kein Tool-Use, keine Agenten |
| CL-9 | „Secrets im Vault/nicht im Quelltext" (B-06 PASS) | secret-scan (Muster+Selbsttest) in CI; API-Key aus Settings/Env | C-01, C-24 | belegt |
| CL-10 | „SBOM in CI" (A-38/B-09) | CycloneDX-Job im security-Gate | C-26 | belegt — AI-BOM + Verify-on-Deploy fehlen (→ C-26) |
| CL-11 | „Server-seitige Authz, HttpOnly-Session" (`auth.ts`) | argon2id, DB-Session, SHA-256-Token, `requireAdmin`-Guard; 14/16 Action-Dateien + alle api/admin-Routen geguardet | C-01 | belegt — **kein** Authz-Coverage-Gate/Test (→ C-01) |
| CL-12 | „Kein Directory-Traversal" (`uploads/[...pfad]/route.ts:4`) | strikte Regex `^[a-f0-9]{20}$` + `^w\d{3,4}\.webp$`, genau 2 Segmente | C-01 | belegt |
| CL-13 | „KI-Ausgaben menschlich geprüft vor Publikation" (B-10/B-24) | Entwurf im Editor; Taxonomien deferred bis Speichern; in-command-Autorschaft | C-07, C-10, C-29, C-36, C-38 | belegt — als Kompensation gültig, nicht als alleinige Kontrolle (Regime: braucht Mechanismus) |

**Delta gegenüber Part-1-Abschluss:** keine neue Produktaussage seit `ad3ff31`
(Code-Delta null). Alle Aussagen oben sind Bestandsaussagen; die offenen Punkte
markieren die Track-C-Remediation, nicht neue Behauptungen.
