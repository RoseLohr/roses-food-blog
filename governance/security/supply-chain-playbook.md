# Supply-Chain-Playbook (C-03) — halluzinierte/vergiftete Pakete

**Owner:** platform-security · **Stand:** 2026-07-17

Dies ist der Angriffspfad, der am spezifischsten auf einen maschinen-gebauten
Codebestand zielt: Modelle erfinden reproduzierbar Paketnamen (~43 % wiederkehrend),
Angreifer registrieren sie vor. Es gibt keinen Reviewer, der den Import-Block liest —
also prüft die Pipeline jedes Paket maschinell.

## Stehende Kontrollen (aktiv)
- **Existenzprüfung** (`scripts/regime/deps-existence.mjs`) — blockiert nicht-existente/
  halluzinierte Pakete vor Installation (B-04, Kalibrier-Seed S3).
- **Pin per Lockfile** — `package-lock.json`; kein `latest`, keine ungepinnten Ranges im Build.
- **npm audit ≥ high** — blockierend im security-Gate.
- **Lizenz-/Copyleft-Scan** (`license-scan.mjs`).

## Registry-Alter/Reputation (Kadenz, nächtlich)
Ein neu registriertes Paket (jünger als 90 Tage) oder mit sehr geringer Reputation
ist verdächtig. Diese Prüfung braucht Netzwerkzugriff auf die Registry und läuft
als **nächtliche Kadenz** (nicht im offline-Merge-Gate), Owner platform-security.
Fund → Finding + Block des betroffenen Updates.

## Playbook: „ein vergiftetes/verdächtiges Paket wurde gefunden"
1. **Stop:** betroffenes Paket im Lockfile pinnen/entfernen; Deploy-Admission ist
   ohnehin fail-closed (`findings-gate --admission`).
2. **Blast-Radius:** `npm ls <paket>` — wer zieht es? SBOM (`sbom.json`) konsultieren.
3. **Ersatz/Entfernung:** letzte gute Version pinnen oder Abhängigkeit ersetzen.
4. **Rotation:** falls Build-Secrets exponiert sein könnten → rotieren (secret-scan bleibt scharf).
5. **Post-Mortem:** Finding in `audit/06-residual-risk-register.md`; Existenz-/
   Alters-Schwelle ggf. verschärfen (Ratchet).

## Ratchet & Tripwire
Unverifizierte Abhängigkeiten bleiben bei 0. Kalibrier-Seed S3 (monatlich) muss
einen plausiblen, nicht-existenten Paketnamen vor Installation blocken.
