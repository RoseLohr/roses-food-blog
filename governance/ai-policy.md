# A-14 — Policy: Wie KI dieses System baut und wartet (Tier-Map)

## Wer/was ändert dieses System
- **Coding-Agent (Claude)** über Claude Code, in-command gesteuert durch die
  Betreiberin (Spezifikation + Freigaben). Kein autonomer Dauerbetrieb.
- **KI-Feature im Produkt:** genau eines (Rezeptentwurf, ADR 0003) — gepinntes
  Modell, kein Tool-Use, Ausgabe stets menschlich geprüft.

## Verifikations-Tiers je Änderungsklasse (der Router der Proportionalität)
| Tier | Änderungsklasse | Pflicht-Gate |
|---|---|---|
| 0 | Texte/Doku/Audit-Artefakte (kein Laufzeitcode) | typecheck+lint (CI-Volldurchlauf läuft ohnehin) |
| 1 | UI/Styling ohne Logik | Tier 0 + build + axe-A11y |
| 2 | Anwendungslogik | Tier 1 + vitest + Mutation (geänderte Kernmodule) + Klon-Tripwire |
| 3 | Auth, Speicherpfad (recipe-save/travel-save), Migrationen, KI-Pfad, Mailer | Tier 2 + Integrationstests des Bereichs + Live-E2E-Verifikation |
| 4 | Gate/Regime/Verfassung (`scripts/regime/`, `.github/`, `governance/`) | Tier 3 + Gate-Selbsttest + Hash-Attestierung + CODEOWNERS-Freigabe (B-35) |
**Unklassifizierbar → Tier 4 (strengstes).**

## Nicht verhandelbar
- Prompts nur in der Registry (A-20); Modelle nur gepinnt (B-13).
- Der Agent, der Code schreibt, entscheidet nie allein über sein eigenes Gate
  (B-35: CODEOWNERS-Trennung; Verfassung Artikel II).
- Wahrgenommene Geschwindigkeit ist kein Beleg — Messgrößen sind die Ratchets
  (Mutation, Klone, axe, Katch-Raten), nicht das Gefühl.
