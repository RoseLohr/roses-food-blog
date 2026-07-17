# Struktureller Ledger — Track C (Phase 4′)

Türen, die Track-C-Fehlerklassen *unrepräsentierbar* machen statt sie nur zu
detektieren (S13). Für jede Tür die §6.5.6-Provenance: welche Baseline-Befunde
sie betrifft, durch welche Änderung sie gebaut/geweitet wird, welche Prüfungen
einen frischen Phase-6′-Re-Run brauchen, ob das Initialverdikt erhalten bleibt,
und die aktuelle Verifikationsreferenz. **Keine Tür schließt einen Befund ohne
frischen Re-Run; keine überschreibt ein Baseline-Verdikt.**

---

### Tür D-C1 · Authz-Coverage-Gate
- **Was sie unmöglich macht:** einen Admin-Schreibpfad mergen, den kein
  Server-seitiger Guard schützt (die Klasse hinter einem Cross-Tenant/IDOR-Bruch).
- `baseline_affected_checks`: C-01 (STOP-SHIP); berührt A-25 (Eingabevalidierung).
- `door_built_by_change`: `scripts/regime/authz-coverage.mjs` + CI-Step + Seed S9 (Phase 5′ Welle 1).
- `checks_requiring_fresh_rerun`: C-01.
- `initial_verdict_preserved`: true (C-01 bleibt PARTIAL im Trail bis Phase-6′-Re-Run).
- `current_verification_reference`: Phase 6′ / `authz-coverage.mjs --selftest` + `audit/05-verification.md`.

### Tür D-C2 · KI-Fähigkeits-Guard (ai-capability-guard)
- **Was sie unmöglich macht:** eine agentische/Tool-/RAG-/Fine-Tune-/Egress-Fähigkeit
  einführen, ohne dass die zugehörige N/A-Prüfung wieder aufreißt und den Build fällt.
- `baseline_affected_checks`: C-06, C-08, C-12, C-14, C-16, C-17, C-18, C-19, C-21, C-22, C-32, C-35 (N/A-Reaktivierung); Seeds S7/S8.
- `door_built_by_change`: `scripts/regime/ai-capability-guard.mjs` + CI-Step (Phase 5′ Welle 1).
- `checks_requiring_fresh_rerun`: C-06, C-08, C-12 (die Nicht-N/A unter ihnen); die reinen N/A tragen den Guard als stehende Kontrolle.
- `initial_verdict_preserved`: true.
- `current_verification_reference`: Phase 6′ / Guard-Demonstration (Fake-Tool-Use → Build fällt) in `audit/05-verification.md`.

### Tür D-C4 · Generierte Datenkarte + Registry-Zwang (S13, erbt B-37)
- **Was sie unmöglich macht:** einen PII-Store bauen, der nicht in der Datenkarte/RoPA steht (er fällt den Build); einen Store, aus dem nicht gelöscht werden kann.
- `baseline_affected_checks`: C-04 (STOP-SHIP), C-23; berührt B-37 (Part 1 PLAN).
- `door_built_by_change`: `scripts/regime/data-map.mjs` + RoPA + Erasure-Kanarien-Test + ops_event-Retention (Phase 5′ Welle 2). **Weitung** der B-37-Tür → triggert Re-Verifikation von B-37.
- `checks_requiring_fresh_rerun`: C-04, C-23, **B-37** (geweitete Tür).
- `initial_verdict_preserved`: true (C-04/C-23 PARTIAL, B-37 PARTIAL bleiben im Trail).
- `current_verification_reference`: Phase 6′ / `data-map.mjs` + `tests/erasure.integration.test.ts`.

### Tür D-C2TM · New-Trust-Boundary-Detector (erbt §6.5.3 „generieren, nicht pflegen")
- **Was sie unmöglich macht:** eine neue Integration/Egress/Tool/Datenklasse einführen, ohne Threat-Model-Eintrag (Build fällt).
- `baseline_affected_checks`: C-02 (BLOCKER-2), C-31; berührt A-28.
- `door_built_by_change`: `scripts/regime/boundary-check.mjs` + `governance/security/threat-model.md` (Phase 5′ Welle 3).
- `checks_requiring_fresh_rerun`: C-02, C-31.
- `initial_verdict_preserved`: true.
- `current_verification_reference`: Phase 6′ / `boundary-check.mjs`.

### Tür D-C26 · Provenance verifiziert am Deploy (erbt Admission-Gate, Artikel XV)
- **Was sie unmöglich macht:** deployen ohne verifizierte Provenance/Hash-Kette (Admission fail-closed).
- `baseline_affected_checks`: C-26, C-37 (BLOCKER-1); berührt B-09, B-27.
- `door_built_by_change`: `scripts/regime/ai-bom.mjs` + `mandate-hash.mjs --verify` + Provenance-Rekonstruktion, im Admission-Pfad (Phase 5′ Welle 3/4).
- `checks_requiring_fresh_rerun`: C-26, C-37.
- `initial_verdict_preserved`: true.
- `current_verification_reference`: Phase 6′ / Admission-Log + `provenance-reconstruct.mjs`.

---

**Von Part 1 stehende Türen, die Track-C-Fälle stützen (Applikabilität hier evidenziert):**
- Prompt-Registry (A-20): stützt C-24 (kein Inline-Prompt, ein Ort) — Applikabilität: der KI-Prompt lebt nachweislich nur in `recipe-draft.ts`.
- Modell-Pin + Alias-Lint (B-13): stützt C-05/C-33/C-34 — Applikabilität: `claude-opus-4-8` gepinnt, source-gate greift.
- Deterministisches Merge-Gate (A-01): stützt C-10/C-25/C-33 (Gate ist alleinige Merge-Autorität).
- Kein Track-C-Verdikt wird allein durch eine Part-1-Tür geschlossen — jedes braucht seinen frischen Phase-6′-Re-Run.
