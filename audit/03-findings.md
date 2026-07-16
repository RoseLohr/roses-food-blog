# audit/03 — Befunde (Phase 3, Katalog v1.0, 79 Prüfungen)

**Erster beweisbasierter Durchgang gegen Commit `ad3ff31`. Rein lesend.**

## Wichtigster Rahmen (bevor die Einzelbefunde kommen)
Der Katalog misst ein **CI-gegatetes, review-freies, autonom betriebenes**
System. Dieses System ist ein **einzeln-administrierter, manuell deployter
Next.js-Food-Blog**. Zwei Konsequenzen prägen fast jedes Verdikt:

1. **Es gibt keine Verifikations-Maschine** — keine CI, kein Policy-Gate, keinen
   unabhängigen Verifier, keine Mutation-Gates, keine SLOs, kein
   Progressive-Delivery. Nach den Eskalationsregeln in §3 werden dadurch
   **`A-01`+`A-39` zu `STOP-SHIP`**, und die meisten „stehenden Kontrollen"
   fehlen ganz.
2. **§3-Regel „ohne stehende Kontrolle kein PASS":** Da praktisch **keine**
   stehende Kontrolle existiert, ist das bestmögliche ehrliche Verdikt für
   „funktioniert heute, aber nichts hält es" **`PARTIAL`**, nicht `PASS`.
   Es gibt in diesem Durchgang **kein einziges `PASS`** — das ist die
   ehrliche Aussage, kein Formfehler.

**Verdikt-Legende:** `FAIL` · `PARTIAL` (heute erfüllt, keine Kontrolle hält es) ·
`N/A` (mit Begründung) · `NO-EVIDENCE` (nicht messbar in diesem Durchgang).

---

## STOP-SHIP (Priorität 10)

**`B-06` · Geheimnisse & Maschinen-Identität — `PARTIAL`**
`.env` ist **nicht** im Git (`git ls-files` bestätigt), keine Secret-Literale in
`src/`/`scripts/` (das `sk-ant-…` in der Einstellungsseite ist ein Placeholder).
Der API-Key liegt in DB-Settings oder `ANTHROPIC_API_KEY`. **Aber:** kein
History-Scan, keine automatische Rotation, keine kurzlebigen Credentials,
kein stehender Secret-Scan (es gibt keine CI). → heute sauber, nichts hält es.

**`A-01` · Verifikations-Gate auf jede Produktionsänderung — `FAIL` (STOP-SHIP)**
Es gibt **kein** deterministisches Gate: keine CI, kein Branch-Schutz, der
etwas erzwingt, kein Provenance-Record pro Änderung. Deployment ist manuelles
`./deploy.sh`. Der „Bypass-Pfad" ist der einzige Pfad.

**`A-39` · Verifikations-Schleife nicht selbstreferenziell — `FAIL` (STOP-SHIP, eskaliert weil A-01 auch fällt)**
Kein deterministischer Arbiter, kein unabhängiger Verifier (anderes Modell/
anderer Vendor). Code, Test und (menschliche) Prüfung stammen aus einer Quelle.
**Gemeinsam heißt A-01+A-39: keine unabhängige Instanz — weder Mensch noch
Maschine — hat je eine Zeile Produktionscode verifiziert.** Das ist der
ehrliche Kernbefund dieses Audits.

*(A-02 und B-35 sind hier gebändert, eskalieren aber nicht zu STOP-SHIP — siehe unten.)*

---

## BLOCKER-1 (Priorität 9)

