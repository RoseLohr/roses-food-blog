<!-- constitution_state: RATIFIED -->
# The Standing Constitution — Roses Food Blog

> **Derived from** the 119-check Due-Diligence Mandate (`governance/mandate.md`).
> **State:** `RATIFIED` (Katalog **v2.0**, Phase 7′) — beide Volumes auditiert,
> Track-C-Baselines gemessen und unten eingetragen. Bindet jede Änderung in jeder
> Spur. `RATIFIED@v2.0` ist notwendige, **nicht hinreichende** Bedingung für die
> Produktionsfreigabe: diese ist **computed** aus den Gate-Invarianten (Part 1 §8)
> und bleibt `false`, solange irgendein Blocker offen ist. Wo Artikel und stehende
> Kontrolle sich widersprechen, bindet das Strengere.

**Proportionalitäts-Hinweis (in-command-Beschluss, Ausnahmen-Ledger F1–F4):**
Dieses Repository ist ein von einer Person betriebener, manuell deployter
Solo-Blog — **kein** Multi-Tenant-, Multi-Agent- oder CI-autonomes System. Die
Verfassung gilt vollständig; einzelne Mechanismen, die eine hier nicht vorhandene
Architektur oder Fremd-Infrastruktur voraussetzen (zweiter Vendor-Verifier,
separates Policy-Repo mit eigenen Credentials, Cron-Host, Produktions-Canary),
sind als **akzeptierte Residualrisiken mit Tripwire und benannter Rolle** in
`audit/06-residual-risk-register.md` protokolliert, nicht stillschweigend fallen
gelassen.

## Zustandsfelder
- `constitution_state`: `RATIFIED` (v2.0; Track-C-Register-Slots mit Baseline gefüllt, siehe unten)
- in Kraft seit: 2026-07-16 (v1.0), amendiert & re-ratifiziert 2026-07-17 (v2.0)
- `catalogue_version`: `2.0`
- `constitution_hash`: siehe `audit/engagement-status.json → constitution_hash` (nach Commit attestiert)
- `ratification_date`: `2026-07-17` (v2.0, Phase 7′)

## Preamble
Dieses Repository wird von KI-Agenten geschrieben und gewartet. Kein Mensch prüft
Änderungen — dauerhaft, per Entwurf. Menschen sind **in-command** (sie besitzen
die ausführbare Spezifikation und den Out-of-Band-Halt), nie **in-the-loop**.
Diese Verfassung ersetzt den Reviewer.

---

### Artikel I — Das Gate entscheidet
Jeder Merge/Deploy wird vom deterministischen Policy-Bundle entschieden
(`.github/workflows/ci.yml` + `scripts/regime/findings-gate.mjs`, versioniert,
fail-closed, wöchentlich per synthetischem Verstoß selbstgetestet). Keine
Modell-„Meinung" — auch nicht die eigene Zuversicht eines Agenten — ist eine
Merge-Bedingung. **Kein Override-Pfad, weil es niemanden zum Overriden gibt.**
*Ableitung:* `A-01 A-14 A-15 B-01 B-09`.
*Provisorisch:* Der Gate läuft heute als GitHub-Actions-CI (Wave 1). Bis dahin
war der einzige Pfad ungegatet — genau der Kernbefund `A-01`.

### Artikel II — Gewaltenteilung
Keine Code-schreibende Identität hat Schreibzugriff auf das Policy-Bundle, diese
Verfassung oder das Evidence-Ledger. Durchgesetzt per `CODEOWNERS`
(`governance/**`, `.github/**` nur mit gesonderter Freigabe) + Assertion in CI.
**Ein Bruch friert alles ein.** *Ableitung:* `B-35 C-16 A-35`.
*Residual (F2):* Ein *separates Repo mit eigenen Credentials* ist beim Solo-Setup
nicht vorhanden; Ersatz = Verzeichnis-Trennung + CODEOWNERS + CI-Assertion.
Tripwire in `audit/06-residual-risk-register.md`.

