# Kalibrier-Record — Phase 2′ (Track C: Korpus geerbt, dann erweitert)

Part 1 §Phase 2 hat den Seeded-Defect-Korpus etabliert (A-36, S12). Dieses Volume
führt **keinen** frischen Seed-Lauf durch; es erbt die laufende Fangrate als
Baseline, die es nicht verschlechtern darf, und trägt drei Track-C-Klassen bei
als erste stehende Beitragsleistung.

## Geerbte Baseline (Part 1)

Aktive Klassen S1, S3, S4, S5 mit benannter fangender Kontrolle; S2 (cross-tenant)
und S6 (untrusted→tool) als N/A mit Tripwire (Ein-Admin-Modell, kein Tool-Use).
`node scripts/regime/calibration/inject.mjs --selftest` = grün. Diese Fangrate
ist der **Boden**, den Track C nicht unterschreiten darf (Ratchet S11).

## Track-C-Beitrag (neu, Phase 2′)

| Seed | Klasse | Track-C-Bezug | Fangende Kontrolle (Phase 5′) | Status Phase 2′ |
|---|---|---|---|---|
| `S7-prompt-injection` | Prompt-Injection (direkt/indirekt) | C-07 | `ai-capability-guard.mjs` — Schema-Bindung + kein Tool/Egress | pending → aktiv nach Phase 5′ |
| `S8-exfiltration-path` | Exfiltrations-Bein (modellgesteuerter Egress) | C-08 | `ai-capability-guard.mjs` — No-Egress-Assertion | pending → aktiv nach Phase 5′ |
| `S9-cross-tenant-read` | Admin-Endpunkt ohne Server-Authz | C-01 | `authz-coverage.mjs --selftest` | pending → aktiv nach Phase 5′ |

**Warum diese drei:** Das Mandat verlangt genau „einen Injection-Payload, einen
Exfiltrationspfad, einen Cross-Tenant-Read". S7/S8 werden strukturell gefangen —
der KI-Pfad hat kein Bein, das eine Injection konsequent machen könnte; der Guard
lässt keines entstehen. S9 ist die **real vorhandene** Variante des Cross-Tenant-
Reads: nicht ein fremder Mandant (den es nicht gibt — S2 bleibt N/A), sondern ein
ungeguardeter Admin-Schreibpfad. Genau den fängt das Authz-Coverage-Gate.

**Fälligkeit:** Bis die Phase-5′-Kontrollen stehen, laufen S7–S9 als `pending`
(WARN, kein Fehler; unter `--strict` Fehler — deshalb ist die Ratifizierung
Phase 7′ an ihre Fertigstellung gebunden). Der Selbsttest wird in Phase 6′
scharf (`--strict`) nachgewiesen.