- **`A-02` · Testsuite, die wirklich fehlschlagen kann — `PARTIAL`.** 28 Test-Dateien, echte Assertions (vitest, Integrationstests gegen echte SQLite). **Aber:** kein Mutation-Testing (kein Stryker), kein Coverage-/Mutation-Gate, Tests laufen **nur manuell** (`npm test`), nichts erzwingt sie. Mutation-Score **nicht gemessen** → NO-EVIDENCE auf die Meta-Frage; die Eskalation zu STOP-SHIP ist damit nicht belegt, aber das Netz ist ungeprüft.
- **`A-06` · Versionskontrolle, Batch-Größe, geübter Rollback — `PARTIAL`.** Kleine, atomare Commits mit klaren Messages (Historie bestätigt). **Aber:** kein CI-on-push, Rollback nur implizit über `deploy.sh` (Image-Neubau), **nie geübt/getimt**, nicht signalgetrieben.
- **`A-08` · Security-Scanning als Kontrolle — `FAIL`.** Kein SAST/DAST/SCA/Secret-Scan als blockierendes Gate (keine CI). Kein SBOM. Keine Suppression-Zählung.
- **`A-24` · System betreibt & erholt sich selbst — `FAIL`.** Keine SLOs/SLIs, kein Error-Budget, keine Golden-Signals, keine automatische Erkennung/Containment/Recovery. `restart: always` deckt nur Prozess-Crash/Reboot. Healthcheck vorhanden (`/health`), aber keine automatische Wiederherstellung bei Fehlfunktion.
- **`B-01` · Pipeline gated wirklich — `FAIL`.** Es gibt keine Pipeline. (18 Treffer für `|| true` sind Best-Effort-Cleanups in `deploy.sh`, kein Test-Soft-Fail — aber es gibt eben auch kein Test-Gate.)
- **`B-03` · Observability bis zum Root-Cause — `FAIL`.** Kein OpenTelemetry, keine korrelierten Logs/Metriken/Traces. Es gibt Zugriffs-Tracking (eigene DB-Tabelle) und ein Deploy-Log, aber keine drei Säulen.
- **`B-04` · Abhängigkeiten existieren, gepinnt, geprüft — `PARTIAL`.** `package-lock.json` pinnt (Integritäts-Hashes). **Aber:** keine Pre-Install-Existenzprüfung als Gate, keine SCA, keine nächtliche Re-Verifikation. Stichprobe der Kern-Deps ergab reale, etablierte Pakete — kein Slopsquatting-Treffer sichtbar.
- **`B-11` · Rollback für Code/Prompt/Modell — `PARTIAL`.** DB-Backup vor jedem Deploy (`deploy.sh` §4). **Aber:** Rollback nie geübt, keine getrennte Prompt-/Modell-Versionierung mit One-Command-Rollback, nicht signalgetrieben.
- **`B-20` · Runtime-Erkennung/Containment von Injection & Exfiltration — `N/A` (begründet).** Das eine KI-Feature hat **keinen** Tool-/Egress-Pfad, den das Modell steuern könnte: Eingabe ist vom Admin eingefügter Text, Ausgabe ist JSON, das der Admin prüft. Keine „private Daten + untrusted content + Ausgangskanal"-Kombination. → kein Exfiltrations-Kanal vorhanden.
- **`B-22` · Agenten mit Least-Privilege — `N/A` (begründet).** Es gibt kein Agenten-Runtime; das Modell ruft keine Tools. Kein Scope zu beschränken.
- **`A-36` · Kalibrierung der Verifikations-Pipeline — `FAIL` (eskaliert zu BLOCKER-1, da Catch-Rate nicht gemessen).** Keine Seeded-Defect-Kalibrierung, keine Catch-Rate-SLI, kein Game-Day.

---

## BLOCKER-2 (Priorität 8)

