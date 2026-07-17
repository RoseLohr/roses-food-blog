# Datenschutz-Folgenabschätzung (DPIA) — Roses Food Blog

**Status:** in-command autorisiert · **Version:** 1.0 · **Stand:** 2026-07-17
**Verantwortliche:** Betreiberin des Blogs
**Rechtsartefakt:** Diese Abschätzung ist ein menschlich autorisiertes Artefakt
(Art. 35 DSGVO). Sie überlebt die Entfernung des Reviewers aus dem Liefer-Loop;
die Rechtsgrundlage bleibt ein menschliches Urteil (C-04, Owner „privacy in-command").

## 1. Verarbeitungsübersicht

| Verarbeitung | Daten | Rechtsgrundlage | Store |
|---|---|---|---|
| Newsletter | E-Mail, Vor-/Nachname, Interessen, Quelle | Einwilligung Art. 6(1)(a), Double-Opt-in (`consentAt`) | `contact` + abgeleitete |
| Versand | gerenderte E-Mail (Empfänger) | Einwilligung Art. 6(1)(a) | `email_queue` (kurzlebig) |
| Reichweiten-Statistik | GeoIP-Land, Browser, Pfad (kein Roh-IP) | berechtigtes Interesse Art. 6(1)(f) | `tracking_event`→`tracking_daily` |
| Betrieb/Observability | Fehler-Signale (personenbezug-frei) | berechtigtes Interesse Art. 6(1)(f) | `ops_event` |
| Admin-Auth | Betreiber-E-Mail/Name, argon2id-Hash | Vertrag/berechtigtes Interesse | `admin_user` |

Die maschinell generierte Datenkarte (`governance/privacy/data-map.json`,
erzwungen durch `scripts/regime/data-map.mjs`) ist die verbindliche, stets
aktuelle Fassung dieser Tabelle.

## 2. Notwendigkeit & Verhältnismäßigkeit
- **Datenminimierung:** kein Roh-IP gespeichert (nur GeoIP-Land); Ausgangstext
  des KI-Assistenten wird nie persistiert; Logs sind personenbezug-frei.
- **Zweckbindung:** Kontaktdaten ausschließlich für den eingewilligten Newsletter.
- **Speicherbegrenzung:** Tracking-Rohdaten nach Tagesaggregation gelöscht,
  Aggregate 730 Tage; `ops_event` 90 Tage; Kontaktdaten bis Widerruf.

## 3. Risiken & Maßnahmen (technisch erzwungen)

| Risiko | Maßnahme | Kontrolle |
|---|---|---|
| Unvollständige Löschung | `anonymizeContact` kaskadiert über alle abgeleiteten Stores (contactId **und** to_email) | `tests/erasure.integration.test.ts` (Kanarie), in CI |
| PII in Logs/Traces | Redaktion per Design am Emitter; kein Roh-Request-Body | C-23; `logJson` „nie personenbezogen" |
| Unbemerkter neuer PII-Store | Datenkarte generiert + gegen RoPA gedifft | `data-map.mjs` (Build-blockierend) |
| Unbegrenzte Aufbewahrung | automatischer Purge | `purgeOldOpsEvents` (Monitor); Tracking-Retention |
| Provider (Anthropic) | kein Training auf API-Daten (Terms); Ausgangstext admin-only, nicht persistiert | C-34 |

## 4. Betroffenenrechte
- **Auskunft:** CSV-Export (`kontakte/export`).
- **Löschung/Widerspruch:** Abmelde-Link (`unsubscribeToken`) + `anonymizeContact`
  (irreversibel), end-to-end getestet.
- **Berichtigung:** Kontakt-Editor.

## 5. Ergebnis
Restrisiko niedrig; keine hochriskante Verarbeitung i.S.v. Art. 35(3) (kein
Profiling mit Rechtswirkung, keine besonderen Kategorien, kein großflächiges
Monitoring). DPIA formell dennoch geführt, weil EU-Personendaten verarbeitet
werden und C-04 STOP-SHIP ist. **Re-Trigger:** automatisch bei neuer Datenklasse
oder neuem Zweck (data-map-Diff).
