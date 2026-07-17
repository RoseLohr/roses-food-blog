# 0003 — KI-Provider: Anthropic, gepinntes Modell, kein Tool-Use

**Kontext.** Ein einziges KI-Feature: aus eingefügtem Rohtext einen strukturierten
Rezeptentwurf erzeugen. Ausgabe wird vom Admin vor Übernahme geprüft.

**Entscheidung.** Anthropic Messages API, **gepinntes** Modell `claude-opus-4-8`
(kein „latest"-Alias — B-13-Gate erzwingt das), structured output via Zod-Schema,
**kein Tool-Use** (das Modell schreibt/sendet/löscht nichts).

**Konsequenzen.** Die gefährlichsten KI-Runtime-Risiken (Exfiltration,
„lethal trifecta", Denial-of-Wallet über Tool-Schleifen) sind strukturell abwesent
→ A-11/A-34/B-20/B-22 N/A (Ledger F1). Provider-Kopplung = Kontinuitätsrisiko
(B-21/B-36): der Blog funktioniert aber ohne das Modell weiter. Prompt lebt in der
Registry (A-20). Tripwire: erster `tools:`-Aufruf reaktiviert die Tool-Checks.

**Verworfen.** Floating-Alias (unerklärliche Verhaltensänderungen); Multi-Agent-
Orchestrierung (unnötige Angriffsfläche); lokales Modell (Betriebsaufwand).
