# Verifikations-Record — Track C (Phase 5′/6′)

Je Fix: der rote Test/Seed, der grüne Nachweis, die stehende Kontrolle, die ich
**fangen gesehen** habe. Eine Kontrolle, die ich nicht habe feuern sehen, ist eine
Hoffnung — und Hoffnung hat diesen Codebestand gebaut.

---

## Welle 1 — Strukturelle Türen

### C-01 · Authz-Coverage-Gate — `scripts/regime/authz-coverage.mjs`
- **Seed (rot):** synthetischer `deleteEverythingAction()` ohne `requireAdmin` →
  `--selftest` meldet „✗ ungeguardet" und Exit≠0. **Gesehen gefangen.**
- **Gegenprobe (grün):** geguardeter `POST`-Handler mit `getCurrentAdmin()` wird
  NICHT geflaggt.
- **Realer Bestand:** 49 Admin-Handler geprüft, alle server-seitig geguardet
  (Allowlist nur Login/Logout, begründet).
- **Stehende Kontrolle:** CI-Step „Authz-Coverage" (blockierend) + Kalibrier-Seed
  S9. Ratchet: ungeguardete Handler bleiben bei 0.

### N/A-Härtung · KI-Fähigkeits-Guard — `scripts/regime/ai-capability-guard.mjs`
- **Seed (rot):** injizierter `tools:[…]`-Aufruf → `--selftest` meldet
  Reaktivierung von C-06/08/12/17 und Exit≠0. **Gesehen gefangen.**
- **Gegenprobe (grün):** der reale schema-gebundene `messages.parse`-Aufruf (ohne
  `tools:`) wird nicht geflaggt; 5 KI-Quelldateien sauber.
- **Stehende Kontrolle:** CI-Step „KI-Fähigkeits-Guard" (blockierend) + Seeds
  S7/S8. Ratchet: reaktivierende Fähigkeiten bleiben bei 0. Dies ist die stehende
  Kontrolle hinter den 12 struktur-bedingten N/A-Verdikten.

## Welle 2 — Datenschutz (STOP-SHIP C-04, C-23)

### C-04 · Datenkarte-Gate — `scripts/regime/data-map.mjs`
- **Seed (rot):** synthetische Tabelle `leaked_users(email, phone)` ohne
  Registry-Eintrag → `--selftest` fängt sie, Exit≠0. **Gesehen gefangen.**
- **Realer Bestand:** 20 geflaggte Tabellen, alle klassifiziert; 5 personenbezogene
  Stores mit Rechtsgrundlage + Erasure-Pfad.
- **Stehende Kontrolle:** CI-Step „Datenkarte" (blockierend) + RoPA-Kopplung.

### C-04 · Erasure end-to-end — `tests/erasure.integration.test.ts`
- **Rot vorher:** ohne die `to_email`-Härtung überlebt die Queue-Zeile ohne
  contactId (Testversand) → Test rot (`length 1 statt 0`). **Real reproduziert**
  (contacts.ts kurz zurückgesetzt → rot; wiederhergestellt → grün).
- **Grün nachher:** Kanarien-Adresse in keinem PII-Store mehr (contact, email_queue
  ×2, campaign_log, contact_activity, interest/tag/segment-Zuordnungen).
- **Stehende Kontrolle:** Integrationstest in CI; `anonymizeContact` gehärtet
  (to_email + campaignLog.error).

### C-23 · ops_event-Retention — `purgeOldOpsEvents`
- 90-Tage-Purge, bei jedem Monitor-Tick durchgesetzt; Observability-Store kann
  nicht unbegrenzt wachsen. Datenkarte klassifiziert ihn personenbezug-frei.

## Welle 3 — Sicherheits-Gates + Doku (BLOCKER C-02, C-05, C-07, C-09, C-26; + C-24, C-25, C-36)

