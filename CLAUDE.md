# Agenten-Instruktionen — Roses Food Blog

Diese Datei ist der Einstiegspunkt für jeden Agenten (und jede Person), der in
diesem Repository arbeitet. Sie ist Teil des Governance-Regimes (A-32/A-33/A-37).

## Zuerst lesen, dann ändern
1. **`governance/constitution.md`** — die ratifizierte Verfassung (v1.0). Sie
   bindet jede Änderung. Ihr Hash ist attestiert; eine Änderung an ihr ohne
   `node scripts/regime/constitution-hash.mjs --attest` schlägt in CI fehl.
2. **`governance/adr/`** — die Architektur-Entscheidungen (Datastore, Auth,
   KI-Provider, Deployment, kein Multi-Tenant). Nicht dagegen arbeiten;
   Abweichung = neuer ADR.
3. **`audit/10-exceptions-ledger.md`** — beschlossene Ausnahmen (F1–F4) und
   ihre Tripwires. **Wer eine Voraussetzung schafft (z. B. ersten Tool-Use im
   KI-Pfad, zweiten Mandanten, IaC), reaktiviert die zugehörigen Prüfungen.**

## Keine Workarounds — nur Ursachen (verbindlich, angeordnet 2026-07-17)
- **Rote CI-Checks, fehlschlagende Gates oder Fehler werden an der WURZEL
  behoben, nie umgangen.** Kein Unterdrücken, kein Tolerieren, kein „skip/allow",
  kein Weichspülen einer Kontrolle, kein Vorbei-Mergen an einer roten Ampel.
- **Es werden auch keine Workarounds mehr VORGESCHLAGEN.** Wenn nur ein
  Workaround möglich wäre, ist das der Befund — dann Root-Cause benennen und
  korrekt lösen (oder ehrlich sagen, dass es (noch) nicht sauber lösbar ist),
  statt eine Umgehung anzubieten.
- Ausnahmen sind ausschließlich die schriftlich ratifizierten Einträge im
  `audit/10-exceptions-ledger.md` (F1–F4) mit Tripwire — nichts Ad-hoc.

## Harte Regeln (vom Gate erzwungen — nicht diskutabel)
- Jede Änderung muss das CI-Gate bestehen: `npm run typecheck && npm run lint
  && npm test && npm run build` plus die Regime-Skripte (`scripts/regime/`).
- **Kein** Inline-System-Prompt außerhalb `src/lib/prompts/` (A-20).
- **Kein** floating Modell-Alias (`…latest`/`…preview`) — nur gepinnte
  Snapshots (B-13).
- **Keine** leeren `catch {}`-Blöcke (A-26), **keine** Stub-Marker in `src/`
  (A-16), **keine** Secrets im Quelltext (B-06 — STOP-SHIP).
- Mutation-Score Kernlogik ≥ 78 % (`npm run mutation`), Duplikation ≤ 5,5 %
  (`npm run clones`), axe-A11y 0 serious/critical (`npm run test:a11y`).
- Deploy-Freigabe liest `audit/engagement-status.json` → `production_eligible`
  (aktuell `false`, bis Part 2/Track C schließt). **Fail-closed.**

## Arbeitsweise
- Deutsch in Kommentaren, Commits, UI-Texten. Kleine, atomare Commits.
- Committer: `Claude <noreply@anthropic.com>`; Push auf den Arbeits-Branch.
- Tests zuerst rot, dann grün; Verhalten mit Playwright/vitest real verifizieren.
- Temporäre Dateien ins Scratchpad, nie ins Repo.
- **Vor jedem Push den VOLLEN Gate-Lauf lokal fahren** (nicht nur die geänderten
  Skripte) — Root-Cause-Disziplin heißt auch, rote Checks nicht erst in CI zu
  entdecken.
- **IMMER den PR beobachten (angeordnet, verbindlich):** Nach jedem erstellten
  ODER aktualisierten Pull Request den PR abonnieren (CI- **und** Review-
  Aktivität, `subscribe_pr_activity`) und dranbleiben, bis er gemergt/geschlossen
  ist — Fehlschläge autonom an der Wurzel fixen (kein Workaround) und Review-
  Kommentare beantworten, sobald sie eintreffen. Nicht abwarten, bis jemand fragt.

## Betrieb (Kurzüberblick)
- Next.js 16 standalone in podman; Deploy: `./deploy.sh` auf dem Server
  (Schnellpfad, Layer-Cache, Healthcheck) oder Admin-Panel „Aktualisierung".
- Selbst-Monitor: alle 5 min SLO-Check; bei Verletzung E-Mail-Alarm über
  SMTP-Settings (`src/lib/observability.ts`, `audit/slo.md`).
- Backups: Pre-Deploy-DB-Backup + `deploy/backup.sh`; Restore-Drill:
  `scripts/regime/restore-drill.sh`.

## Takeover (Mensch, Break-Glass)
Ein kompetenter Engineer ohne Vorwissen: (1) README §Setup folgen,
(2) `npm ci && npm test` (muss grün sein), (3) diese Datei + Verfassung lesen,
(4) kleinste Änderung über das volle Gate schieben. Zeit bis zur ersten
sicheren Änderung bitte messen und in `audit/` notieren (A-37-Drill).
