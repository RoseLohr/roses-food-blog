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

## F5 — Dev-only npm-audit-Findings ohne Upstream-Fix (ratifiziert 2026-07-26)

**Entscheidung (in-command):** Der CI-Job `security` blockiert fail-closed auf dem
**Produktions**-Audit (`npm audit --omit=dev --audit-level=high`, ohne Allowlist).
Der volle Audit inkl. Dev-Abhängigkeiten bleibt EBENFALLS blockierend
(`scripts/regime/dev-audit-gate.mjs`): erlaubt sind ausschließlich die hier
ratifizierten, einzeln benannten Advisories in
`governance/dev-audit-exceptions.json` — jedes andere HIGH/CRITICAL-Advisory
(auch künftige Dev-Findings) blockiert weiterhin. Kein fail-open.

**Begründung:** Die verbleibenden HIGH-Findings betreffen ausschließlich
Werkzeugketten, die nur auf Entwickler-/CI-Maschinen laufen, nie in Produktion:

| Advisory (allowgelistet) | Kette | Warum kein Root-Fix möglich |
|---|---|---|
| `GHSA-mh99-v99m-4gvg` — `brace-expansion ≤5.0.7`, ReDoS (HIGH) | `eslint`/`eslint-plugin-jsx-a11y` → `minimatch@3` (nur devDependencies) | ALLE brace-expansion-Releases ≤5.0.7 betroffen; Override auf 5.0.8 bricht ESLint (5.x ist Named-Export-Dual-Modul, `expand is not a function`); Override minimatch@10 bricht jsx-a11y (`__esModule`-CJS ohne default); jsx-a11y 6.10.2 (neuestes Release) pinnt minimatch ^3; eslint@10 wird von jsx-a11y-Peers (^3–^9) blockiert. Empirisch verifiziert, nicht vermutet. |

Nachrichtlich (NICHT allowgelistet, da unterhalb der Blockier-Schwelle „high"):
die moderate-Kette `drizzle-kit` → `@esbuild-kit/*` → `esbuild`
(Dev-Server-Request-Smuggling); esbuild-kit ist archiviert, ein
drizzle-kit-Downgrade wäre ein Breaking Change des Migrationswerkzeugs.

**Kompensation:** Prod-Audit bleibt unverändert scharf, fail-closed und OHNE
Allowlist; der Dev-Gate blockiert jedes nicht einzeln ratifizierte
HIGH/CRITICAL-Advisory (kein pauschales Paket-Whitelisting, kein fail-open);
Dependabot (B-12) meldet Upstream-Releases.

**Tripwire (automatisch, maschinell erzwungen):** `dev-audit-gate.mjs` schlägt
fehl, sobald ein allowgelistetes Advisory im Audit nicht mehr auftaucht
(Upstream hat gefixt) — die obsolete Ausnahme MUSS dann aus
`governance/dev-audit-exceptions.json` und diesem Ledger entfernt werden, sonst
bleibt CI rot. Ein stillschweigendes Weiterleben von F5 ist damit unmöglich;
ein manuelles Stehenlassen darüber hinaus ist selbst ein Finding.
