# audit/08 — Das stehende Regime

Das Deliverable, das die Übergabe überlebt. Was **jetzt live** ist, was in
folgenden Wellen scharf geschaltet wird, und das Ratchet-Register (S11).

## Was jetzt live ist (Wave 1)
- **Deterministischer Gate** (`.github/workflows/ci.yml`): typecheck · lint
  (Standards + Barrierefreiheit) · vitest · build — blockierend, kein Soft-Fail.
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