- **C-05 · LLM-Matrix** (`llm-matrix-check.mjs`): 10 Kategorien, jede Kontrolle+Test; Seed = geleerte Zelle gefangen. CI-Step.
- **C-24 · Prompt-Scan** (`prompt-scan.mjs`): Seed = Fake-Key im Prompt gefangen; reale Prompts sauber. CI-Step.
- **C-05/B-08 · KI-Budget** (`ai-budget-check.mjs`): Seed = Aufruf ohne max_tokens/timeout gefangen. CI-Step.
- **C-02 · Boundary-Detektor** (`boundary-check.mjs`): 3 Egress/Exec deklariert; Seed = neue Egress-Datei gefangen. Threat-Model + boundaries.json. CI-Step.
- **C-07 · Injection-Containment** (`tests/injection.containment.test.ts`): Schema strippt Zusatz-/Aktionsfelder; kein handlungsartiges Feld. Restrisiko schriftlich (injection-residual.md).
- **C-09/C-36 · KI-Kennzeichnung** (`tests/ai-disclosure.test.ts`): Entwurf trägt „KI-Entwurf"-Badge; i18n + Komponente asserted. AI-System-Inventar + Article-50-Bewertung.
- **C-26 · AI-BOM** (`ai-bom.mjs --verify`): Modelle im Code == AI-BOM (claude-opus-4-8, 0 Datensätze/Adapter). CI-Step (security).
- **C-26/C-37 · Mandat-Provenance** (`mandate-hash.mjs --verify`): part1/part2/combined attestiert, mandate.md deterministisch. CI-Step + Deploy-Voraussetzung.
- **C-25 · Lizenz-Scan** (`license-scan.mjs`): 506 Deps, kein starkes Copyleft; Seed = AGPL erkannt. IP-Position dokumentiert. CI-Step.

## Welle 4 — MUST-FIX/PLAN (C-37, C-03, C-10 + C-11/20/28/29/30/31/33/34/38/40)

- **C-37 · Provenance-Rekonstruktion** (`provenance-reconstruct.mjs`): 180 Quelldateien,
  alle einer Owning-Role zugeordnet (ownership-registry.json); Policy-Bundle (Verfassung)
  verifiziert; Spot-Rekonstruktion vollständig. Seed = unabgedeckte Datei gefangen. CI-Step.
  Ehrliche Grenze: Modell-Trailer nur auf Engagement-Commits, Legacy-Commits ohne — Rolle
  + Policy-Bundle sind dennoch rekonstruierbar.
- **C-03 · Supply-Chain** (`supply-chain-playbook.md`): deps-existence + Lockfile + audit +
  Lizenz-Scan aktiv; Registry-Alters-Check als nächtliche Kadenz; Playbook geübt dokumentiert.
- **C-10 · Golden-Eval** (`tests/ai-eval.golden.test.ts`): eingefrorenes Golden-Set (Saison),
  Schwellwert 100 % exakt, Ratchet (nur steigen). In CI (npm test).
- **C-11/20/28/29/30/31/33/34/38/40** (`governance/ai-governance.md`): je Owner + Maß/Kontrolle
  + Tripwire; erzwingende Gates verlinkt (Policy-Enforcement-Mapping C-33).

## Phase 6′ — Re-Audit + Schluss-Sample (10 % von 119)

**Track-C-Bilanz nach Remediation:** 25 PASS, 15 N/A, 1 PARTIAL (C-30, SHOULD-FIX,
Residual R-C30 mit Tripwire). **Offene Track-C-Blocker: 0.**

**Schluss-Sample** (12 Prüfungen ≥ 10 %; Bänder STOP-SHIP/B1/B2/MUST/SHOULD;
Tracks A+B+C): alle Kontrollen erneut ausgeführt, alle grün —
B-06 (A), A-01 (A), B-04 (B), B-13 (B), C-01/C-04/C-05/C-08/C-02/C-24/C-26/C-37/C-25 (C).
Kein Disagreement → keine Ausweitung nötig.

**Ehrliche Gesamtlage (computed, nicht behauptet):** über alle 119 Prüfungen
bleiben **19 offene Blocker aus Part 1** (Track A/B, PARTIAL in Blocker-Bändern),
die Part 1 als Residuen trug, die die strengere Zwei-Volume-Definition-of-Done aber
als offen zählt: STOP-SHIP A-01, A-39 (unabhängiger Fremd-Vendor-Verifier —
strukturell nicht verfügbar in einer Ein-Vendor-Umgebung); BLOCKER-1 A-06, A-08,
B-11, A-36; BLOCKER-2 A-04, A-09, A-10, A-17, A-25, A-33, A-34, B-02, B-05, B-07,
B-10, B-12, B-28. **production_eligible bleibt daher false** — Track C ist
geschlossen, aber das Gesamt-Gate hält an Part-1-Resten.

