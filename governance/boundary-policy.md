# A-15 — Grenze Prototyp ↔ Produktion

- **Produktion erreicht nur, was das volle CI-Gate bestanden hat** und vom
  Server per `./deploy.sh` (git pull des Branch-Stands) gezogen wird.
- **Verbotene Pfade:** Deploy vom Laptop, Direkt-Edit auf dem Server, Hot-Swap
  von Prompts/Configs an der Registry vorbei (per source-gate unmöglich),
  `skip-ci`-artige Umgehungen (kein solcher Mechanismus existiert).
- **Wegwerf-/Experimentierarbeit** findet in Branches/Scratchpads statt und
  erreicht weder Produktionsdaten noch -credentials (getrenntes DATA_DIR,
  `.env` nur auf dem Server).
- Kontrolle: CI auf jedem Push; Deploy liest nur den gepushten Branch-Stand;
  `production_eligible`-Admission fail-closed.
