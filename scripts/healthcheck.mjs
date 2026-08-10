#!/usr/bin/env node
/**
 * Container-Healthcheck (compose.yml → healthcheck.test).
 *
 * WARUM EINE DATEI UND KEIN INLINE-JAVASCRIPT:
 * Der Test stand früher als Einzeiler in compose.yml
 * (`node -e "fetch('…').then(r=>process.exit(r.ok?0:1))…"`). podman führt den
 * Healthcheck über `/bin/sh -c` aus; die Klammern und Anführungszeichen des
 * JavaScript wurden dabei von der Shell interpretiert statt weitergereicht:
 *
 *     /bin/sh: 1: Syntax error: "(" unexpected
 *
 * Die Kontrolle feuerte damit NIE — der Container galt dauerhaft als
 * „unhealthy", unabhängig vom tatsächlichen Zustand, und ein echter Ausfall
 * wäre nicht aufgefallen (Vorfall 2026-08-10). Als eigene Datei enthält das
 * Kommando keine Shell-Metazeichen mehr; die Fehlerklasse ist strukturell weg.
 *
 * Verhalten: /health muss binnen TIMEOUT mit 2xx antworten. Alles andere —
 * Fehlerstatus, Verbindungsfehler, Zeitüberschreitung — ist fail-closed
 * (Exit 1). tests/deploy-betrieb.test.ts wacht über beide Eigenschaften.
 */
const PORT = process.env.PORT || "3000";
// Kürzer als das `timeout: 5s` in compose.yml, damit wir selbst mit einer
// klaren Meldung enden statt vom Healthcheck-Timeout hart abgeschnitten zu
// werden (podman zeigt sonst nur einen leeren Output).
const TIMEOUT_MS = 4000;

const abbruch = new AbortController();
const timer = setTimeout(() => abbruch.abort(), TIMEOUT_MS);

try {
  const antwort = await fetch(`http://127.0.0.1:${PORT}/health`, {
    signal: abbruch.signal,
  });
  if (!antwort.ok) {
    console.error(`healthcheck: /health antwortete mit HTTP ${antwort.status}`);
    process.exit(1);
  }
  process.exit(0);
} catch (fehler) {
  console.error(
    `healthcheck: /health nicht erreichbar (${fehler instanceof Error ? fehler.message : fehler})`,
  );
  process.exit(1);
} finally {
  clearTimeout(timer);
}
