import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` ist ein reiner BUNDLER-Marker: Das Paket wirft beim
      // Import, sobald ein Modul in einem Client-Graphen landet, und liefert
      // im Server-Component-Graphen (Bedingung „react-server") ein leeres
      // Modul. vitest kennt beide Graphen nicht und bekäme immer die
      // werfende Variante — Server-Module wären damit grundsätzlich
      // unprüfbar. Hier wird deshalb dieselbe leere Datei aufgelöst, die
      // Next im Server-Graphen nimmt.
      //
      // Das schwächt keine Kontrolle: Dass kein Client-Modul ein
      // server-only-Modul importiert, prüft
      // scripts/regime/architecture-fitness.mjs statisch am Quelltext —
      // unabhängig davon, wie ein Test das Paket auflöst.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
