# B-39 — Referenz-Framework-Review (Twelve-Factor, kompakt)

| Faktor | Stand | Lücke/Notiz |
|---|---|---|
| I Codebase | ✓ ein Repo, git | — |
| II Dependencies | ✓ lockfile + Existenz-Gate (B-04) | — |
| III Config | ✓ `.env` + DB-Settings, nichts im Image | — |
| IV Backing Services | ✓ SQLite/SMTP/Anthropic als angebundene Ressourcen | — |
| V Build/Release/Run | ✓ Multi-Stage-Image, Migrationen im Entrypoint | Release-Artefakt nicht signiert (B-27, Residual) |
| VI Processes | ✓ ein zustandsloser Prozess (Zustand in DB/Uploads) | — |
| VII Port Binding | ✓ PORT-gebunden, nginx davor | — |
| VIII Concurrency | △ Single-Node bewusst (ADR 0006) | Skalierung = neuer ADR |
| IX Disposability | ✓ restart:always, schnelle Starts, WAL | — |
| X Dev/Prod-Parität | ✓ gleiche Engine (SQLite) überall, `.pw-data`/`.e2e-data` getrennt | Prod-Cred-Assertion offen (B-25 → Part 2/C-16-Tür) |
| XI Logs | ✓ strukturierte JSON-Streams nach stdout (neu, B-03) | — |
| XII Admin-Prozesse | ✓ Migration/Seed/Drills als Skripte | — |

**Ergebnis:** keine unbekannten Lücken; die zwei △/Notizen sind bereits als
Residuals bzw. Part-2-Türen im Register geführt. Review-Wiederholung: bei
größeren Architekturänderungen (ADR-Pflicht).
