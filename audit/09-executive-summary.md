# Executive Summary — Due-Diligence-Mandat (beide Volumes, 119 Prüfungen)

**Stand:** 2026-07-17 · **Katalog:** v2.0 (ratifiziert) · **Commit:** `160228f`-Baseline
**Verfassung:** `RATIFIED@v2.0`, Hash `65a0f3fb…` · **`production_eligible`: `false` (computed)**

Dies ist der Bericht über das, was noch falsch ist — und was jetzt darauf wartet.
Nicht über das, was gut aussieht.

## Ergebnis in einem Satz
Track C (Security, Privacy, Assurance — 40 Prüfungen) ist **vollständig auditiert
und geschlossen**, mit 12 neuen, CI-blockierenden Kontrollen, die jede einen
injizierten Defekt fangen; die Produktionsfreigabe bleibt dennoch **verweigert**,
weil die Gesamt-Berechnung 19 offene Blocker aus Part 1 trägt — allen voran den
unabhängigen Fremd-Vendor-Verifier, der hier strukturell nicht existiert.

## Zahlen (nicht aufgerundet)
- **119 Prüfungen:** 43 PASS · 45 PARTIAL · 27 N/A · 3 FAIL · 1 NO-EVIDENCE.
- **Track C (40):** 24 PASS · 15 N/A (jede mit schriftlicher Begründung +
  Reaktivierungs-Tripwire) · 1 PARTIAL (C-30, Residual).
- **Offene Blocker (computed über 119):** 2 STOP-SHIP, 4 BLOCKER-1, 13 BLOCKER-2 —
  **alle aus Part 1/Track A/B**. Offene Track-C-Blocker: **0**.
- **Pipeline-Fangrate (Kalibrier-Korpus, nicht meine):** alle **7 aktiven**
  Seed-Klassen (S1/S3/S4/S5/S7/S8/S9) werden gefangen; 2 Klassen N/A (kein
  Mandant, kein Tool-Use). `inject.mjs --strict` grün. Das ist die Fangrate des
  Korpus, den wir gebaut haben — kein Beweis, dass jeder reale Defekt gefangen wird.

## Was Track C konkret geschlossen hat (jede Kontrolle fangen gesehen)
- **C-01 Kern-Sicherheit:** Authz-Coverage-Gate — 49 Admin-Handler alle
  server-seitig geguardet; ein ungeguardeter Handler kann nicht mergen.
- **C-04/C-23 Datenschutz:** Datenkarte generiert+gedifft (neuer PII-Store fällt
  den Build), Erasure end-to-end gegen ein Kanarien-Subjekt getestet (rot-vorher
  bewiesen), ops-Retention 90 T, DPIA + RoPA.
- **C-05/C-07/C-08/C-12 KI-Risiko:** 10-Kategorien-Matrix (leere Zelle → Build
  fällt), Injection-Containment (Schema strippt Aktionsfelder), KI-Fähigkeits-Guard
  (Tool/Egress/RAG/Fine-Tune → Build fällt) — die stehende Kontrolle hinter 12 N/A.
- **C-09/C-36 EU-AI-Act:** AI-System-Inventar + Article-50-Bewertung + „KI-Entwurf"-
  Kennzeichnung (UI-Test).
- **C-24/C-25/C-26 Assurance:** Prompt-Secret-Scan, Lizenz-/Copyleft-Scan, AI-BOM +
  Mandat-Provenance am Deploy verifiziert (fail-closed).
- **C-37 Rechenschaft:** jede der 180 Quelldateien fällt unter genau eine
  Owning-Role; Policy-Bundle verifiziert; geplante Spot-Rekonstruktion fällt laut,
  wenn die Kette bricht.

## Warum `production_eligible` `false` bleibt — die Liste
`production_eligible` wird **computed**, nicht behauptet. Es bleibt false, solange
irgendein Blocker offen ist. Offen sind, ausschließlich aus Part 1:
1. **A-01 / A-39 (STOP-SHIP) — der unabhängige Fremd-Vendor-Verifier.** Regel 6 /
   Artikel IV verlangen, dass jede Änderung von einem Verifier *eines anderen
   Anbieters* angegriffen wird. In dieser Ein-Vendor-Umgebung existiert der nicht.
   Das ist kein Versäumnis, sondern eine Umgebungsgrenze — und der einzige Grund,
   der allein schon die Freigabe verwehrt. Kompensation verdrahtet; Tripwire scharf.
2. **A-06/A-08/B-11/A-36 (BLOCKER-1):** kein geübter/getimter Rollback, kein DAST,
   kein Rollback-Signal, keine fortlaufende Kalibrier-Injektion (braucht Cron-Host).
3. **13 BLOCKER-2:** Architektur-Fitness-/Fuzz-/CWV-Gates, Auto-Halt, Eval-Gate
   (durch C-10 teilweise gemildert), Patch-SLA/WAF, Auto-Remediation.

Keiner dieser 19 ist ein KI-Sicherheits- oder Datenschutz-Loch. Es ist die
Betriebs- und Assurance-Reife, die ein Solo-Self-Host-Blog noch nicht erreicht hat.

## Was als Nächstes schiefgehen wird — und was darauf wacht
- **Ein still hinzugefügter Tool-/RAG-/Agenten-Pfad** würde 12 N/A-Verdikte
  ungültig machen → `ai-capability-guard` fällt den Build.
- **Ein neuer PII-Store ohne Eintrag** → `data-map` fällt den Build.
- **Ein neuer ungeguardeter Admin-Handler** → `authz-coverage` blockiert den Merge.
- **Ein Provider-Modellwechsel** kann Injection-/Jailbreak-Zahlen verschieben →
  Modell gepinnt, Wechsel ist eine Code-Änderung durchs Gate; C-30-Tripwire.
- **Ein öffentlich-nutzerseitiger KI-Endpunkt** reaktiviert C-07/C-29/C-38 →
  dann sind admin-only-Kompensationen nicht mehr gültig.

## Die zwei Tests, ein letztes Mal
> *Wenn alle Menschen einen Monat in Urlaub gingen — hielte das noch?* Die
> Track-C-Kontrollen ja (sie laufen im Gate); die 19 offenen Part-1-Posten
> brauchen Menschen-/Infra-Arbeit, die noch aussteht.
> *Wenn niemand ein Jahr lang etwas anfasst — wäre es noch wahr?* Die N/A-Verdikte
> bleiben wahr, solange der Guard sie bewacht; die Provenance-Kette wird bei jedem
> Deploy neu rekonstruiert; die Datenkarte bei jedem Build neu generiert.

**Das System ist nicht produktionsreif. Es ist ehrlich vermessen, und die
Maschine, die es dicht hält, läuft.**