## Phase 7′ — Amendment, Re-Ratifizierung, Freigabe-Berechnung

- **Verfassung amendiert (stärkend, Artikel XIII):** Track-C-Baselines eingetragen,
  12 Gate-Kontrollen verdrahtet; keine Schwächung. Hash `65a0f3fb…` attestiert.
- **Amendment-Gate erneut bewiesen:** ungegateter Verfassungs-Edit von
  `constitution-hash --verify` abgelehnt (`audit/evidence/phase7prime-amendment-gate.txt`).
- **Mandat-Provenance re-attestiert:** part1/part2/combined verifiziert; mandate.md
  deterministisch (`mandate-hash --verify`).
- **engagement-status:** part2_status COMPLETE, security_scope_audited true,
  constitution_state RATIFIED, catalogue v2.0. `production_eligible` **computed = false**
  (2 STOP-SHIP, 4 B1, 13 B2 offen — alle Part 1). Admission fail-closed (exit 1) bestätigt.

## Phase 8 — Part-1-Blocker-Remediation (19 → 3 offene Blocker)

Nach dem „Angehen" der Part-1-Reste, jede Kontrolle CI-blockierend + selbst-getestet:
- A-04 spec-coverage · A-05/A-09 architecture-fitness · A-25 fuzz · B-05 prompt-lifecycle
  (alle mjs/vitest, Seed/rot-vorher gefangen).
- A-34 Kill-Switch (selbst-feuernd, tests/ai-killswitch.test.ts) · B-07 Token-Logging
  (nur Zähler) · B-28 Auto-Halt · A-10 Injektions-Gate (Track-C-Test + Guard).
- A-36/B-02 nightly.yml (GitHub-Actions-Cron) · A-08 dast.yml (ZAP, fällt auf echte
  Funde) · B-12 dependabot.yml · A-17 Lighthouse-CWV · A-06/B-11 deploy/rollback.sh +
  rollback-check.mjs · B-10 Golden-Eval-Gate.
- A-01/A-39 independent-verify.mjs + Workflow: Fremd-Vendor-Verifier gebaut, aktiv mit
  einem Secret.

**Verbleibend offen (computed):** A-01/A-39 (STOP-SHIP — ein Secret entfernt; siehe
Nutzer-Aktionsliste) und A-33 (Erfolgsraten-SLI, echtes Residual — braucht Agent-/
CI-Telemetrie über Zeit). production_eligible bleibt false, aber nur noch an diesen
dreien, nicht mehr an 19.

## Phase 9 — Adversariales Kontroll-Audit (Workflow `wf_ac30593b`) + Härtung

Die A-39-Rolle (unabhängiger, feindseliger Verifier) wurde durch einen Multi-Agenten-
**Workflow** gespielt: jede der 20 stehenden Kontrollen wurde von einem eigenständigen
Agenten mit falsifizierendem Ziel angegriffen — realer Lauf, echter Bypass, Repo danach
per `git checkout` wiederhergestellt. Ergebnis: **18 von 20 Kontrollen waren regex-/
substring-brüchig oder Fake-Grün** (der `--selftest` fing nur den künstlichen Seed, nie
den realen Defekt). Das ist der ehrliche Kern des A-39-Residuals — und genau der Befund,
den ein Ein-Vendor-Gate allein nicht liefern kann.

Jeder bestätigte Bypass wurde mit dem vom Angreifer gelieferten Rezept gehärtet und mit
**seiner exakten Reproduktion** gegengeprüft (rot-vorher → grün-nachher, Repo sauber):

**HF1 — realer Code-Defekt (C-04 Erasure):** `anonymizeContact` löschte PII nicht aus
eingebetteten E-Mail-Queue-Bodies. Body-Scrub (`replace(...)` auf subject/html/textBody)
+ Integrationstest mit Canary im `subject` (rot-vorher bewiesen). Commit `60e9f41`.

