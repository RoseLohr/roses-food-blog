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