- **`A-04` · Testbare Spezifikation, gated — `FAIL`.** `docs/PLAN.md`/`ABNAHME.md` existieren, aber keine testbaren Given/When/Then-Kriterien mit Requirement→Test-Map, kein Spec-Coverage-Gate.
- **`A-09` · Architektur wie entschieden — `FAIL`.** Keine ADRs, keine Architektur-Fitness-Functions.
- **`A-10` · Injektions-resistente Architektur — `PARTIAL`.** Struktureller Trust-Boundary ist günstig (kein Tool-Use, Ausgabe geprüft), strikte CSP in `next.config.ts`. **Aber:** keine Injektions-Szenarien in CI, kein Regression-Gate.
- **`A-17` · NFRs spezifiziert & gemessen — `FAIL`.** Keine NFR-Tabelle mit Zahlen/Tests über die neun Qualitätsmerkmale.
- **`A-22` · Nutzer-Outcomes, Performance, Barrierefreiheit — `PARTIAL`.** Semantisches HTML, Alt-Texte, `prefers-color-scheme` vorhanden; **aber** kein automatisiertes A11y-Gate (WCAG 2.2 AA), keine Core-Web-Vitals-SLIs, kein RUM. **WCAG ist in der EU Rechtspflicht** — hier ungeprüft.
- **`A-25` · Eingabevalidierung an jeder Grenze — `PARTIAL` (strukturell gut).** Alle Queries parametrisiert (Drizzle + `sql\`\`` mit gebundenen Parametern); FTS-Tabellenname ist eine **Compile-Zeit-Union-Allowlist** (`"recipe_fts"|"travel_fts"|"dish_fts"`), FTS-Query wird bereinigt (Quotes/Sterne entfernt); Zod-Schemas auf Formularen. **Aber:** keine Property-/Fuzz-Tests, kein „neue Grenze ohne Validator"-Gate.
- **`A-33` · Wartbarkeit ohne Wartenden (Cold-Start-Agent) — `NO-EVIDENCE`.** Nicht gemessen. `CLAUDE.md`-artige Agenten-Anweisung / Cold-Start-Erfolgsrate nicht als Metrik geführt.
- **`A-34` · Autonomie-Level & Kill-Switch — `N/A`/`PARTIAL`.** Keine autonomen Aktionsklassen (Modell tut nichts Irreversibles). Der „Aktualisierung"-Deploy ist die einzige folgenreiche Aktion und wird vom **Admin** ausgelöst (kein Auto-Halt nötig, aber auch keiner vorhanden).
- **`B-02` · Befahrbare „Paved Road" — `PARTIAL`.** `bootstrap.sh` + `deploy.sh` + README-Setup vorhanden und kohärent; **aber** nicht nächtlich verifiziert, keine Cold-Start-Agenten-Prüfung.
- **`B-05` · Lifecycle für Modelle/Prompts/Agenten — `FAIL`.** Kein Registry; der Prompt lebt als String-Literal in `src/lib/ai-recipe.ts`, keine Versionierung/Eval-Historie.
- **`B-07` · Jeder Modell-Lauf traceable/replaybar — `FAIL`.** Kein GenAI-Span-Tracing, keine Replay-Fähigkeit (Modell, Prompt, Tokens, Kosten pro Interaktion).
- **`B-10` · Evaluations-Gates in der Pipeline — `FAIL`.** Kein Golden-Dataset, kein Regression-Eval-Gate für Prompt-Änderungen.
- **`B-12` · Runtime-Defense — `PARTIAL`.** nginx als Proxy (README), strikte Header. **Aber:** keine dokumentierten/automatisierten Patch-SLAs, keine WAF/Runtime-Threat-Detection.
- **`B-13` · Gepinnte Modell-Versionen — `PARTIAL` (heute korrekt).** `claude-opus-4-8` ist ein gepinnter Snapshot, **kein** „latest"-Alias (bestätigt in `ai-recipe.ts:189`). **Aber:** kein CI-Check, der Aliase verbietet → nichts hält es.
- **`B-15` · Guardrails als Artefakte, fail-closed — `N/A`.** Es gibt keine Guardrail-/Klassifikator-Schicht (kein Tool-Use, keine Moderationskette).
- **`B-28` · Erkennung, die Aktion auslöst — `FAIL`.** Alerts/automatische Reaktionen fehlen; keine synthetische Überwachung.
- **`B-31` · Backups, die du wirklich restauriert hast — `PARTIAL`.** Pre-Deploy-DB-Backup + `deploy/backup.sh` (README). **Aber:** kein getimter Restore-Drill, RPO/RTO nicht dokumentiert.

---

## MUST-FIX (Priorität 7) — verdichtet