**HF2 — 5 Security-Gates entsprödet** (`202b2cd`): authz-coverage (const-arrow/Re-Export-
Handler + Kommentar-Strip), ai-capability-guard (Referenz-`tools:`, Built-in-Server-Tools,
`mcp_servers:`), secret-scan (Split-Literale, präfix-verankerte SendGrid/Stripe/GitHub/
Slack/Google-Keys, URI-Credential), boundary-check (alle Endungen inkl. `.tsx`, `fetch`/
`node:https`/axios-Egress), data-map (Drizzle-Shorthand `text()`).

**HF3a — 5 Gates** (`0084c12`): provenance-reconstruct (kein `default_role`-Fallthrough →
21 maskierte Dateien sichtbar), license-scan (bare-`GPL`, AGPL nur in LICENSE-Datei),
llm-matrix-check (Phantom-Test-Pfad + Platzhalter abgelehnt), prompt-scan (interne FQDN/
IPv6/Backtick-Credential), ai-budget-check (per-Aufrufstelle über ganz `src/`).

**HF3b — 4 Gates + Schema** (dieser Commit):
- `rollback-check.mjs`: von Token-Presence auf **semantische Verdrahtung** — Kommentare
  gestrippt, Health-Ergebnis muss in `if`/`fail` fließen (`curl … || true` abgelehnt),
  `--dry-run) DRY=1` real geparst, echtes `cp "$BACKUP" "$DATA_DIR/app.db"`. Positiv-
  Attacke (alle Tokens nur in Kommentaren/`|| true`) → 7 Verstöße, Exit 1. **Gesehen.**
- `independent-verify.mjs`: Block-Logik als reine `decide()` extrahiert — fail-**closed**
  bei fehlendem `refuted`-Feld, blockt bei confidence ≥ medium (nicht nur high). `--selftest`
  übt `decide()` aus; `if(false)`-Neutralisierung → Selbsttest Exit 1. Neuer Kalibrier-Seed
  **S10** in `seeds.json` (via `inject.mjs --strict` in CI). **Gesehen gefangen.**
- `tests/ai-killswitch.test.ts` (B-07): 4. Test übt den **echten Erfolgspfad** von
  `generateRecipeDraft` (gemocktes SDK) und assertiert, dass weder Ausgangstext-Sentinel
  noch generierter Titel ins `ops_event` lecken; Positivkontrolle `tokens in=10 out=20`.
  Injizierter `recordOpsEvent(src=…out=…)`-Leck → Test rot. **Gesehen.**
- `tests/injection.containment.test.ts` (C-07): Denylist-Regex ersetzt durch **rekursive
  Allowlist** (walkt ZodObject/Array/Optional/Nullable über jede Tiefe); `recipeDraftSchema`
  ist jetzt auf jeder Objektebene `.strict()` (unbekannte Felder abgelehnt statt gestrippt).
  Deklarierte Egress-Felder `quelleLink`/`bildLink` (top-level) + `webhookUrl` (verschachtelt)
  → 2 Tests rot. **Gesehen gefangen.**
- Nebenbefund behoben: die gehärtete `secret-scan` fing die credential-förmige Selbsttest-
  **Fixtur** in `prompt-scan.mjs` (URI-Credential) — per sanktioniertem `secret-scan-allow`-
  Kommentar (auditierbar, Ratchet-gezählt) ausgenommen. Kein echtes Geheimnis.

**Voll-Gate nach HF3b (real ausgeführt, grün):** `typecheck` ✓ · `lint` 0 errors ✓ ·
`vitest run` **142/142** ✓ · `build` ✓ · alle **15** Regime-Gates `--selftest` **und**
Standardlauf ✓ · `calibration/inject.mjs --strict` (10 aktive Seed-Klassen) ✓ ·
`clones` 4,81 % (≤ 5,5 %) ✓.

**Ehrliche Lage:** die Discovery-Verdikte sind unverändert (production_eligible bleibt
computed **false**, gehalten an A-01/A-39 + A-33). Was sich geändert hat, ist die
**Vertrauenswürdigkeit der grünen Gates**: 18 Kontrollen, die vorher Fake-Grün waren,
fangen ihre Defektklasse jetzt nachweislich — verifiziert durch die Reproduktion des
Angreifers, nicht durch Behauptung.
