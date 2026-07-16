# A-36 — Kalibrier-Korpus (Regime-Herzschlag)

Der Katalog (A-36, S12) verlangt, dass die Verifikations-Pipeline **fortlaufend**
mit geseedeten Defekten kalibriert wird: Ein Gate, das seinen Seed nicht mehr
fängt, ist ein *failed gate* und friert Releases ein. Nur so bleibt ein grüner
Build aussagekräftig.

## Was hier liegt
- `seeds.json` — die 6 Defekt-Klassen aus Phase 2, je mit `aktiv`, benannter
  fangender `kontrolle` und ausführbarem `control_cmd` (oder N/A-Begründung).
- `inject.mjs` — `--list` zeigt die Klassen; `--selftest` (Default) führt für
  jede **aktive** Klasse die benannte Kontrolle aus und verlangt Erfolg.

## Ehrliche Grenze (Residualrisiko)
Eine **echte fortlaufende** Injektion in den Live-Merge-Pfad braucht einen
Scheduler/Runner (Cron), den dieses Solo-Setup nicht hat → **Residual
R-CADENCE** (`audit/06-residual-risk-register.md`), Tripwire = Fälligkeitsfenster.
Dieses Instrument ist die **on-demand**-Variante: es beweist jederzeit, dass die
benannten Kontrollen ihren Seed noch fangen.

## Status der Klassen (Stand Wave 3)
- S1 hartcodiertes Geheimnis → `secret-scan.mjs` (B-06) ✓
- S2 Cross-Tenant → N/A (kein Mandanten-Modell)
- S3 nicht-existentes Paket → `deps-existence.mjs` (B-04) ✓
- S4 verschluckte Exception → ESLint `no-empty` + `gate-selftest.mjs` (A-26/A-01) ✓
- S5 vacuous Assertion → Mutation-Testing (A-02) **pending** (Stryker) → R-A02
- S6 untrusted→Tool → N/A (kein Tool-Use)
