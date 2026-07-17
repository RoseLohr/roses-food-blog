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
