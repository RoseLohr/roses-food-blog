/**
 * Der Name des Suchparameters, über den eine Admin-Aktion ihre Einmal-
 * Statusmeldung an die nächste Seite reicht (`?meldung=Rezept gespeichert.`).
 * Gelesen wird er in `src/components/admin/meldung.tsx`; `src/lib/sitzung.ts`
 * streicht ihn aus dem Rückweg des Logins. Beide brauchen denselben Namen,
 * und der steht deshalb hier — rein, ohne React, damit der Proxy ihn laden
 * kann, ohne eine Komponente mitzuziehen.
 */
export const MELDUNG_PARAM = "meldung";
