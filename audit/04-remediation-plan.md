# Remediationsplan — Track C (Phase 4′)

Erweitert den einen Plan über Track-C-Verdikte **und** die von Part 1 gebauten
Türen. Wellen in Bandreihenfolge; jede Kontrolle wird in Phase 5′ installiert und
demonstriert (Fehltest rot → Kontrolle → grün), in Phase 6′ re-auditiert.

## Wellen

**Welle 1 — Strukturelle Türen (unterbaut die meisten Verdikte)**
- `scripts/regime/authz-coverage.mjs` — jede Admin-Action/Route guardet oder Allowlist (C-01, Seed S9). *Tür: „eine Route ohne Authz-Test kann nicht mergen".*
- `scripts/regime/ai-capability-guard.mjs` — fällt den Build, sobald Tool-Use/MCP/Vektor-Store/Fine-Tune/Agenten-Framework/Egress im KI-Pfad auftaucht (C-06/08/12/14/16/17/18/19/21/22/32/35 Reaktivierung, Seeds S7/S8). *Tür: „die N/A-Klasse kann nicht unbemerkt zurückkehren".*

**Welle 2 — Datenschutz (STOP-SHIP C-04, C-23)**
- `governance/privacy/dpia.md` + `ropa.md` (in-command-Rechtsartefakte).
- `scripts/regime/data-map.mjs` — Datenkarte aus Schema generiert, gegen RoPA gedifft; neuer PII-Store ohne Eintrag fällt den Build.
- `tests/erasure.integration.test.ts` — Kanarien-Kontakt in jeden Store, `anonymizeContact`, Assertion: **kein** PII-Rest.
- `anonymizeContact` gehärtet (emailQueue per toEmail, campaignLog.error); `ops_event`-Retention im Monitor.

**Welle 3 — Sicherheits-Dokumentation + Gates (BLOCKER C-02, C-05, C-07, C-09, C-26)**
- `governance/security/threat-model.md` (STRIDE) + `scripts/regime/boundary-check.mjs` (New-Trust-Boundary-Detector).
- `audit/llm-risk-matrix.md` + `scripts/regime/llm-matrix-check.mjs` (Empty-Cell-Gate) — C-05.
- `tests/injection.eval.test.ts` (direkt/indirekt) + Restrisiko-Doku — C-07.
- `governance/ai-system-inventory.md` (generiert) + Article-50-Bewertung — C-09.
- `scripts/regime/ai-bom.mjs` (AI-BOM) + Provenance-Verify am Admission — C-26.

**Welle 4 — MUST-/SHOULD-FIX (C-03, C-10, C-24, C-25, C-28, C-33, C-34, C-37, u.a.)**
- Registry-Alters-Check + Poisoned-Dep-Playbook (C-03).
- `tests/ai-eval.test.ts` Golden-Set + eingefrorener Schwellwert (C-10).
- Prompt-Secret-Scan (C-24), Lizenz-Scan + IP-Position (C-25), Residency-Doku (C-28),
  Policy-Enforcement-Mapping (C-33), Provider-DPA + No-Training-Assertion (C-34).
- `scripts/regime/provenance-reconstruct.mjs` + Owning-Role-Registry (C-37).

**Welle 5 — Governance-Doku (C-11, C-20, C-29, C-30, C-31, C-36, C-38, C-40)**
- NIST-AI-RMF-Mapping, Responsible-AI-Dimensionen, Content-Safety-Position,
  Jailbreak-Restrisiko, Sieben-Schichten-Mapping, Kennzeichnungs-Erklärung,
  Fabrikations-Position, Immaterialität.

## Strukturelle Zuordnung (welche Tür welchen Befund kollabiert)

Siehe `audit/04b-structural-ledger.md`.
