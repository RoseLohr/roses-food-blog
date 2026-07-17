# audit/10 — Ausnahmen-Ledger (konsolidiert, in-command abgestimmt)

Alle Abweichungen vom Mandat in **einer** Runde vorgelegt und beschlossen
(Empfehlungen des Auditors, vom in-command-Nutzer als „alle empfohlenen"
angenommen). Jede Ausnahme trägt Begründung + Tripwire/Kompensation. Jede kann
per Amendment (Artikel XIII) widerrufen werden — eine Schwächung ist dann selbst
ein Finding.

## F1 — Prüfungen, deren Voraussetzung die Architektur nicht hat → N/A (ratifiziert)
Begründung jeweils architektur-referenziert; Tripwire = automatische Re-Aktivierung
bei §9.5-Trigger (die Voraussetzung entsteht doch).

| Checks | N/A-Begründung | Tripwire (macht wieder „aktiv") |
|---|---|---|
| `A-11 A-34 B-20 B-22 B-23` | KI-Feature hat **keinen** Tool-Use — Modell liefert nur JSON, das der Admin prüft; kein Agenten-Runtime, kein steuerbarer Egress | Sobald ein `tools:`/Tool-Aufruf im KI-Pfad entsteht (`grep tools: src/lib/ai-*.ts`) |
| `A-21 B-33` | Kein RAG/Memory/Retrieval-Korpus; ein Stateless-Aufruf | Einführung eines Vektor-/Retrieval-Stores |
| `B-15` | Keine Guardrail-/Klassifikator-Schicht vorhanden | Einführung einer Moderations-/Guardrail-Komponente |
| `B-17 B-32` | Kein IaC; Ein-Server manuell via `bootstrap.sh` | Einführung von Terraform/Pulumi/o. Ä. |
| Cross-Tenant (`C-01`-Familie, Part 2) | Ein Admin, kein Mandanten-Modell | Einführung eines zweiten Mandanten |

## F2 — In dieser Umgebung nicht echt ausführbare Regime-Mechanismen → gebaut soweit möglich + Residualrisiko
Details je Zeile in `audit/06-residual-risk-register.md` (mit Rolle + Tripwire).

| Mechanismus | Was hier gebaut ist | Was Residualrisiko bleibt |
|---|---|---|
| Unabh. Verifier fremder Vendor (`A-39`, Art. IV) | Deterministischer Gate als alleinige Merge-Autorität; Hook vorbereitet | Kein zweiter Vendor-Key → `A-39` kein PASS; manueller Zweitmodell-Review bis dahin |
| Policy-Bundle separates Repo/Credentials (`B-35`, Art. II) | Verzeichnis-Trennung + `CODEOWNERS` + CI-Assertion (geplant Wave 1c) | Kein zweites Repo mit eigenen Rechten |
| Kalender-Drills (`§9.2`, Art. VII) | Committete Skripte, on-demand, Fälligkeitsfenster als Tripwire | Kein Cron-Host/Runner-Dead-Man-Switch |
| Produktions-Canary + SLO-Auto-Freeze (`A-24 B-18 B-19`) | Canary-/Abort-Logik als Skript (geplant), Deploy-Admission fail-closed | Keine echte Canary-/Traffic-Infrastruktur |

## F3 — Verfassung & Regime: voll, aber proportional betrieben (ratifiziert)
`governance/constitution.md` (15 Artikel) `IN_FORCE_PROVISIONAL`;
`engagement-status.json` (`production_eligible=false`, computed); alle
CI-erzwingbaren Gates jetzt scharf; Kalender-Drills als Skripte mit Zeitplan.

## F4 — Die 5 begründeten A11y-Suppressions (ratifiziert; Ratchet: darf nur sinken)
Alle mit vollwertiger Tastaturbedienung — daher WCAG-konform trotz Linter-Einwand
gegen die Struktur.

| Datei:Zeile | Regel | Begründung |
|---|---|---|
| `hero-slider.tsx` | `no-noninteractive-element-interactions` | Maus-/Fokus-Pause nur Progressive Enhancement; Pfeiltasten + Fokus-Pause vorhanden |
| `image-picker.tsx` | `no-noninteractive-element-interactions` | Backdrop-Klick schließt nur zusätzlich; Escape (globaler keydown) + Schließen-Button |
| `media-thumb.tsx` (Backdrop) | `no-noninteractive…`, `click-events-have-key-events` | Backdrop-Klick schließt nur zusätzlich; Escape + Schließen-Button |
| `media-thumb.tsx` (Bild) | `no-noninteractive…`, `click-events-have-key-events` | onClick verhindert nur Schließen beim Bildklick; keine eigenständige Interaktion |
| `site-header.tsx` | `no-autofocus` | Fokus nur, weil der Nutzer das Suchpanel bewusst öffnete — erwartet |
