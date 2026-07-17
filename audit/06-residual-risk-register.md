# audit/06 — Residualrisiko-Register

Jedes unbehobene `MUST-FIX`+ und jeder nicht echt ausführbare Regime-Mechanismus
trägt hier **Kompensation + ausführbaren Tripwire + Rolle** (Mandat Regel 11,
§11.4). Ein Risiko ohne beides ist nicht akzeptiert, sondern ignoriert — solche
gibt es hier nicht.

| ID | Risiko | Kompensierende Kontrolle | Tripwire (ausführbar) | Rolle |
|---|---|---|---|---|
| R-01 (`A-39`) | Kein unabhängiger Verifier fremder Vendor | Deterministischer Gate ist alleinige Merge-Autorität (kein Modell-Urteil); manueller Zweitmodell-Review für Blocker-Fixes | CI-Assertion, dass Merge nur bei grünem Gate; Review-Nachweis im Commit | ai-platform |
| R-02 (`B-35`) | Kein separates Policy-Repo mit eigenen Credentials | `CODEOWNERS` + Verzeichnis-Trennung + CI-Assertion „keine Code-Identität schreibt Gate/Verfassung" | `scripts/regime/separation-check.mjs` (Wave 1c) prüft, dass Gate/Verfassung nur mit gesonderter Freigabe geändert wurden | platform-security |
| R-03 (`A-24 B-18 B-19`) | Keine echte Canary-/SLO-/Auto-Recovery-Infrastruktur | Deploy-Admission fail-closed; `restart:always`; Healthcheck; Deploy-Schnellpfad mit Backup+Rollback | `deploy.sh`-Healthcheck bricht bei Fehlschlag ab (vorhanden); Skript-Canary geplant | service-owner |
| R-04 (`§9.6`) | Kein Scheduler/Runner mit Dead-Man-Switch | Kalender-Drills als committete Skripte; Fälligkeitsfenster dokumentiert | Fälligkeits-Check-Skript (Wave 2) meldet überfällige Drills | platform-quality |
| R-05 (`A-02 A-36`) | Mutation-Score & Pipeline-Catch-Rate noch nicht gemessen (Baseline offen) | vitest-Suite mit echten Assertions; Lint-/Typecheck-Gate | Stryker-Lauf auf Kernlogik (Wave 2) setzt Baseline; danach Ratchet | platform-quality |
| R-06 (`A-38 B-09`) | Keine Artefakt-Signatur/Attestierung | SBOM pro Build (CI); Lockfile-Pinning | `cyclonedx`-Schritt in CI (vorhanden); Signatur geplant | platform-security |
| R-07 (`A-22`) | Runtime-A11y (axe) noch nicht verdrahtet | Statischer jsx-a11y-Gate scharf (Wave 1) | axe-Playwright-Test (Wave 2) | product |

**Hinweis:** Diese Liste schrumpft, während die Remediations-Wellen laufen. Jede
Zeile wird geschlossen, sobald ihr Fix + stehende Kontrolle steht, oder bleibt mit
aktualisiertem Tripwire bestehen.

