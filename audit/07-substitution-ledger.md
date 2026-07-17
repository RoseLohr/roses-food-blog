# audit/07 — Substitutions-Ledger

Jede Kontrolle, die ein klassisches Audit mit „ein Mensch prüft das" abschließen
würde, endet hier in einem Mechanismus (S1–S13). Lücke im Ledger = Lücke im
Betriebsmodell.

| Klassische Kontrolle | Substitution | Mechanismus hier | Status |
|---|---|---|---|
| Reviewer liest den Diff | S1 deterministischer Gate | `.github/workflows/ci.yml`: typecheck+lint+test+build blockierend | **live (Wave 1)** |
| Zweite Augenpaare | S2 adversariale Unabhängigkeit | Verifier-Flotte fremder Vendoren | Residual R-01 (kein 2. Key) |
| „Ein Mensch würde das sehen" | S3 ausführbarer Beweis | jsx-a11y-Lint, tsc, vitest, Property-Tests (geplant) | **teilweise live** |
| Weiß, ob die Tests taugen | S4 Mutation-Testing | Stryker auf Kernlogik | geplant Wave 2 (R-05) |
| Mensch gate irreversibles | S5 Reversibilität | KI hat keinen irreversiblen Tool-Zugriff (N/A F1) | **strukturell** |
| „Jemand merkt's rechtzeitig" | S6 Blast-Radius-Caps | Rate-Limiting; `max_tokens`; admin-only KI | **live** (Ausbau geplant) |
| Approving-Engineer am Gate | S1 Policy-Gate | CI + Findings-Gate; kein Override-Pfad | **live (Wave 1)** |
| Name am Approval | S9 attestierte Provenance | Mandat-/Verfassungs-Hashes; SBOM | **teilweise** (Signatur geplant) |
| On-Call als Kontrolle | S10 Out-of-Band-Break-Glass | Healthcheck/`restart:always`; nicht als Kontrolle gezählt | **live** |
| Senior bemerkt Standard-Verfall | S11 Ratchet | Lint-Fehler=0 Startlinie; Suppression-Zähler (geplant) | **teilweise live** |
| Vertrauen, dass Pipeline noch taugt | S12 kontinuierliche Kalibrierung | Seeded-Defect-Korpus | geplant Wave 1c (R-04/R-05) |
| Der Reviewer selbst | S13 Unrepräsentierbarkeit | parametrisiertes SQL; FTS-Allowlist; Prompt-Registry (geplant); gepinntes Modell | **teilweise live** |
