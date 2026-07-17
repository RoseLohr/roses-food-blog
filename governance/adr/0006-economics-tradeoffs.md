# 0006 — Ökonomie & Trade-off-Positionen (A-29/A-30/A-31/B-16)

**Kontext.** Solo-betriebener Blog ohne Umsatzmodell; Kosten = ein Server +
Anthropic-API (nutzungsbasiert, nur bei aktiver Redaktion).

**TCO/Exit (A-29).** Stack bewusst lock-in-arm: SQLite-Datei + Uploads =
vollständiger Datenbestand (Export/Import v2 vorhanden und getestet);
Modell-Provider hinter einem einzigen Aufrufpfad (`ai-recipe.ts`) — Austausch
= eine Datei. Exit-Plan: Datenexport (ZIP) + beliebiger Node-Host.

**Trade-offs (A-30).**
- Konsistenz vor Verfügbarkeit: ein Schreiber, synchrone Transaktionen
  (better-sqlite3) — bewusst, da Single-Node (ADR 0001).
- Einfachheit vor Skalierung: kein Cache-Layer, kein CDN — Traffic-Profil
  eines privaten Blogs; Next-standalone + nginx reicht.
- Redundanz vor Kosten NICHT gewählt: ein Server, Backups statt Failover —
  akzeptierte Ausfallzeit im Störfall (Restore-Drill geübt).

**Unit Economics (A-31/B-16).** Kein Umsatz je Request → relevante Größe ist
die absolute Kostenobergrenze: Server-Fixkosten + KI-Kosten ≈ (Aufrufe/Monat ×
Tokens/Aufruf). KI ist admin-only, ein Aufruf je Entwurf, max_tokens 8000 —
Obergrenze durch Nutzungsmuster strukturell begrenzt; Kostenattribution je
Feature entfällt (ein Feature). Tripwire: Provider-Rechnungsalarm; Einführung
öffentlich erreichbarer KI-Pfade reaktiviert B-08/B-16 hart (Ausnahmen-Ledger).