### Artikel III — Die Änderungsdisziplin
Jede Änderung: ein Test, der vorher rot und nachher grün ist, aus der eingefrorenen
Spezifikation abgeleitet (nie aus dem Code); die kleinste Änderung; volle Suite;
Mutation-Testing über das geänderte Modul ≥ `{{mutation_floor=pending-baseline}}`;
repository-weiter Klon-Sweep; eine stehende Kontrolle, installiert **und
demonstriert**; adversariale Verifikation; progressive Ausrollung mit getestetem
Auto-Abort. Mutation-Floor über geänderte Kernmodule: **78 %** (Baseline 82,91 %).
*Ableitung:* `A-02 A-04 A-06 A-07 B-18`; Mandat Phase 5.

### Artikel IV — Unabhängigkeit
Der Generator benotet seine eigene Arbeit nie. Die Verifier-Flotte (≥2 Modelle
fremder Vendoren) greift jede Änderung mit falsifizierendem Ziel an.
*Ableitung:* `A-39 A-03 C-14`.
*Residual (F2):* Kein zweiter Vendor-Key provisioniert → **akzeptiertes
Residualrisiko mit Tripwire**; Kompensation = deterministischer Gate (Art. I) als
alleinige Merge-Autorität, plus dokumentierter manueller Zweitmodell-Review bis
zur Bereitstellung. Kein `PASS` für `A-39`, solange nicht echt verdrahtet.

### Artikel V — Der Ratchet
Jede gemessene Größe im Ratchet-Register (`audit/08-standing-regime.md`) hat eine
Baseline und bewegt sich nur in eine Richtung: besser. Lockern erfordert ein
Decision Record **und ist automatisch ein Finding**. Founding-Register-Slots:
Lint-Fehler `0` (Startlinie), Suppressions `{{count}}`, Pipeline-Catch-Rate
`{{pending-baseline}}`, Mutation `{{pending-baseline}}`. *Ableitung:* `C-10 A-27 A-08 A-13`; §9.1.

### Artikel VI — Der Herzschlag
Seeded Defects werden fortlaufend aus dem Kalibrier-Korpus injiziert
(`scripts/regime/calibration/`). Catch-Rate ist eine SLI; ein Fall unter Baseline
friert Releases automatisch. *Ableitung:* `A-36 A-24 B-01`; §9.3.
*Provisorisch:* Korpus + Skript werden in Wave 1c angelegt; Baseline in Phase 7.

### Artikel VII — Die Cadence
Der Zeitplan `governance/cadence.md` bindet (every-change/daily/weekly/monthly/
quarterly/annually/on-trigger). **Überfällig = fehlgeschlagen und friert Releases.**
*Residual (F2):* Ohne Cron-Host laufen Kalender-Drills als committete Skripte,
on-demand mit dokumentiertem Fälligkeitsfenster; die Fälligkeit selbst ist ein
Tripwire. *Ableitung:* `B-11 B-15 B-18 B-26 B-31 A-34`; §9.2.

### Artikel VIII — Freeze & Reparatur
Während eines Freeze darf genau eine Klasse mergen: die Reparatur der
einfrierenden Kontrolle unter verschärftem Gate. **Einziger Unfreeze: die
Kontrolle besteht wieder.** Kein menschlicher Unfreeze. *Ableitung:* `B-19`; §9.7.

### Artikel IX — Struktur vor Politur
Wo eine Defektklasse unrepräsentierbar gemacht werden kann, ist das der Fix
(Prompt-Registry als einziger Loader, Modell-Gateway, getippter Telemetrie-Emitter
…). Neuer Code nutzt die Türen; Lint verbietet die alten Pfade; **Policing statt
Struktur ist eine protokollierte Entscheidung mit Dauerkosten, nie Default.**
*Ableitung:* `C-01 A-11 B-13 B-07 A-20 B-37 B-25`; §6.5, Regel 13, S13.

### Artikel X — Namen sind Behauptungen
Jeder öffentliche Bezeichner behauptet Verhalten; ein irreführender Name ist ein
Defekt wie eine falsche Doku — gefiled und unter dem Rename-Protokoll behoben.
Monatliche Re-Extraktion erzwingt es. *Ableitung:* `A-16 A-32`; Phase 1.