- **`A-05` Domänengrenzen — `PARTIAL`** (saubere `src/lib`-Modularisierung, konsistente Begriffe; keine Fitness-Function).
- **`A-07` Klone/Churn — `NO-EVIDENCE`** (kein Klon-Detektor gelaufen; Code wirkt DRY, `QuickAddCheckboxes`/`ImagePicker` sind geteilt).
- **`A-11` Least-Privilege-Topologie — `N/A`** (keine Tools/Agenten).
- **`A-12` Tech-Debt/Rekonstruierbarkeit — `PARTIAL`** (Module gut kommentiert, aber keine Spec-/Provenance-Verknüpfung, kein Reconstruction-Check).
- **`A-13` Erzwungene Coding-Standards — `PARTIAL`** (ESLint-Flat-Config **fehlt** — `npx eslint` schlug fehl; `tsc --noEmit` grün; kein blockierendes Standard-Gate).
- **`A-18` Modell-/Agenten-Architektur bewusst gewählt — `PARTIAL`** (einfachste sinnvolle Wahl: ein Aufruf, kein Multi-Agent; aber kein ADR).
- **`A-19` API-Verträge = Implementierung — `N/A`/`PARTIAL`** (keine öffentliche versionierte API; interne API-Routen sind admin-intern).
- **`A-21` Kontext/Retrieval/Memory — `N/A`** (kein RAG/Memory; ein Stateless-Aufruf).
- **`A-23` Datenarchitektur & Ownership — `PARTIAL`** (Schema versioniert über Drizzle-Migrationen; kein Schema-Drift-/Quality-Monitoring).
- **`A-26` Fehlerbehandlung, die nicht lügt — `PARTIAL`.** ~70 `catch`-Stellen, überwiegend **UI-Fehlerbehandlung, die eine Nutzermeldung setzt** (nicht still). Wenige Best-Effort-Swallows in Skripten sind kommentiert (`/* ignorieren */`). I/O hat teils Timeouts (Anthropic-Client 90 s). **Aber:** kein Bare-Handler-Lint, kein flächiger Timeout/Circuit-Breaker-Nachweis.
- **`A-27` KI-spezifische NFRs — `PARTIAL`** (Timeout 90 s, `max_tokens` 8000, `maxRetries` 1 begrenzen den einen Aufruf; keine erzwungenen Latenz-/Kosten-/Groundedness-Budgets).
- **`A-28` Abhängigkeits-Blast-Radius — `PARTIAL`** (Anthropic-Ausfall wird abgefangen — klare Fehlermeldung, `testConnection`; keine Map/Chaos-Prüfung).
- **`A-32` Doku wahr & ausführbar — `PARTIAL`** (README aktuell und detailliert; keine Doku-als-Tests in CI; Agenten-Instruktionsdatei nicht als Policy-Artefakt geführt).
- **`A-38` Provenance/Lizenzen — `FAIL`** (kein Lizenz-Scan, kein SBOM, keine IP-Position; relevant für Track-C/Recht).
- **`B-08` Keine unbegrenzten Tokens/Kosten — `PARTIAL`.** Ein KI-Aufruf pro Job, `max_tokens` begrenzt, admin-only, Rate-Limiting existiert (`src/lib/ratelimit.ts` für likes/beacon). **Aber:** kein Kosten-Cap/Cut-off in Infrastruktur, keine Tiefen-/Rekursionskappe (mangels Tool-Use aber irrelevant).
- **`B-09`/`B-27` Signierte Provenance/Artefakt-Integrität — `FAIL`** (keine Signaturen/Attestierung/Verify-on-Deploy).
- **`B-17`/`B-32` IaC & Drift — `FAIL`/`N/A`** (kein IaC; Server manuell via `bootstrap.sh` provisioniert).
- **`B-19` SLOs mit beißendem Error-Budget — `FAIL`.**
- **`B-23` Agenten-Baselines — `N/A`** (keine Agenten).
- **`B-24` Quality-Drift-Detection — `FAIL`** (keine Online-Eval).
- **`B-25` Umgebungs-Trennung — `PARTIAL`.** `.env` extern, `DATA_DIR` getrennt; **aber** keine automatisierte Assertion „keine Prod-Credentials in Non-Prod". Für einen Ein-Server-Blog geringes Risiko, aber ungeprüft.
- **`B-29` Reliability-Primitive, durch Kaputtmachen validiert — `FAIL`** (kein Chaos-Experiment).
- **`B-33` Retrieval-Korpus-Integrität — `N/A`** (kein Retrieval-Korpus).

