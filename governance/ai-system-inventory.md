# KI-System-Inventar & EU-AI-Act-Klassifizierung (C-09/C-36)

**Version:** 1.0 · **Stand:** 2026-07-17 · **Owner:** legal + ai-platform (in-command)
**Aktuell gehalten:** aus der Konfiguration ableitbar (ein Aufrufpfad,
`src/lib/ai-recipe.ts`); ein neuer Modell-Aufruf ohne Inventar-Eintrag würde vom
KI-Fähigkeits-Guard/Boundary-Detektor sichtbar. Rechtsdaten-Watch: kalendarisch,
in-command (nichts in der Pipeline liest das Amtsblatt).

## System AIS-1 · KI-Rezeptassistent

| Feld | Wert |
|---|---|
| Zweck | Redaktioneller Entwurf eines Rezepts aus vom Admin eingefügtem Ausgangstext |
| Nutzer | **Nur Admin** (in-command). Kein nutzerseitiger KI-Endpunkt. |
| Modell | `claude-opus-4-8` (Anthropic, gepinnt, gehostet) |
| Ein-/Ausgabe | Text → JSON (schema-gebunden). Kein Tool-Use, kein Egress, kein RAG. |
| Entscheidungen über Personen | **keine** (kein Profiling, keine automatisierte Einzelentscheidung mit Rechtswirkung, Art. 22 DSGVO n/a) |
| Personendaten im Aufruf | keine Abonnenten-PII; nur der eingefügte Rezept-Ausgangstext (nicht persistiert) |

### Risikoklassifizierung (EU AI Act)
- **Nicht verboten** (Art. 5): keine der verbotenen Praktiken.
- **Nicht hochriskant** (Anhang III): kein Einsatz in Beschäftigung, Kredit, Justiz,
  kritischer Infrastruktur, Biometrie o. Ä. Der Assistent erzeugt redaktionelle
  Entwürfe, die ein Mensch prüft.
- **Transparenzpflicht (Art. 50):** Es liegt ein generatives Feature vor. Da die
  Ausgabe **nicht** direkt an Endnutzer geht (admin-only Entwurf, human-redigiert,
  bevor er als redaktioneller Inhalt erscheint), besteht keine unmittelbare
  nutzerseitige Interaktions-Offenlegungspflicht. **Getroffene Maßnahme:** Der
  Admin-Editor kennzeichnet den Entwurf sichtbar als „KI-Entwurf" (UI-Test
  `tests/ai-disclosure.test.ts`); veröffentlichte Inhalte gelten als
  human-authored (in-command redigiert). Maschinenlesbare Kennzeichnung generativer
  Ausgaben: siehe C-36-Erklärung (Kennzeichnung ist Reibungs-, kein Provenienz-Beweis).

### Fristen (zuletzt erfasst, zu re-verifizieren)
- GPAI-Pflichten seit 2. 8. 2025; Art. 50 Transparenz 2. 8. 2026; maschinenlesbare
  Kennzeichnung 2. 12. 2026. Standalone-Hochrisiko provisorisch auf 2. 12. 2027
  verschoben — hier nicht einschlägig (kein Hochrisiko).

## Die Grenze (Art. 14, bewusst gelesen)
Dieses Mandat entfernt Menschen aus dem **Liefer-/Verifikations-Loop**, nicht aus
einer etwaigen **Aufsichtspflicht über Entscheidungen über Personen**. Da AIS-1
**keine** Entscheidungen über Personen trifft, greift Art. 14 nicht. Würde je ein
Feature eingeführt, das solche Entscheidungen trifft, ist die Aufsicht **in-command**
zu führen (Policy-Autorschaft, Halt-Autorität, Logs, Nachprüfung) — und wenn das
nicht möglich ist, wird das Feature nicht deployt. Niemals ein Pro-Entscheidung-
Freigeber, der nicht liest, was er freigibt.