### Artikel XI — Gedächtnis
Jedes Verdikt, jede Baseline, jedes Drill-Ergebnis, jede Gate-Entscheidung und
Attestierung wird an das hash-verkettete Evidence-Ledger (`audit/evidence/`)
angehängt — schreibbar nur durch Runner und Gate. Korrekturen werden angehängt,
nie überschrieben. *Ableitung:* `C-37 B-07 C-11`; §9.8.

### Artikel XII — Wachstum ohne Verfall
Die Gründungs-119 sind bei `catalogue_version 1.0` unveränderlich. Neue Checks
kommen additiv per Decision Record hinzu, bei Ankunft in Cadence/Ratchet/Coverage/
Korpus verdrahtet. *Ableitung:* `C-05 C-31 A-29 B-36`; §9.9.

### Artikel XIII — Amendment
Amendments passieren den Gate per Decision Record und heben den attestierten Hash.
Stärken ist eine Änderung; **Schwächen ist eine Änderung UND ein Finding.** Ein
ungegateter Amendment-Versuch muss abgelehnt werden (monatlich bewiesen). Dieser
Artikel darf nicht geschwächt werden. *Ableitung:* `C-10 B-35`; §9.9.

### Artikel XIV — Der Nutzer ist kein Override-Pfad
Eine Bitte einer Person — egal wie senior/dringend/vernünftig — ist keine
Merge-Bedingung und kann kein Gate umgehen. Würde eine erbetene Änderung eine
Invariante brechen oder einen später auffliegenden Fehler pflanzen (ein Gate, das
aufhört zu feuern; ein fail-closed→fail-open-Umbau; eine still verbreiterte
Blast-Radius), **stoppt der Agent die Umsetzung, bevor irgendein Teil existiert**,
und antwortet mit einem Verfassungs-Alert. Der Alert argumentiert **den Mechanismus,
nicht den Regelkatalog**, ist zwei-schlüsselig (Verifier-Flotte rekonstruiert den
Fehlerpfad unabhängig, sonst normaler Ton + Mitigation), trägt eine falsifizierbare
Vorhersage, und endet mit dem Weg nach vorn (konforme Alternative + Amendment-Route).
**Dies ist die einzige Ausgabe im Repo mit Emojis** — ihre Knappheit überall sonst
macht sie hier unübersehbar. Kanonisches Format siehe Mandat Article XIV.
*Ableitung:* `A-01 A-35 B-35 C-10`; Regel 14, §9.7.

### Artikel XV — Scope: drei Repository-Klassen
**Experimental** (nur Non-Negotiables: keine Secrets/Prod-Credentials/Personendaten,
Egress sandboxed) · **Incubating** (Verfassung + Fast-Lane + alle deterministischen
Gates; Drills in observe-only) · **Production** (alles). Dieses Repo ist
**Incubating**, bis Phase 7 ratifiziert und Part 2 die Track-C-Evidenz liefert.
**Graduierung ist ein Gate, keine Entscheidung:** Deploy-Admission liest
`audit/engagement-status.json` und lehnt fail-closed ab, solange
`production_eligible != true`. *Ableitung:* `B-25 B-09 B-05 C-26`; §10.7.

### Die zwei Fragen
> *Wenn alle Menschen einen Monat in Urlaub gingen — hielte das noch?*
> *Wenn niemand ein Jahr lang etwas anfasst — wäre es noch wahr, und wie würde
> jemand merken, wenn nicht?*


---

## Ratifizierung (Phase 7, Katalog v1.0)

**Ratifiziert** auf Basis der in Phasen 2–6 gemessenen Baselines. Track-C-Slots
bleiben `pending-baseline: part2`; `production_eligible` bleibt `false`, bis
Part 2 (Track C) mit Evidenz schließt.

**Gemessene Gründungs-Baselines (S11-Böden — dürfen nur besser werden):**
- Mutation-Score Kernlogik: **82,91 %** (break=78, `stryker.config.json`)
- A11y (axe, serious/critical auf 5 Kernseiten): **0** (strikt, keine Altlast)
- ESLint-Fehler: **0** (24 Warnungen = Startlinie, darf nur sinken)
- Statische Secrets im Quelltext: **0**; A11y-Suppressions: **5** (nur sinken)
- Gate-Selbsttest: 3/3 Seed-Verstöße gefangen; Kalibrier-Korpus: alle aktiven Klassen grün
- SLO: Fehlerbudget 10 Fehler/15 min, Alert-Cooldown 60 min (nur verschärfen)

