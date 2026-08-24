/** Typen für die Prüfstände unter tests/e2e/mocks/. */
interface Window {
  aufbauen: (
    folge: Array<
      | { art: "bild"; groesse: string; seite: string }
      | { art: "text"; text: string }
    >,
    spalte?: number,
  ) => void;
}
