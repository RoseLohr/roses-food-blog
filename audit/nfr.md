# A-17 / A-27 — Nicht-funktionale Anforderungen (spezifiziert & gemessen)

Neun Qualitätsmerkmale (ISO/IEC 25010). Priorisierte Merkmale tragen eine ZAHL
und eine laufende Messung; ehrlich als *pending* markiert, was noch nicht
gemessen wird (kein erfundener Wert).

| Merkmal | Priorität | Ziel (Zahl) | Messung / Gate |
|---|---|---|---|
| Funktionale Eignung | hoch | Testsuite grün; Mutation ≥ 78 % Kernlogik | vitest (CI) + Stryker (`mutation`-Job) |
| Zuverlässigkeit | hoch | Restore-Drill funktioniert; Migration idempotent | `restore-drill.sh`; migrate-Tests |
| Sicherheit | hoch | 0 kritische Deps; keine Secrets; strikte CSP | npm audit ≥high, `secret-scan`, `next.config` CSP |
| Wartbarkeit | hoch | Mutation-Boden; ESLint 0 Fehler; ADRs vorhanden | Stryker-Ratchet; `lint`; `governance/adr` |
| Interaktionsfähigkeit (A11y) | hoch | WCAG 2.2 AA, 0 serious/critical | jsx-a11y (statisch) + axe-Runtime (`tests/e2e/a11y`) |
| Performance | mittel | Core Web Vitals p75: LCP<2,5s · INP<200ms · CLS<0,1 | **pending** — kein RUM (Residual R-CWV) |
| Kompatibilität | mittel | moderne Browser; responsive ab 320px | manuelle/Playwright-Viewports |
| Flexibilität | niedrig | Inhalte über Admin ohne Deploy änderbar | vorhanden (CRUD) |
| Safety (KI) | hoch | siehe KI-Budgets unten | Prompt-Registry, gepinntes Modell |

## KI-Budgets (A-27)
| Budget | Ziel | Durchsetzung / Status |
|---|---|---|
| Time-to-first-token | — (kein Streaming-Feature) | n/a; ein synchroner Aufruf |
| End-to-end pro Aufruf | ≤ 90 s | Client-`timeout: 90_000`, `maxRetries: 1` |
| Tokens pro Aufruf | ≤ 8000 out | `max_tokens: 8000` |
| Kosten/Aufruf-Deckel (Infra) | **pending** | Residual R-COST — kein Infra-Cap (nur admin-only + Rate-Limit) |
| Groundedness/Halluzination | Ausgabe wird vom Admin **vor** Übernahme geprüft | menschliche In-command-Kontrolle; kein Auto-Publish |
| Reproduzierbarkeit | Schema-gebunden (Zod), kein Thinking | deterministische Feldbindung |

**Ehrliche Grenzen (Residual-Register):** Core Web Vitals (RUM) und ein Infra-
seitiger KI-Kosten-Cap sind noch nicht gemessen/erzwungen — mit Tripwire in
`audit/06-residual-risk-register.md` geführt, nicht stillschweigend übergangen.
