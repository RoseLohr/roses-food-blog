# A-02 — Mutation-Baseline (S11-Ratchet)

Gemessen mit Stryker (vitest-Runner) über reine Kernlogik mit starken Unit-Tests.
Der Mutations-Score ist das wahre Maß des Sicherheitsnetzes: Er sagt, ob die
Tests injizierte Fehler wirklich **fangen** (nicht nur Zeilen abdecken).

## Baseline (Stand Wave 3b)
| Datei | Score | getötet | überlebt | timeout |
|---|---|---|---|---|
| **Alle** | **82,91 %** | 386 | 65 | 7 |
| saisonkalender.ts | 75,59 % | 187 | 49 | 5 |
| season.ts | 80,95 % | 51 | 11 | 0 |
| slug.ts | 94,44 % | 32 | 2 | 2 |
| visitor-class.ts | 95,87 % | 116 | 3 | 0 |

## Ratchet (S11)
- Boden: **break = 78 %** (in `stryker.config.json`) — eine Regression darunter
  blockiert (`npm run mutation`, CI-Job `mutation`).
- Richtung: darf nur steigen; eine Absenkung der Schwelle ist ein Amendment
  (Artikel XIII) und selbst ein Finding.
- Cadence: bei jeder Änderung an den gemuteten Modulen (CI) + wöchentlich voll.
- Erweiterung: weitere Kernlogik-Module (search-Query-Builder, recipe-save
  parseAmount, saison-Bänder) werden schrittweise in `mutate` aufgenommen —
  die Liste darf nur wachsen.
