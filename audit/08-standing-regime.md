# audit/08 — Das stehende Regime

Das Deliverable, das die Übergabe überlebt. Was **jetzt live** ist, was in
folgenden Wellen scharf geschaltet wird, und das Ratchet-Register (S11).

## Was jetzt live ist (Wave 1 + 2)
- **Deterministischer Gate** (`.github/workflows/ci.yml`): typecheck · lint
  (Standards + Barrierefreiheit) · vitest · build — blockierend, kein Soft-Fail.
- **Bare-Handler-Verbot** (`A-26`): ESLint `no-empty` (allowEmptyCatch:false) — kein still verschluckter Fehler. Rot-grün an leerem catch bewiesen.
- **Quelltext-Gates** (`A-16`/`B-13`): `source-gates.mjs` — keine Stubs, keine floating Modell-Aliase. Rot-grün an getrackter Datei bewiesen; Selbsttest (S12) inklusive.
- **Restore-Drill** (`B-31`): `restore-drill.sh` monatlich; **einmal geübt** — 4/4 Rezepte wiederhergestellt, 9 s, Beleg in `audit/evidence/`.
- **Sicherheits-Gate**: `npm audit` (≥high) · Dependency-Existenzprüfung
  (Anti-Slopsquatting) · SBOM (CycloneDX).
- **Deploy-Admission fail-closed**: `findings-gate --admission` verweigert,
  solange `production_eligible=false` (in CI als grüner „muss-verweigern"-Beweis).
- **Verfassungs-Hash-Gate**: jede CI-Session verifiziert den attestierten Hash.
- **Gewaltenteilung**: `CODEOWNERS` trennt Gate/Verfassung/Evidence vom Code.
- **Verfassung** `IN_FORCE_PROVISIONAL`; Katalog-Manifest (119) + Engagement-Status.

## Ratchet-Register (S11) — Startlinien, dürfen nur besser werden
| Metrik | Baseline | Richtung | Blockiert |
|---|---|---|---|
| Lint-Fehler | 0 | darf nicht steigen | Merge |
| Lint-Warnungen | 24 | soll sinken | (Report) |
| A11y-Suppressions (ratifiziert) | 5 | darf nur sinken | Merge bei Zuwachs |
| Dependency-Existenz-Fehler | 0 | muss 0 bleiben | Build |
| npm-audit ≥ high | 0 | muss 0 bleiben | Build |
| offene STOP-SHIP/BLOCKER (A/B) | 3 / 25 | nur sinken | Deploy (via Admission) |
| Mutation-Score Kernlogik | `pending Wave 2` | nur steigen | Merge (sobald gemessen) |
| Pipeline-Catch-Rate | `pending Wave 1c` | nur steigen | Release (sobald gemessen) |

## Folgewellen (geplant, mit Fälligkeit)
- **Wave 1c**: Seeded-Defect-Kalibrier-Korpus + Catch-Rate-SLI (`A-36`);
  Separations-Check-Skript (`B-35`); Gate-Selbsttest wöchentlich (`A-01/B-01`).
- **Wave 2**: strukturelle Fixes — Prompt-Registry (`A-20/B-05`), Bare-Handler-/
  Stub-/Modell-Alias-Lint (`A-26/A-16/B-13`); Mutation-Testing (`A-02`);
  Restore-Drill (`B-31`); Runtime-A11y-axe (`A-22`); ADRs (`A-09`).
- **Wave 3**: On-Trigger-Re-Run-Skripte (§9.5); NFR-Messungen (`A-17/A-27`).
- **Phase 7**: Baselines messen, Verfassung `RATIFIED`, Amendment-Gate beweisen.

## Owning-Rolle des Regimes
`platform-quality` (hier: der in-command-Betreiber). Gesundheitszahl: die
Pipeline-Catch-Rate, sobald Wave 1c sie misst.

---

## Track-C-Baselines im Ratchet-Register (Phase 7′, v2.0)

Aus `pending-baseline: part2` in gemessene Böden überführt (S11 — nur besser):

| Größe | Baseline | Kontrolle | Ratchet |
|---|---|---|---|
| Admin-Handler ohne Authz-Test | 0 (49/49) | `authz-coverage.mjs` | bleibt 0 |
| Prod-Bestandteile ohne Provenance-Kette | 0 (180/180 Owning-Role) | `provenance-reconstruct.mjs` | bleibt 0 |
| Unregistrierte PII-Stores | 0 | `data-map.mjs` | bleibt 0 |
| LLM-Matrix leere Zellen | 0 (10/10) | `llm-matrix-check.mjs` | bleibt 0 |
| Nicht-deklarierte Trust-Boundaries | 0 (3/3) | `boundary-check.mjs` | bleibt 0 |
| Secrets/PII im Prompt | 0 | `prompt-scan.mjs` | bleibt 0 |
| Starkes Copyleft (Deps) | 0 (506 geprüft) | `license-scan.mjs` | bleibt 0 |
| Reaktivierende KI-Fähigkeiten | 0 | `ai-capability-guard.mjs` | bleibt 0 |
| Golden-Eval (Saison) | 100 % (eingefroren) | `ai-eval.golden.test.ts` | nur steigen |
| Injection-ASR-Ceiling | kein konsequentes Bein (UNSETTLED) | Guard + Containment-Test | darf nicht steigen |
| ops_event-Retention | 90 Tage | `purgeOldOpsEvents` | nur kürzer |

**Neue Kalibrier-Seeds:** S7 (Injection), S8 (Exfil), S9 (Authz) — aktiv, `--strict` grün.
