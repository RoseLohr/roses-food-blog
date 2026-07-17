# audit/03 — Befunde (Phase 3 + Phase-6-Re-Audit, Katalog v1.0)

> **Phase-6-Stand (nach Remediation Wave 1–3):** 11 PASS · 34 PARTIAL · 19 FAIL ·
> 12 N/A · 3 NO-EVIDENCE. Discovery-Ausgang war 0 PASS / 32 FAIL. Verdikte nur
> mit **demonstrierter** stehender Kontrolle auf PASS gehoben (§3); Maschinen-
> lesbar in `audit/03-findings.json`. Verbleibende FAIL sind überwiegend infra-
> lastige Checks (Observability/SLO/Canary/IaC), die für einen Solo-Blog als
> Residual mit Tripwire geführt oder N/A sind — siehe `audit/06`/`audit/10`.


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

---

## Track C — Security, Privacy & Assurance (Katalog v2.0, Phase 0′ aktiviert)

Am 2026-07-17 per Beschlussakte (`audit/evidence/phase0prime-decision-record.md`)
aktiviert. Alle 40 Prüfungen `C-01`…`C-40` treten als **NO-EVIDENCE** ein und
blockieren an ihren Bändern, bis Phase 3′ jeden Fall gegen die frozen
Phase-0′-Baseline (`160228f`) prüft. Bandverteilung:

- **STOP-SHIP (10):** `C-01` Kern-App-Sicherheit · `C-04` Datenschutz/GDPR
- **BLOCKER-1 (9):** `C-03` Lieferkette/halluzinierte Pakete · `C-05` LLM-Risiko-Taxonomie · `C-07` Prompt-Injection · `C-09` EU-AI-Act · `C-27` Sektor-Compliance
- **BLOCKER-2 (8):** `C-02` Threat-Model · `C-06` agentische Risiko-Taxonomie · `C-08` „gefährliche Drei" · `C-10` Evaluierungsmethodik · `C-23` PII in Logs/Traces · `C-26` SBOM/AI-BOM/Provenance
- **MUST-FIX (7):** `C-11` KI-Risikoprogramm · `C-12` Excessive Agency · `C-15` Guardrail-Tests · `C-16` Maschinenidentität · `C-17` Tool-Poisoning · `C-18` Connector-Sicherheit · `C-21` Trainingsdaten-Governance · `C-22` Retrieval-vs-Generation · `C-24` System-Prompt-Leakage · `C-28` Residency · `C-34` Provider-Training
- **SHOULD-FIX (6):** `C-13` KI-Managementsystem · `C-14` Judge-Validierung · `C-19` Memory-Poisoning · `C-20` Responsible-AI-Dimensionen · `C-25` Copyright generierter Code · `C-29` Content-Safety · `C-30` Jailbreak-Resistenz · `C-32` Vektor/Embedding · `C-33` KI-Nutzungspolitik · `C-36` Transparenz/Kennzeichnung · `C-38` Fabrikation/Zitate
- **PLAN (5):** `C-31` Adversarial-Taxonomie · `C-37` Rechenschaft ohne Unterschrift *(eskaliert zu BLOCKER-1, falls ein Prod-Bestandteil keine attestierte Provenance-Kette trägt — Phase-3′-Entscheidung)*
- **ASSESS (≤4):** `C-35` Benchmark-Kontamination · `C-39` Lifecycle-Standards · `C-40` Gesellschaft/Umwelt

Verdikte, N/A-Begründungen (schriftlich, mit Reaktivierungs-Tripwire) und
stehende Kontrollen folgen in Phase 3′/5′.

---

## Track C — Phase-3′-Verdikte (Baseline `160228f`, vor Phase-5′-Kontrollen)

Initialverdikt je Prüfung gegen die frozen Phase-0′-Baseline. PARTIAL/FAIL-Blocker
werden in Phase 5′ mit stehenden Kontrollen geschlossen; N/A trägt schriftliche
Begründung + Reaktivierungs-Tripwire (ai-capability-guard, Phase 5′). Die
Initialverdikte bleiben im Audit-Trail erhalten (Phase 6′ aktualisiert den Zustand).

