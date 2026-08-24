/**
 * Die Maskierung der Erhebung — gemessen an einer realistischen Ausgabe,
 * nicht nur am eigenen Selbsttest (Spur A1).
 *
 * WARUM DAS EINE EIGENE PRÜFUNG BRAUCHT: `scripts/regime/erhebung.sh` erzeugt
 * einen Bericht über den Produktionshost, und dieses Repository ist
 * ÖFFENTLICH. Die Adresse des Ursprungs darf darin nicht auftauchen — sie ist
 * der einzige Weg, an Cloudflare vorbei direkt auf den Server zu zielen.
 * Rutscht sie durch, ist der Schaden nicht rückholbar: Ein Push ist
 * veröffentlicht, auch wenn er zurückgenommen wird.
 *
 * Der Selbsttest des Skripts prüft einzelne Zeilen. Diese Prüfung hält einen
 * ganzen, realistisch geformten Bericht dagegen und verlangt, dass NICHTS
 * Gefährliches übrig bleibt — und dass das Lesbare lesbar bleibt. Ein
 * Maskierer, der alles unkenntlich macht, bestünde die erste Hälfte trivial.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const SKRIPT = path.join(process.cwd(), "scripts/regime/erhebung.sh");

function maskiert(eingabe: string): string {
  return execFileSync("bash", [SKRIPT, "--maskieren"], {
    input: eingabe,
    encoding: "utf8",
  });
}

/** Wie die Ausgabe des Skripts auf dem echten Host aussieht. */
const BERICHT = [
  "Stand: 2026-08-22T23:14:47Z",
  "roses-blog   localhost/roses-blog:latest    Up 3 days     127.0.0.1:3000->3000/tcp",
  "npm-app      docker.io/jc21/npm:2.11.1      Up 9 days     0.0.0.0:443->443/tcp",
  "Netz host · Regel always · Neustarts 2 · seit 2026-08-19T05:11:02Z",
  "proxy_pass http://127.0.0.1:3000;",
  "set_real_ip_from 173.245.48.0/20;",
  "set_real_ip_from 2400:cb00::/32;",
  // DIE DREI FORMEN, DIE DER PFLICHT-APPROVER GEFUNDEN HAT (PR #111). Sie
  // kamen an der Vorfassung UNMASKIERT durch: Der Loopback-Schutz ersetzte
  // jede Zeichenfolge `::1`, danach griff keine IPv6-Regel mehr, und die
  // Rückersetzung stellte die volle Adresse wieder her — fail-open auf genau
  // der Invariante, für die dieses Skript existiert.
  "upstream backend6 { server [2a01:4f8:c17:b8f::1]:3000; }",
  "listen [2001:db8::10]:443 ssl;",
  "fe80::1 dev eth0",
  "/home/rose/npm/data -> /data",
  "server_name blog.beispiel-domain.de;",
  "upstream backend { server 203.0.113.42:3000; }",
  "DB_PASSWORD=sehr-geheim-123",
  "X-Api-Key: 9f3c1a77e2b4d5f60a1c8e93b7d240af5c6e18b0",
  "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc",
  "client_max_body_size 20m;",
].join("\n");

describe("A1: die Erhebung ist weitergabesicher", () => {
  it("der eigene Selbsttest des Skripts läuft grün", () => {
    const aus = execFileSync("bash", [SKRIPT, "--selftest"], { encoding: "utf8" });
    expect(aus).toContain("Falle gestellt und Harmloses geschont");
  });

  it("keine öffentliche Adresse und kein Geheimnis überlebt den Bericht", () => {
    const raus = maskiert(BERICHT);
    for (const gefaehrlich of [
      "203.0.113.42", // die Ursprungsadresse — der eigentliche Grund für all das
      "173.245.48.0",
      "2400:cb00",
      "2a01:4f8:c17:b8f", // die Sorte Adresse, um die es hier eigentlich geht
      "2001:db8::10",
      "fe80::1 dev",
      "/home/rose/", // Accountname im Hostpfad
      "sehr-geheim-123",
      "9f3c1a77e2b4d5f60a1c8e93b7d240af5c6e18b0",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    ]) {
      expect(raus, `„${gefaehrlich}" steht noch im maskierten Bericht`).not.toContain(
        gefaehrlich,
      );
    }
  });

  it("was den Bericht lesbar macht, bleibt stehen", () => {
    const raus = maskiert(BERICHT);
    for (const gebraucht of [
      "2026-08-22T23:14:47Z", // ohne Zeitstempel ist ein Bericht wertlos
      "127.0.0.1:3000", // die Antwort auf M1
      "0.0.0.0:443",
      "docker.io/jc21/npm:2.11.1", // welches Proxy-Image läuft
      "client_max_body_size 20m", // die Antwort auf M2
      "Neustarts 2", // die Antwort auf M6
      "Netz host", // die Antwort auf M4
    ]) {
      expect(raus, `„${gebraucht}" fehlt im maskierten Bericht`).toContain(gebraucht);
    }
  });

  it("eine leere Eingabe ergibt keinen Bericht, sondern nichts", () => {
    // Klingt trivial, ist es nicht: Ein Filter, der bei leerer Eingabe etwas
    // erfindet, hätte in den beiden Prüfungen oben unbemerkt bleiben können.
    expect(maskiert("")).toBe("");
  });
});