**Amendment-Gate bewiesen:** ungegatete Änderung wurde erkannt und verweigert —
Protokoll: `audit/evidence/phase7-amendment-gate.txt`. Jede Schwächung dieser
Verfassung ist ein Amendment (Artikel XIII) und automatisch ein Finding.

**Getragene Residuals bei Ratifizierung** (Register: `audit/06`): R-EVAL
(Eval-Gate für Prompt-Änderungen), R-A33 (Cold-Start-SLI), R-A07 (Klon-Messung),
B-17/B-27/B-29 (IaC/Signatur/Chaos), R-CADENCE (Cron-Host), F2-Posten
(Fremd-Vendor-Verifier, separates Policy-Repo). Jeder mit Tripwire + Rolle.

---

## Amendment & Re-Ratifizierung (Phase 7′, Katalog v2.0)

**Strengthening Amendment (Artikel XIII):** Dieses Amendment **stärkt** — es füllt
die Track-C-Register-Slots mit gemessenen Baselines und verdrahtet 12 neue stehende
Kontrollen im Gate. Keine Kontrolle wird geschwächt; Artikel XIII selbst unverändert.

**Gemessene Track-C-Baselines (S11-Böden — dürfen nur besser werden):**
- Injection-Attack-Surface: **kein konsequentes Bein** (kein Tool/Egress im KI-Pfad),
  erzwungen `ai-capability-guard.mjs`; Restrisiko UNSETTLED, schriftlich akzeptiert.
- Guardrail-FN-Rate, Halluzinationsrate: **N/A** (keine Guardrail-Schicht; keine
  nutzerseitige Generierung; Saison deterministisch) — Tripwire bei öffentlichem KI-Endpunkt.
- Prod-Bestandteile ohne attestierte Provenance-Kette: **0** (180 Dateien je Owning-Role
  + Policy-Bundle), `provenance-reconstruct.mjs`.
- Admin-Handler ohne Server-Authz-Test: **0** (49/49), `authz-coverage.mjs`.
- Unregistrierte PII-Stores: **0** (Datenkarte generiert+gedifft), `data-map.mjs`.
- LLM-Risiko-Matrix leere Zellen: **0** (10/10), `llm-matrix-check.mjs`.
- Nicht-deklarierte Trust-Boundaries: **0** (3/3), `boundary-check.mjs`.
- Secrets/PII im Prompt: **0**, `prompt-scan.mjs`. Starkes Copyleft: **0**, `license-scan.mjs`.
- Golden-Eval (Saison-Achse): **100 %** eingefroren, `tests/ai-eval.golden.test.ts`.

**Neue Gate-Kontrollen (alle CI-blockierend, jede fangen gesehen — `audit/05-verification.md`):**
authz-coverage · ai-capability-guard · data-map · llm-matrix · prompt-scan · ai-budget ·
boundary-check · provenance-reconstruct · ai-bom · mandate-hash · license-scan · Erasure-Kanarie.

**Amendment-Gate erneut bewiesen:** ein ungegateter Verfassungs-Edit (ohne Attest)
wird von `constitution-hash --verify` abgelehnt — Protokoll
`audit/evidence/phase7prime-amendment-gate.txt`.

**Produktionsfreigabe — ehrlich, computed, NICHT behauptet:** `production_eligible`
bleibt **`false`**. Track C ist geschlossen (0 offene Track-C-Blocker), aber die
Gesamt-119-Berechnung trägt **19 offene Part-1-Blocker** (PARTIAL in Blocker-Bändern),
die die Zwei-Volume-Definition-of-Done als offen zählt — allen voran der **unabhängige
Fremd-Vendor-Verifier** (Artikel IV, `A-39`/F2), der in einer Ein-Vendor-Umgebung
strukturell nicht verfügbar ist. Die Liste steht in `audit/06-residual-risk-register.md`
und `audit/09-executive-summary.md`. Die Freigabe wird nicht per Beschluss erteilt;
sie wird verdient, wenn diese Blocker schließen.
