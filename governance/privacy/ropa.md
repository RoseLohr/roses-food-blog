# Verzeichnis von Verarbeitungstätigkeiten (RoPA, Art. 30 DSGVO)

**Version:** 1.0 · **Stand:** 2026-07-17 · **Verantwortliche:** Betreiberin des Blogs

Dieses Verzeichnis ist an die maschinell generierte Datenkarte
`governance/privacy/data-map.json` gekoppelt. `scripts/regime/data-map.mjs`
scannt das Schema und fällt den Build, sobald ein personenbezogener Store ohne
Eintrag hier auftaucht — das RoPA kann nicht still veralten.

## Verarbeitungstätigkeiten

### VT-1 · Newsletter-Verwaltung
- **Zweck:** Versand des eingewilligten Newsletters.
- **Kategorien Betroffener:** Abonnenten.
- **Datenkategorien:** E-Mail, Vor-/Nachname, Interessen, Anmeldequelle, Notizen.
- **Rechtsgrundlage:** Einwilligung (Art. 6(1)(a)), Double-Opt-in, `consentAt`.
- **Empfänger:** SMTP-Versanddienst (Auftragsverarbeiter).
- **Drittland:** keines (Self-Host EU); SMTP je Betreiber-Konfiguration.
- **Löschfrist:** bis Widerruf/Abmeldung → `anonymizeContact` (irreversibel).
- **TOMs:** HttpOnly-Session, argon2id, server-seitige Authz (Authz-Coverage-Gate),
  Erasure end-to-end getestet.

### VT-2 · Reichweiten-Statistik
- **Zweck:** aggregierte Nutzungsstatistik.
- **Datenkategorien:** GeoIP-Land, Browser, Pfad, Besuchstyp. **Kein Roh-IP.**
- **Rechtsgrundlage:** berechtigtes Interesse (Art. 6(1)(f)); IP normalisiert.
- **Löschfrist:** Rohdaten nach Tagesaggregation gelöscht; Aggregate 730 Tage.

### VT-3 · Betrieb/Observability
- **Zweck:** Verfügbarkeit/SLO.
- **Datenkategorien:** Fehler-Signale, personenbezug-frei per Design.
- **Rechtsgrundlage:** berechtigtes Interesse (Art. 6(1)(f)).
- **Löschfrist:** 90 Tage (`purgeOldOpsEvents`).

### VT-4 · Betreiber-Authentifizierung
- **Zweck:** Zugang zum Admin-Bereich (ein Konto).
- **Datenkategorien:** E-Mail, Name, Passwort-Hash (argon2id).
- **Rechtsgrundlage:** Vertrag/berechtigtes Interesse — Daten des Verantwortlichen.

## Auftragsverarbeiter / Provider
- **SMTP-Dienst:** Newsletter-/Alarm-Versand (AV-Vertrag durch Betreiberin).
- **Anthropic (KI-Assistent):** admin-only; Ausgangstext nicht persistiert; kein
  Training auf API-Daten (Provider-Terms, C-34). Inferenz-Region: Anbieter-Region;
  keine EU-Personendaten von Abonnenten fließen in den KI-Aufruf (nur der vom
  Admin eingefügte Rezept-Ausgangstext).