| ID | Prüfung | Band | Verdikt | Kern-Lücke → Remediation Phase 5′ |
|---|---|---|---|---|
| C-01 | Kern-App-Sicherheit | STOP-SHIP | **PARTIAL** | Authz-Coverage-Gate + Seed S9 |
| C-02 | Threat-Model | BLOCKER-2 | **FAIL** | STRIDE-Threat-Model + Boundary-Detector |
| C-03 | Lieferkette/halluzinierte Pakete | BLOCKER-1 | **PARTIAL** | Registry-Alters-Check + Playbook |
| C-04 | Datenschutz/GDPR | STOP-SHIP | **PARTIAL** | DPIA/RoPA + Datenkarte + Erasure-Kanarien-Test + ops-Retention |
| C-05 | LLM-Risiko-Taxonomie | BLOCKER-1 | **FAIL** | 10-Kategorien-Matrix + Empty-Cell-Gate |
| C-06 | Agentische Risiko-Taxonomie | BLOCKER-2 | **N/A** | N/A — ai-capability-guard-Tripwire |
| C-07 | Prompt-Injection | BLOCKER-1 | **PARTIAL** | Injektions-Suite + Restrisiko-Doku + Seed S7 |
| C-08 | Die „gefährliche Drei" | BLOCKER-2 | **PARTIAL** | Trifecta-Assertion (guard) + Seed S8 |
| C-09 | EU-AI-Act | BLOCKER-1 | **PARTIAL** | KI-System-Inventur + Article-50-Bewertung |
| C-10 | Evaluierungsmethodik | BLOCKER-2 | **PARTIAL** | Golden-Eval-Set + Schwellwert-Gate |
| C-11 | KI-Risikoprogramm | MUST-FIX | **PARTIAL** | NIST-AI-RMF-Mapping (pipeline-emittiert) |
| C-12 | Excessive Agency | MUST-FIX | **PARTIAL** | Least-Agency-Assertion (guard) |
| C-13 | AI-Managementsystem | SHOULD-FIX | **N/A** | N/A — kein AI-MS beansprucht |
| C-14 | Judge-Validierung | SHOULD-FIX | **N/A** | N/A — kein Judge-Gate |
| C-15 | Guardrail-Tests | MUST-FIX | **N/A** | N/A — keine Guardrail-Schicht |
| C-16 | Maschinenidentität | MUST-FIX | **N/A** | N/A — keine Agenten-Identität |
| C-17 | Tool-Poisoning | MUST-FIX | **N/A** | N/A — kein Tool/MCP |
| C-18 | Connector-Sicherheit | MUST-FIX | **N/A** | N/A — kein Connector |
| C-19 | Memory-Poisoning | SHOULD-FIX | **N/A** | N/A — kein Agenten-Memory |
| C-20 | Responsible-AI-Dimensionen | SHOULD-FIX | **PARTIAL** | Dimensionen mit Owner + Maß |
| C-21 | Trainingsdaten-Governance | MUST-FIX | **N/A** | N/A — kein Custom-Modell |
| C-22 | Retrieval-vs-Generation | MUST-FIX | **N/A** | N/A — kein RAG |
| C-23 | PII in Logs/Traces | BLOCKER-2 | **PARTIAL** | PII-Emitter-Scan + ops-Retention |
| C-24 | System-Prompt-Leakage | MUST-FIX | **PARTIAL** | Prompt-Secret-Scan in CI |
| C-25 | Copyright generierter Code | SHOULD-FIX | **PARTIAL** | Lizenz-Scan + IP-Position |
| C-26 | SBOM/AI-BOM/Provenance | BLOCKER-2 | **PARTIAL** | AI-BOM + Verify-on-Deploy |
| C-27 | Sektor-Compliance | BLOCKER-1 | **N/A** | N/A — kein bindendes Framework |
| C-28 | Residency | MUST-FIX | **PARTIAL** | Residency-Doku + Assertion |
| C-29 | Content-Safety | SHOULD-FIX | **PARTIAL** | Content-Safety-Policy |
| C-30 | Jailbreak-Resistenz | SHOULD-FIX | **PARTIAL** | ASR-Restrisiko + Tripwire |
| C-31 | Adversarial-Taxonomie | PLAN | **PARTIAL** | Sieben-Schichten-Mapping (via C-02) |
| C-32 | Vektor/Embedding | SHOULD-FIX | **N/A** | N/A — kein Vektor-Store |
| C-33 | KI-Nutzungspolitik | SHOULD-FIX | **PARTIAL** | Klausel-Enforcement-Mapping |
| C-34 | Provider-Training | MUST-FIX | **PARTIAL** | DPA-Doku + No-Training-Assertion |
| C-35 | Benchmark-Kontamination | ASSESS | **N/A** | N/A — keine Benchmark-Aussage |
| C-36 | Transparenz/Kennzeichnung | SHOULD-FIX | **PARTIAL** | Kennzeichnungs-Erklärung + UI-Test |
| C-37 | Rechenschaft ohne Unterschrift | BLOCKER-1 | **PARTIAL** | Provenance-Kette + Owning-Role-Registry + Spot-Rekonstruktion |
| C-38 | Fabrikation/Zitate | SHOULD-FIX | **PARTIAL** | Nicht-Präsentation-Position + Test |
| C-39 | Lifecycle-Standards | ASSESS | **N/A** | N/A — an C-13 gekoppelt |
| C-40 | Gesellschaft/Umwelt | ASSESS | **N/A** | N/A — immateriell |