---

## SHOULD-FIX (Priorität 6) — verdichtet
`A-03` Determin./probabil. Assertions getrennt — **PARTIAL** (kaum modell-geurteilte Tests; der Saisonvorschlag ist deterministisch, nicht KI). ·
`A-14` KI-Bau-Policy — **FAIL** (keine dokumentierte Tier-/Verifikations-Policy). ·
`A-16` Stubs/Edge-Cases — **PARTIAL** (0 Stub-Marker in `src/` gefunden; kein Stub-Lint-Gate). ·
`A-20` Prompts als Code, gleiches Gate — **FAIL** (Prompt ist Inline-String; kein Gate). ·
`A-29`/`A-30`/`A-31` TCO/Trade-offs/Unit-Economics — **FAIL** (nicht dokumentiert; für Solo-Blog gering-materiell). ·
`A-35` Runtime-Containment ohne Operator — **PARTIAL** (eine „pending"-artige Stelle: `deploy-request`-Datei → systemd; kein blockierender Approval-Queue). ·
`B-14` Prompt-/Config-Governance — **FAIL**. ·
`B-16` Kostenattribution — **FAIL** (gering-materiell). ·
`B-18` Progressive Delivery mit Auto-Abort — **FAIL** (100%-Deploy, kein Canary). ·
`B-21` Provider-Ausfall überstehen — **PARTIAL** (KI-Feature degradiert mit klarer Meldung; der Blog selbst hängt nicht am Modell). ·
`B-26` Feature-Flags/Kill-Switches — **PARTIAL** (Newsletter/KI über Settings abschaltbar; kein automatischer Tripwire). ·
`B-30` Kapazität/Inferenz — **N/A/PARTIAL** (Solo-Traffic; kein Lasttest). ·
`B-35` Gate vom Gegateten trennen — **FAIL** (es gibt kein Gate und kein Policy-Bundle; keine Segregation — aber auch kein „Agent editiert sein Gate", da kein Gate). ·
`B-36` Modell-Deprecation-Plan — **PARTIAL** (gepinnt; keine automatische EOL-Überwachung).

---

## PLAN (Priorität 5) & ASSESS (≤4)
`A-15` Prototyp/Prod-Grenze — **FAIL** (kein Gate → keine Grenze). ·
`A-37` Takeover-Readiness — **PARTIAL** (README/bootstrap; nicht geübt). ·
`B-34` Latenzbudgets Inferenz — **NO-EVIDENCE**. ·
`B-37` Erasure/Retirement — **PARTIAL** (Lösch-Lib existiert für Inhalte; keine end-to-end-Erasure-Prüfung über alle abgeleiteten Stores; Newsletter-PII relevant). ·
`B-39` Referenz-Framework — **FAIL**. ·
`A-40` Energie/Carbon — **N/A** (immateriell). ·
`B-38` Inferenz-Ökonomie — **N/A** (gering-materiell).

---

## Deckungs-Ledger (Kurzform)
Alle 62 Seiten-Routen, 12 API-Routen, 45 Lib-Module, 3 Migrationen und 5 Skripte
wurden mindestens von einer Prüfung berührt (Auth, Eingabevalidierung,
Fehlerbehandlung, Egress, Secrets, Deploy-Kette). Kein Oberflächen-Item blieb
ungeprüft. Detaillierte Zeile-für-Zeile-Zuordnung ist in diesem ersten Durchgang
nicht vollständig materialisiert — das ist die offene Arbeit für einen zweiten Pass.
