/**
 * Länderbestimmung über lokale DB-IP-Country-Lite-Datenbank (Annahme B2/A4).
 * Die IP wird ausschließlich im Request-Speicher verwendet und NIE gespeichert.
 * Fehlt die Datenbankdatei, wird "??" (unbekannt) geliefert.
 */
import fs from "node:fs";
import path from "node:path";
import { Reader, type CountryResponse } from "mmdb-lib";

let reader: Reader<CountryResponse> | null = null;
let loadedAt = 0;

function mmdbPath(): string {
  return path.join(process.env.DATA_DIR ?? "./data", "geoip", "country.mmdb");
}

function getReader(): Reader<CountryResponse> | null {
  // Alle 6 h neu laden (monatliche Updates via scripts/update-geoip.sh)
  if (reader && Date.now() - loadedAt < 6 * 60 * 60 * 1000) return reader;
  try {
    const buf = fs.readFileSync(mmdbPath());
    reader = new Reader<CountryResponse>(buf);
    loadedAt = Date.now();
    return reader;
  } catch {
    reader = null;
    return null;
  }
}

/** ISO-3166-alpha2-Ländercode oder "??" */
export function lookupCountry(ip: string): string {
  const r = getReader();
  if (!r) return "??";
  try {
    return r.get(ip)?.country?.iso_code ?? "??";
  } catch {
    return "??";
  }
}

/**
 * Ist die GeoIP-Datenbank vorhanden? Ohne sie ist JEDES Land „unbekannt" —
 * die Statistik-Seite zeigt dann einen Hinweis mit Abhilfe
 * (scripts/update-geoip.sh + monatlicher Cron, siehe README).
 */
export function geoDbAvailable(): boolean {
  try {
    fs.accessSync(mmdbPath(), fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