**Track-C-Bilanz Phase 3′:** {"PARTIAL":23,"FAIL":2,"N/A":15} · offene Blocker: C-01, C-04 (STOP-SHIP); C-03, C-05, C-07, C-09, C-37 (BLOCKER-1); C-02, C-08, C-10, C-23, C-26 (BLOCKER-2). C-37 zu BLOCKER-1 eskaliert (Prod-Bestandteile ohne attestierte Provenance-Kette).

---

## Track C — Phase-6′-Verdikte (nach Remediation)

| ID | Band | Verdikt | Stehende Kontrolle |
|---|---|---|---|
| C-01 | STOP-SHIP | **PASS** | authz-coverage.mjs (CI, --selftest) + Kalibrier-Seed S9; Ratchet: ungeguardete Handler=0 |
| C-02 | BLOCKER-2 | **PASS** | boundary-check.mjs (CI) + threat-model.md; neue Integration ohne Threat-Eintrag → Build fällt |
| C-03 | BLOCKER-1 | **PASS** | deps-existence.mjs + Lockfile + npm audit + Seed S3 (monatlich); Registry-Alter als nächtliche Kadenz + Playbook |
| C-04 | STOP-SHIP | **PASS** | data-map.mjs (CI, generiert+gedifft) + tests/erasure.integration.test.ts (Kanarie) + Retention; DPIA/RoPA |
| C-05 | BLOCKER-1 | **PASS** | llm-matrix-check.mjs (leere Zelle→Build fällt) + ai-budget-check.mjs (Caps) |
| C-06 | BLOCKER-2 | **N/A** | ai-capability-guard.mjs (Tool-Use/Agent→Build fällt); Reaktivierungs-Tripwire |
| C-07 | BLOCKER-1 | **PASS** | tests/injection.containment.test.ts + ai-capability-guard.mjs + Seed S7; Restrisiko schriftlich (injection-residual.md) |
| C-08 | BLOCKER-2 | **PASS** | ai-capability-guard.mjs (No-Egress/Trifecta) + Seed S8; per Inspektion entscheidbar |
| C-09 | BLOCKER-1 | **PASS** | ai-system-inventory.md (Article-50-Bewertung) + tests/ai-disclosure.test.ts |
| C-10 | BLOCKER-2 | **PASS** | tests/ai-eval.golden.test.ts (Golden-Set, eingefrorener Schwellwert 100 %, Ratchet) |
| C-11 | MUST-FIX | **PASS** | governance/ai-governance.md (NIST-RMF govern/map/measure/manage, pipeline-emittierte Evidenz) |
| C-12 | MUST-FIX | **PASS** | ai-capability-guard.mjs (Least-Agency-Assertion: null Tools/Scopes) |
| C-13 | SHOULD-FIX | **N/A** | ai-capability-guard/keine MS-Behauptung; Tripwire bei Zertifizierungsanspruch |
| C-14 | SHOULD-FIX | **N/A** | ai-capability-guard; Tripwire bei erstem Modell-bewertet-Modell-Gate |
| C-15 | MUST-FIX | **N/A** | ai-capability-guard + Injektions-Suite (adversariale Absicht); Tripwire bei Guardrail-Schicht |
| C-16 | MUST-FIX | **N/A** | ai-capability-guard; Tripwire bei erster Agenten-Identität |
| C-17 | MUST-FIX | **N/A** | ai-capability-guard (MCP/Tool→Build fällt); Tripwire bei erster Tool-Anbindung |
| C-18 | MUST-FIX | **N/A** | ai-capability-guard; Tripwire bei erstem Connector |
| C-19 | SHOULD-FIX | **N/A** | ai-capability-guard; Tripwire bei erstem Memory-/Kontext-Store |
| C-20 | SHOULD-FIX | **PASS** | governance/ai-governance.md (Dimensionen mit Owner+Maß) + ai-disclosure.test.ts |
| C-21 | MUST-FIX | **N/A** | ai-capability-guard (Fine-Tune→Build fällt); Tripwire bei Custom-Modell |
| C-22 | MUST-FIX | **N/A** | ai-capability-guard (Embeddings→Build fällt); Tripwire bei RAG |
| C-23 | BLOCKER-2 | **PASS** | data-map.mjs (Store-Klassifikation) + purgeOldOpsEvents (90 T) + logJson personenbezug-frei |
| C-24 | MUST-FIX | **PASS** | prompt-scan.mjs (Secrets/PII im Prompt→Build fällt) + Prompt-Registry (A-20) |
| C-25 | SHOULD-FIX | **PASS** | license-scan.mjs (kein AGPL/GPL/SSPL) + ip-position.md |
| C-26 | BLOCKER-2 | **PASS** | ai-bom.mjs --verify (Modelle==Code) + mandate-hash.mjs --verify (fail-closed am Deploy) |
| C-27 | BLOCKER-1 | **N/A** | Applikabilität bestimmt (nur GDPR, via C-04); Tripwire bei Zahlungs-/Gesundheitsdaten/Zertifizierung |
| C-28 | MUST-FIX | **PASS** | data-map.mjs (jeder Store bekannt) + governance/ai-governance.md (Residency) |
| C-29 | SHOULD-FIX | **PASS** | governance/ai-governance.md (Content-Safety, admin-only) + ai-capability-guard (Tripwire öffentlicher Endpunkt) |
| C-30 | SHOULD-FIX | **PARTIAL** | — (Residual) |
| C-31 | PLAN | **PASS** | boundary-check.mjs + ai-capability-guard (7 agentische Schichten leer gehalten) |
| C-32 | SHOULD-FIX | **N/A** | ai-capability-guard (Embeddings→Build fällt); Tripwire bei Vektor-Store |
| C-33 | SHOULD-FIX | **PASS** | governance/ai-governance.md (Klausel→Gate-Mapping); Klauseln maschinell erzwungen |
| C-34 | MUST-FIX | **PASS** | B-13 Modell-Pin (Wechsel=Code-Änderung durchs Gate) + governance/ai-governance.md (Provider-Terms/DPA) |
| C-35 | ASSESS | **N/A** | ai-capability-guard/keine Benchmark-Aussage; Tripwire bei erster Benchmark-Behauptung |
| C-36 | SHOULD-FIX | **PASS** | tests/ai-disclosure.test.ts (KI-Entwurf-Badge) + Kennzeichnungs-Erklärung |
| C-37 | BLOCKER-1 | **PASS** | provenance-reconstruct.mjs (180 Dateien je Owning-Role, Policy-Bundle, Spot) + mandate-hash.mjs |
| C-38 | SHOULD-FIX | **PASS** | governance/ai-governance.md (keine Zitat-Fläche, in-command-Autorschaft) + ai-capability-guard |
| C-39 | ASSESS | **N/A** | an C-13 gekoppelt; Tripwire bei MS-Behauptung |
| C-40 | ASSESS | **N/A** | Tripwire bei Berichtspflicht/Workload-Formänderung |

**Bilanz:** {"PASS":24,"N/A":15,"PARTIAL":1} · offene Track-C-Blocker: 0.
