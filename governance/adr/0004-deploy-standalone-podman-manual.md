# 0004 — Deployment: Next standalone in podman, manuell via deploy.sh

**Kontext.** Ein Server, eine betreibende Person, kein Ops-Team.

**Entscheidung.** Next `output: standalone` im Multi-Stage-Containerfile (podman
rootless), `compose.yml`, Migrationen im Entrypoint; Ausrollen über `./deploy.sh`
(git pull → Build → DB-Backup → Neustart → Healthcheck) bzw. Panel-getriggert per
systemd-Path-Unit. Persistente Build-Caches beschleunigen Folge-Deploys.

**Konsequenzen.** Kein CI/CD-Runner, keine echte Canary-/Traffic-Infrastruktur →
Progressive-Delivery/SLO-Auto-Freeze bleiben Residualrisiko (Ledger F2). Der
deterministische Merge-Gate liegt in GitHub Actions (A-01), nicht im Server-Deploy.

**Verworfen.** Kubernetes/Managed-PaaS (Overhead); Deploy vom Laptop (ungegateter Pfad).
