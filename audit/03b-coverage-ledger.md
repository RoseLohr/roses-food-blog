# Deckungs-Ledger — Track-C-eigene Oberflächen

Jedes Audit-Surface-Item, das **nur** eine Track-C-Prüfung berührt (Track A/B
deckt es nicht). Ziel: kein Track-C-relevanter Teil der Oberfläche bleibt
ungeprüft. Regeneriert in Phase 6′ gegen die generierte Architektur.

| Oberflächen-Item | Pfad | Prüfungen (nur/primär Track C) |
|---|---|---|
| KI-Aufrufpfad (Generierung) | `src/lib/ai-recipe.ts`, `src/lib/ai-recipe-jobs.ts` | C-05, C-07, C-08, C-10, C-12, C-30, C-38 |
| KI-Prompt-Registry | `src/lib/prompts/recipe-draft.ts` | C-24, C-33, C-36 |
| KI-Route (admin-only) | `src/app/api/admin/recipes/ai/route.ts`, `.../ai/ping/route.ts` | C-01, C-05, C-09, C-29 |
| Modellanbieter-Egress | `@anthropic-ai/sdk` (Aufruf in ai-recipe.ts) | C-08, C-26, C-28, C-34 |
| Kontakt-/CRM-PII-Stores | `contact`, `contactInterest`, `contactTagAssign`, `contactSegment`, `contactActivity`, `emailQueue`, `sequenceLog`, `campaignLog` | C-04, C-23, C-32(N/A) |
| Erasure/Anonymisierung | `src/lib/contacts.ts` (`anonymizeContact`) | C-04 |
| Tracking-Retention | `src/lib/tracking.ts` (Aggregat+Purge, 730 T) | C-04, C-23 |
| Observability-Store | `src/lib/observability.ts` (`ops_event`, `logJson`) | C-23 |
| Admin-Authz-Fläche | 16 `actions.ts` + `api/admin/**` Routen + `(protected)/layout.tsx` | C-01, C-12 |
| Datei-Auslieferung | `src/app/uploads/[...pfad]/route.ts` | C-01 |
| Abhängigkeits-Manifest | `package.json`, `package-lock.json`, `sbom.json` | C-03, C-25, C-26 |
| Deploy-/Admission-Kette | `deploy.sh`, `scripts/regime/findings-gate.mjs --admission`, `.github/workflows/ci.yml` | C-26, C-37 |
| Governance-Policy-Bündel | `governance/constitution.md`, `governance/mandate/*`, `governance/ai-policy.md` | C-11, C-13(N/A), C-33, C-37 |
| Provenance-Kette | git-Historie + Commit-Trailer + Prompt-`PROMPT_VERSION` + Hash-Attests | C-37 |

**N/A-Oberflächen (bewusst nicht vorhanden — Tripwire deckt Wiederauftauchen):**
Tool-/MCP-Registry (C-17/C-18), Agenten-Runtime/Memory (C-06/C-16/C-19),
Vektor-/Embedding-Store (C-22/C-32), Trainings-/Tuning-Pipeline (C-21),
LLM-as-Judge-Gate (C-14). Der `ai-capability-guard` (Phase 5′) fällt den Build,
sobald eine dieser Flächen eingeführt wird — genau dort tauchen die N/A-Verdikte
wieder auf.