---
## R-CONTRAST — BEHOBEN (A-22) ✅
- **Risiko:** Der Teal-Akzent `#339e92` (`--color-rose-primary`/`--color-accent`)
  erreicht als Text/kleine UI nur ~3,0–3,25:1 auf hellem Grund (nötig: 4,5:1).
  Betrifft Links („Alle Rezepte …"), Pill-Buttons, Primär-Buttons; `#2b857b` auf
  Weiß liegt mit 4,42:1 knapp darunter. WCAG 2.2 AA ist in der EU Rechtspflicht.
- **Status:** Erledigt (in-command Option 1): Akzent-Tokens auf #277a70 abgedunkelt (≥4,5:1 auf Weiß & Creme), Weltkarten-Hex nachgezogen, sk-freiland ebenfalls. axe-Test 5/5 strikt grün, kein color-contrast-Verstoß mehr.
- **Ursprünglicher Kontext:** Der Fix war ein Ein-Token-Wechsel (Akzent auf ≥4,5:1
  abdunkeln), ändert aber die **Markenfarbe überall** — eine In-command-Design-
  Entscheidung, nicht eigenmächtig durch den Auditor.
- **Kompensation:** statischer jsx-a11y-Gate aktiv; axe-Runtime-Test blockiert
  jede *neue* schwere Verletzung (nur `color-contrast` als benannte Altlast geduldet).
- **Tripwire:** `npm run test:a11y` — die Altlast-Liste darf nur schrumpfen; jede
  neue schwere Regel bricht sofort.
- **Owner:** in-command (Design). **Restoring milestone:** Palette-Entscheidung.
- **Vorschlag:** `--color-rose-primary`/`--color-accent` von `#339e92` auf ~`#277a70`
  (≈4,6:1 auf Weiß) abdunkeln; heller Ton bleibt für große Dekor-Flächen möglich.

---
## Bei Ratifizierung (v1.0) getragene Residuals — je mit Kompensation + Tripwire

| ID | Risiko | Kompensation | Tripwire | Rolle |
|---|---|---|---|---|
| R-EVAL (B-10/B-24) | Kein Eval-Gate/Online-Eval für Prompt-Änderungen | 100 % der KI-Ausgaben werden vom Admin (in-command Autor) vor Übernahme geprüft; Prompt-Änderung = Code-Änderung durch das volle Gate | `PROMPT_VERSION`-Änderung ohne begleitenden Test fällt im Review auf; KI-Feature-Ausbau reaktiviert B-10 (§9.5) | in-command |
| R-A33 | Cold-Start-Erfolgsrate keine getrackte SLI | Evidenz vorhanden (dieses Engagement: Gate-bestandene Änderungen rein aus Repo-Artefakten) | monatlicher Cold-Start-Slot (Cadence) unbelegt → Finding | engineering |
| R-A07 | Klon-/Duplikationsquote nicht gemessen | DRY-Praxis, geteilte Komponenten; ESLint | Einführung eines Klon-Detektors geplant; neue Copy-Paste-Häufung fällt im Mutation-/Lint-Gate auf | platform-quality |
| R-B17/B-27/B-29 | Kein IaC, keine Artefakt-Signatur, kein Chaos-Drill | Ein-Server-Setup via bootstrap.sh reproduzierbar; SBOM in CI; restart:always + Healthchecks + Restore-Drill | Zweiter Server/Registry-Push/Autoscaling reaktiviert die Checks (§9.5) | platform |
| R-COST | Kein Infra-Kosten-Cap fürs KI-Feature | admin-only, max_tokens 8000, timeout 90 s, maxRetries 1, ein Aufruf/Job | Kosten-Monitoring beim Provider; Tool-Use-Einführung reaktiviert B-08 hart | in-command |
| R-CWV | Core Web Vitals nicht gemessen (RUM) | statisches, schlankes Frontend; axe-Gate | Nutzerbeschwerden/Suchkonsole; RUM-Einführung geplant | product |
| R-CADENCE | Kein Cron-Host für Kalender-Drills | Drills als committete Skripte, on-demand; CI führt Selbsttests je Push aus | überfälliges Fälligkeitsfenster = Finding (Cadence-Doku) | in-command |
| F2-Verifier | Kein Fremd-Vendor-Zweitverifier (A-39) | Deterministischer Gate ist alleinige Merge-Autorität; menschliches in-command-Review | zweiter Vendor-Key vorhanden → sofort verdrahten | in-command |
| F2-PolicyRepo | Policy-Bundle nicht in separatem Repo | CODEOWNERS-Trennung + separation-check (CI, blockierend) | zweites Repo verfügbar → migrieren | in-command |

---

## Part 2 / Track C — getragene Residuen (Phase 7′)

**R-C30 · Jailbreak-ASR nicht gegen Benchmark gemessen** (C-30, SHOULD-FIX)
- **Risiko:** Die Widerstandsfähigkeit des Modells gegen Jailbreaks ist nicht als
  Attack-Success-Rate gegen einen Standard-Benchmark gemessen.
- **Warum getragen:** Das Feature ist admin-only, schema-gebunden und nicht-konsequent;
  selbst eine jailbreakte Ausgabe ist ein Entwurf, den der Admin prüft.
- **Kompensierende Kontrolle:** `ai-capability-guard` (kein konsequentes Bein) +
  in-command-Review + Schema-Bindung.
- **Tripwire:** Provider-Modellwechsel ODER ein öffentlich-nutzerseitiger KI-Endpunkt →
  ASR messen. **Owner:** ai-security.

## Ehrliche Gesamtlage — offene Blocker über alle 119 (computed, Phase 7′)

Track C ist geschlossen (0 offene Track-C-Blocker). `production_eligible` bleibt
**false**, weil die strengere Zwei-Volume-Definition-of-Done **19 Part-1-Posten**
(PARTIAL in Blocker-Bändern) als offen zählt. Diese sind **keine** Track-C-Befunde;
sie sind der ehrliche Rest, den Part 1 als „residual" trug:

- **STOP-SHIP (2):** `A-01` (Gate-Meinungsfreiheit) / `A-39` (unabhängiger
  Fremd-Vendor-Verifier). **Kern-Blocker:** In einer Ein-Vendor-Umgebung ist ein
  Verifier „from a different vendor" (Artikel IV, Regel 6) **strukturell nicht
  verfügbar**. Kompensation: deterministischer Gate als alleinige Merge-Autorität +
  intra-Vendor-Zweitmodell-Review. Tripwire: zweiter Vendor-Key → `A-39` scharf.
- **BLOCKER-1 (4):** `A-06` (Rollback ungeübt/ungetimt), `A-08` (kein DAST),
  `B-11` (Rollback-Signal), `A-36` (fortlaufende Kalibrier-Injektion braucht Cron-Host).
- **BLOCKER-2 (13):** `A-04/A-09/A-17/A-25` (Fitness-/Fuzz-/CWV-Gates),
  `A-10` (Injektions-Gate — Track-C-Containment mildert), `A-33` (Erfolgsraten-SLI),
  `A-34` (Auto-Halt), `B-02` (nightly-Bootstrap-Verify), `B-05` (Prompt-Lifecycle),
  `B-07` (Token/Kosten-Logging — bewusst nicht, Datenschutz), `B-10` (Eval-Gate —
  C-10 mildert teilweise), `B-12` (Patch-SLA/WAF), `B-28` (Auto-Remediation).

**Diese Liste ist der Wert dieses Berichts.** Sie zu schließen erfordert
Part-1-Scope-Arbeit (DAST, Rollback-Drill mit Zeitmessung, Cron-Host für die
Kadenz, Fitness-/Fuzz-Gates) **und** einen echten Zweit-Vendor-Verifier. Nichts
davon ist ein KI-Sicherheits- oder Datenschutz-Loch (Track C ist dicht) — es ist
die Betriebs- und Assurance-Reife, die ein Solo-Self-Host-Blog noch nicht hat.
