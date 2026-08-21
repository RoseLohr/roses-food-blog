/**
 * Ein Block, der nichts anzeigt, darf den Bericht nicht gliedern.
 *
 * DER BEFUND: `gruppiere()` (src/lib/bildreihen.ts) schließt eine offene
 * Bildzeile bei JEDEM Nicht-Bildblock. Ein Textblock, der im Bericht nichts
 * zeigt, ist trotzdem ein Block. Steht er zwischen dem zweiten und dritten
 * Bild, zerfällt eine Zeile aus drei S-Bildern in zwei — und zwar in genau das
 * gemeldete Bild:
 *
 *   heil    -> EINE Zeile, 6/6, Klasse `br-1-1`, platz = null  (kein Float,
 *              volle Spalte, alle drei nebeneinander)
 *   zerteilt-> `br-2-3` mit platz „links" + `br-1-3` mit platz „links"
 *              (zwei schwebende Zeilen: zwei Bilder oben, das dritte darunter,
 *              beide plötzlich linksbündig)
 *
 * Die Linksausrichtung ist dabei kein Zufall, sondern die Signatur des Bruchs:
 * Erst die zerteilten Zeilen bekommen überhaupt eine Seite, weil `fliesstText`
 * nur bis zwei Drittel wahr ist. Eine heile Dreier-Zeile schwebt nie.
 *
 * Der Verursacher ist auf der Seite nicht zu sehen: travel-view.tsx zieht den
 * folgenden Textblock in denselben `.bildlauf` wie die Bildzeile davor, es
 * bleibt nicht einmal eine Lücke.
 *
 * Die Schreibwege prüfen das bereits. Das trägt aber nur für das, was über sie
 * hereinkommt — nicht für Altbestand, eine Wiederherstellung oder einen Weg,
 * den es heute noch nicht gibt. Deshalb wird hier der LESEWEG geprüft: Blöcke
 * werden an der Datenbank vorbei direkt eingesetzt.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zuRenderBloecken } from "@/lib/bildreihen";

let tmp: string;
let db: typeof import("@/db").db;
let schema: typeof import("@/db").schema;
let getFullTravelPost: typeof import("@/lib/travel").getFullTravelPost;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "roses-zeile-"));
  process.env.DATA_DIR = tmp;
  execSync("node scripts/migrate.mjs", {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: tmp },
    stdio: "pipe",
  });
  ({ db, schema } = await import("@/db"));
  ({ getFullTravelPost } = await import("@/lib/travel"));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Bericht mit drei S-Bildern als EINE Zeile, optional durch `stoerer` geteilt. */
async function berichtMitDreierZeile(slug: string, stoerer?: string) {
  const [post] = await db
    .insert(schema.travelPost)
    .values({
      title: slug,
      slug,
      status: "veroeffentlicht",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  const bilder = [];
  for (let i = 0; i < 3; i++) {
    const [img] = await db
      .insert(schema.mediaImage)
      .values({
        fileKey: `${slug}-${i}`,
        originalName: `${slug}-${i}.jpg`,
        width: 800,
        height: 600,
        sizeBytes: 1000,
        createdAt: new Date(),
      })
      .returning();
    bilder.push(img);
  }

  // Die Absicht ist vollständig gesetzt: alle drei S, alle „links", die
  // hinteren beiden ausdrücklich „neben dem Bild darüber".
  const bloecke: Array<Record<string, unknown>> = [];
  let sort = 0;
  for (let i = 0; i < 3; i++) {
    if (i === 2 && stoerer !== undefined) {
      bloecke.push({
        travelPostId: post.id,
        sortOrder: sort++,
        type: "text",
        markdown: stoerer,
      });
    }
    bloecke.push({
      travelPostId: post.id,
      sortOrder: sort++,
      type: "bild",
      imageId: bilder[i].id,
      groesse: "s",
      platz: "links",
      mitVorherigem: i > 0,
    });
  }
  await db.insert(schema.travelBlock).values(bloecke as never);
  return post;
}

/** Die Bildzeilen des Berichts als „Bruch + Platz", so wie sie gerendert würden. */
async function zeilen(slug: string) {
  const full = await getFullTravelPost({ slug });
  if (!full) throw new Error(`Bericht „${slug}" nicht gefunden`);
  return zuRenderBloecken(full.blocks)
    .filter((b) => b.art === "bild")
    .map((b) => ({
      anzahl: b.imageIds.length,
      breite: `${b.breite.z}/${b.breite.n}`,
      platz: b.platz,
    }));
}

describe("Bildzeile gegen unsichtbare Blöcke", () => {
  it("bleibt heil, wenn nichts dazwischen steht (Gegenprobe)", async () => {
    await berichtMitDreierZeile("heil");
    expect(await zeilen("heil")).toEqual([
      { anzahl: 3, breite: "1/1", platz: null },
    ]);
  });

  it.each([
    ["leer", ""],
    ["nur Leerraum", "   \n  "],
    ["nur eine Raute", "##"],
    ["nur ein Zitatzeichen", ">"],
    ["Nullbreiten-Leerzeichen", "​"],
    ["geschütztes Leerzeichen als Entität", "&nbsp;"],
    ["Verweis ohne Beschriftung", "[](/reisen)"],
  ])(
    "zerfällt NICHT an einem Textblock, der nichts zeigt (%s)",
    async (name, stoerer) => {
      const slug = `stoerer-${name.replace(/[^a-z]/gi, "")}`;
      await berichtMitDreierZeile(slug, stoerer);
      expect(await zeilen(slug)).toEqual([
        { anzahl: 3, breite: "1/1", platz: null },
      ]);
    },
  );

  it.each([
    ["ein echter Absatz", "Nachmittags wird es windig."],
    // Beide sahen für mich nach „zeigt nichts" aus. Der Renderer sagt etwas
    // anderes, und er hat recht: `marked` maskiert rohes HTML, der Kommentar
    // steht als „&lt;!-- … --&gt;" LESBAR auf der Seite; „**" bleibt „**".
    // Wer hier raten würde, würde sichtbaren Text verschwinden lassen — die
    // Fälle stehen deshalb ausdrücklich auf dieser Seite.
    ["ein maskierter HTML-Kommentar", "<!-- Notiz an mich -->"],
    ["zwei Sternchen ohne Inhalt", "**"],
  ])(
    "zerfällt sehr wohl an einem Textblock, der etwas zeigt (%s)",
    async (name, text) => {
      // Die Gegenprobe zur Gegenprobe: Was etwas zeigt, IST ein Trenner und
      // soll es bleiben. Sonst hätte die Reparatur die Regel nur aufgeweicht.
      const slug = `zeigt-${name.replace(/[^a-z]/gi, "")}`;
      await berichtMitDreierZeile(slug, text);
      expect(await zeilen(slug)).toEqual([
        { anzahl: 2, breite: "2/3", platz: "links" },
        { anzahl: 1, breite: "1/3", platz: "links" },
      ]);
    },
  );

  it("zeigt dem Editor den unsichtbaren Block trotzdem an", async () => {
    // Wer ihn löschen soll, muss ihn sehen. Der Bericht rechnet ihn nicht mehr
    // mit, der Editor bekommt ihn unverändert.
    await berichtMitDreierZeile("fuer-editor", "&nbsp;");
    const roh = await getFullTravelPost({ slug: "fuer-editor" }, "roh");
    expect(roh?.blocks.filter((b) => b.type === "text")).toHaveLength(1);

    const bericht = await getFullTravelPost({ slug: "fuer-editor" });
    expect(bericht?.blocks.filter((b) => b.type === "text")).toHaveLength(0);
  });
});
