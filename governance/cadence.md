# Cadence — der bindende Zeitplan (Mandat §9.2, Verfassung Artikel VII)

**Überfällig = fehlgeschlagen und friert Releases.** Beim Solo-Setup ohne
Cron-Host laufen die Kalender-Drills als **committete Skripte** (`scripts/regime/`),
on-demand ausführbar; das **Fälligkeitsfenster** ist der Tripwire (dokumentiert je
Zeile). Neu commissionierte Kontrollen durchlaufen 14 Tage observe-only Burn-in und
promoten dann einmalig zu enforcing.

| Cadence | Was läuft | Umsetzung hier |
|---|---|---|
| **Jede Änderung** | Deterministischer Gate: typecheck · lint (Standards+A11y) · test (vitest) · build · Findings-Gate · Verfassungs-Hash-Verify · npm audit · Dependency-Existenz · SBOM | `.github/workflows/ci.yml` (scharf) |
| **Täglich** | Volltext-History-Secret-Scan; Lockfile-Re-Verifikation | `scripts/regime/*` (geplant Wave 1c) |
| **Wöchentlich** | Gate-Selbsttest (synthetischer Verstoß muss blockieren); Seeded-Defect-Injektion | geplant Wave 1c |
| **Monatlich** | Restore-Drill; Rollback-Drill; ungegateter Amendment-Versuch (muss abgelehnt werden); Namens-Re-Extraktion | `scripts/regime/restore-drill.sh` (Wave 2) |
| **Quartalsweise** | Game-Day; Scope-Revocation-Sweep; Erasure-Drill | geplant |
| **Jährlich** | Human-Takeover-Drill; IP-Position-Review; Framework-Review; kompletter Katalog-Re-Run; unabhängiges 10%-Verdikt-Re-Audit | geplant |
| **On-Trigger (§9.5)** | Neues Tool/Modell/Egress/Datenklasse/Architektur → automatische Re-Runs betroffener Checks | Tripwire-Skripte (Wave 3) |

**Residual (Ausnahmen-Ledger F2):** Ein echter Scheduler (Runner mit Dead-Man-
Switch) und eine zweite Vendor-Verifier-Flotte sind beim Solo-Setup nicht
provisioniert. Beide sind in `audit/06-residual-risk-register.md` mit Tripwire und
Rolle als akzeptiertes Residualrisiko geführt; die Skripte existieren und sind
on-demand lauffähig, sobald die Infrastruktur bereitsteht.
