// Flat-Config (ESLint 9). Fehlte bisher ganz — jetzt der statische Gate für
// Code-Standards UND Barrierefreiheit (jsx-a11y). Läuft in CI blockierend.
// Bewusst schlank gehalten (kein type-checked-Linting, damit es schnell und
// deterministisch bleibt); die Korrektheit prüft weiterhin `tsc --noEmit`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "audit/**",
      "public/**",
      "drizzle/**",
      "coverage/**",
      "test-results/**",
      "*.config.*",
      "next-env.d.ts",
      "scripts/**", // reine Node-Skripte (.mjs), kein App-Code
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Barrierefreiheit: jsx-a11y „recommended" als ERROR auf allen React-Dateien.
  // Das ist der automatisierte A11y-Gate (WCAG-relevant, deterministisch).
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Label umschließt Checkbox + Text in verschachtelten <span> (Tiefe 3).
      "jsx-a11y/label-has-associated-control": ["error", { depth: 3 }],
    },
  },
  // Next- und React-Hooks-Regeln registrieren (u. a. damit vorhandene
  // Inline-Disable-Kommentare gültig sind). `no-img-element` bleibt AUS:
  // die App nutzt bewusst <img> mit eigenen WebP-Varianten
  // (next.config: images.unoptimized) statt des eingebauten Optimizers.
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      "@next/next/no-img-element": "off",
      // Klassische Hook-Korrektheit: Regelverstoß hart, Dependency-Lücke als
      // Warnung. Die neuen React-Compiler-Regeln (set-state-in-effect, purity,
      // refs, immutability) bewusst NICHT als Error — sie sind Optimierungs-
      // hinweise, keine Korrektheitsfehler, und würden auf Bestandscode einen
      // unverhältnismäßigen, riskanten Umbau erzwingen.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // Feinjustierung: pragmatische Regeln für einen bestehenden, bislang
  // ungelinteten Codebase. A11y bleibt hart (error); rein stilistische
  // TS-Rauschquellen sind Warnungen, damit der Gate heute grün startet
  // (S11-Ratchet: von hier aus darf es nur besser werden).
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  },
);
