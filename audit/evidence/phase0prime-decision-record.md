# Phase 0′ — Beschlussakte: Aktivierung Katalog v2.0 (Track C)

**Datum:** 2026-07-17
**Volume:** Due-Diligence-Mandat Part 2 von 2 — Security, Privacy and Assurance
**Beschluss:** Die 40 registrierten Track-C-Prüfungen `C-01`…`C-40` wechseln von
`planned-extension:part2` auf `active`. Ihre Datensätze treten in
`audit/03-findings.json` als `NO-EVIDENCE` ein und blockieren an ihren Bändern —
genau wie der registrierte Scope `production_eligible` seit Part 1 §Phase 0
unten hält. Der Katalog ist damit **v2.0 aktiv**; die formale Re-Ratifizierung
der Verfassung auf v2.0 ist der Schlussakt (Phase 7′).

## Vorbedingungen (Part 2, „verify, do not assume") — geprüft

| Vorbedingung | Soll | Ist | OK |
|---|---|---|---|
| `part1_status` | COMPLETE | COMPLETE | ✅ |
| `constitution_state` | RATIFIED (v1.0) | RATIFIED | ✅ |
| Verfassungs-Hash Session == Attest | gleich | `62533c45…` == `62533c45…` (`constitution-hash --verify` grün) | ✅ |
| Mandat-Manifest nennt beide Volumes | ja | part1 `e649ea7c…`, part2 `dcacc171…` (geliefert) | ✅ |
| Phase-0–2-Artefakte vorhanden & aktuell | ja | system-map, audit-surface, check-catalogue (40 als `planned-extension:part2`), claims-ledger, calibration | ✅ |
| Ratchet-Register ungebrochen seit Part-1-Abschluss | ja | keine Regression in `audit/08-standing-regime.md` | ✅ |
| **Intervall sauber:** `production_eligible` durchgehend `false` | ja | `false` seit Part 1 (Phase 0), nie `true` gesetzt | ✅ |
| **Intervall sauber:** kein Produktionsverkehr zwischen den Teilen | ja | System wurde nie in Produktion promotet; der DM2-Deploy-Vorfall war „Deploy nicht ausgeführt" (kein Live-Traffic). Admission-Gate `findings-gate --admission` verweigert fail-closed. | ✅ |

**Ergebnis:** Alle Vorbedingungen erfüllt. Es gibt **keinen Gate-Bypass-Befund**;
das System hat zwischen Part 1 und Part 2 keinen Produktionsverkehr bedient, und
die fail-closed-Admission (`deploy-admission-proof`-Job) hat den Riegel gehalten.

## Baseline-Attest (frozen Phase-0′)

| Artefakt | Wert |
|---|---|
| Commit (HEAD) | `160228fccd6cd763d1a5d6a0a1ad6245f5f9ba3a` |
| Branch | `claude/roses-food-blog-vxs3vm` |
| Laufzeit / Framework | Next.js `16.2.10`, Node ≥20, better-sqlite3 `12.11.1`, Drizzle `0.45.2` |
| KI-Modellanbieter | Anthropic (`@anthropic-ai/sdk` `0.111.0`), Modell gepinnt (B-13), ein Aufrufpfad (`src/lib/ai-recipe.ts`) |
| KI-Fähigkeiten | **Nur Generierung** (Text→Text): Rezeptentwurf. Kein Tool-Use, kein Agenten-Runtime, kein RAG/Retrieval, kein Vektor-Store, kein persistentes Agenten-Memory, kein Fine-Tuning/Custom-Modell. |
| Persönliche Daten (EU) | Newsletter/CRM (Double-Opt-in-Kontakte), Tracking (IP normalisiert). GDPR gilt. |
| Stores | SQLite-Datei (`$DATA_DIR`), Medien-Dateisystem, Build-/npm-Caches. Kein Vektor-Store, kein externer Log-/Trace-Store. |
| Egress-Pfade | (1) Anthropic-API (nur Admin-ausgelöst), (2) SMTP (Newsletter/Alarm). Kein modellgesteuerter Egress. |
| Attestierte Baselines verknüpft | Part-1-Abschluss: Commit `ad3ff31` (findings v1.0). Part-2-Phase-0′: Commit `160228f`. **Code-Delta seit Part-1-Abschluss: keines** (Arbeitsbaum sauber); das Delta dieses Volumes ist reiner **Scope-Delta** — Aktivierung der 40 Track-C-Prüfungen. |

## Mandat-Hashes (nach Lieferung Part 2)

| Datei | SHA-256 |
|---|---|
| `governance/mandate/part1.md` | `e649ea7ccb4f1bd495b9a7ab2e0a40476824a63da3507b6e33d529dcf2f90742` |
| `governance/mandate/part2.md` | `dcacc17151d3d40104f692ad153f8f81a54369bf97f6ab8b3634104cf98ecf35` |
| `governance/mandate.md` (kombiniert) | `ba93ff3bf9e2f77623e48a21cbe339bee2fd57e47b9bd052d01c00d9cf1b67d8` |

Konkatenationsregel: `cat part1.md; printf '\n'; cat part2.md`. Die kombinierte
`mandate.md` regeneriert deterministisch und stimmt mit obigem Hash überein.

## Delta-Map (Audit-Surface, Part-1-Abschluss → Phase-0′)

Keine Änderung an Code, Abhängigkeiten, Stores oder Egress seit Part-1-Abschluss
(`160228f` trägt nur die Part-1-Endbilanz-Commits). Die Audit-Surface-Inventur
`audit/00-audit-surface.json` bleibt gültig; sie wird in Phase 6′ gegen die
generierte Architektur re-diffed. Der einzige Zuwachs ist der **Prüf-Scope**:
79 → 119 aktive Prüfungen, additiv über den vom Regime vorgesehenen Pfad
(Part 1 §9.9, Artikel XII) — genau einmal, per dieser Beschlussakte.
