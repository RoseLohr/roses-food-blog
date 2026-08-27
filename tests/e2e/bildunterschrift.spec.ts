import { test, expect, type Page } from "@playwright/test";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { t } from "../../src/i18n/de";

/**
 * Der Alt-Text als Bildunterschrift: der Weg durch den Admin — und die Messung
 * am echten Browser, dass das Layout sie verträgt.
 *
 * ── WARUM DIE MESSUNG DAZUGEHÖRT ───────────────────────────────────────────
 *
 * Eine Unterschrift macht den Bildplatz HÖHER. Zwei Stellen könnten daran
 * zerbrechen, und beide sind nur im Browser zu sehen:
 *
 *   1. Die Reihe einer Gruppe. Ihre Bilder sind gleich hoch, weil
 *      `flex: var(--ar) 1 0` die Breite nach dem Seitenverhältnis verteilt.
 *      Wandert die Unterschrift IN das Flex-Kind, dürfen die BILDER trotzdem
 *      nicht auseinanderlaufen — auch nicht, wenn ein Text zwei Zeilen
 *      braucht und der daneben eine.
 *   2. Das Einzelbild. Es schwebt, der Text läuft darum. Die Unterschrift muss
 *      INNERHALB des schwebenden Platzes hängen; stünde sie daneben, liefe der
 *      Text neben der Unterschrift statt neben dem Bild.
 *
 * ── EIGENER BESTAND (B8) ───────────────────────────────────────────────────
 *
 * Eigener Bericht, hinterher entfernt.
 */
const dict = t();
const d = dict.admin.travel;
const ip = dict.imagePicker;

const session = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), ".pw-data/e2e-session.json"), "utf8"),
) as { token: string };

const PORT = Number(process.env.PW_PORT ?? 3333);
const TITEL = "E2E Bildunterschrift";
const GRUPPE = `fieldset:has(> legend:text-is("${d.blockBildgruppe}"))`;
const EINZELBILD = `fieldset:has(> legend:text-is("${d.blockImage}"))`;

let travelId: number | null = null;

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    { name: "session", value: session.token, url: `http://localhost:${PORT}` },
  ]);
});

async function speichern(page: Page) {
  await page.getByRole("button", { name: dict.common.save, exact: true }).click();
  await page.waitForURL(/\/admin\/reisen\/\d+\?meldung=/);
  const treffer = /\/admin\/reisen\/(\d+)/.exec(page.url());
  if (treffer) travelId = Number(treffer[1]);
}

test.describe.configure({ mode: "serial" });

test("im Admin je Foto einschaltbar — und es bleibt gespeichert", async ({ page }) => {
  await page.goto("/admin/reisen/neu");
  await page.locator('input[name="titel"]').fill(TITEL);

  // Eine Gruppe aus drei Fotos.
  await page.getByRole("button", { name: `+ ${d.blockBildgruppe}`, exact: true }).click();
  await page.locator(GRUPPE).getByRole("button", { name: ip.chooseMultiple }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 3; i += 1) await dialog.locator("button[aria-pressed]").nth(i).click();
  await dialog.getByRole("button", { name: ip.close, exact: true }).click();
  await expect(dialog).toBeHidden();

  // DER PUNKT: Das Häkchen steht an JEDEM Foto, nicht einmal an der Karte.
  const haken = page.locator(GRUPPE).getByRole("checkbox", {
    name: d.blockBildunterschrift,
  });
  await expect(haken).toHaveCount(3);
  // Standardmäßig aus — die Unterschrift ist eine Entscheidung, keine Vorgabe.
  for (let i = 0; i < 3; i += 1) await expect(haken.nth(i)).not.toBeChecked();

  // Nur das ERSTE und das DRITTE bekommen eine.
  await haken.nth(0).check();
  await haken.nth(2).check();

  await speichern(page);
  expect(travelId).not.toBeNull();

  await page.goto(`/admin/reisen/${travelId}`);
  const wieder = page.locator(GRUPPE).getByRole("checkbox", {
    name: d.blockBildunterschrift,
  });
  await expect(wieder.nth(0)).toBeChecked();
  await expect(wieder.nth(1)).not.toBeChecked();
  await expect(wieder.nth(2)).toBeChecked();
});

test("die Reihe der Gruppe bleibt bündig — die BILDER sind gleich hoch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin/reisen/${travelId}/vorschau`);

  const gruppe = page.locator("article .bildgruppe");
  await expect(gruppe).toHaveCount(1);
  // Zwei der drei Fotos tragen eine Unterschrift.
  await expect(gruppe.locator("figcaption")).toHaveCount(2);

  const masse = await gruppe.evaluate((g) => {
    const reihe = g.querySelector(".bildgruppe-weitere")!;
    const bilder = Array.from(reihe.querySelectorAll("img")).map((b) => {
      const r = b.getBoundingClientRect();
      return { y: r.y, hoehe: r.height };
    });
    return bilder;
  });

  expect(masse).toHaveLength(2);
  // Gleiche Oberkante UND gleiche Höhe: Die Unterschrift hängt darunter und
  // schiebt das Bild nicht.
  expect(Math.abs(masse[0].y - masse[1].y)).toBeLessThan(1);
  expect(Math.abs(masse[0].hoehe - masse[1].hoehe)).toBeLessThan(1);
});

test("am Einzelbild hängt die Unterschrift IM schwebenden Bildplatz", async ({
  page,
}) => {
  await page.goto(`/admin/reisen/${travelId}`);
  await page.getByRole("button", { name: `+ ${d.blockImage}`, exact: true }).click();
  await page
    .locator(EINZELBILD)
    .getByRole("button", { name: ip.choose, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: new RegExp(ip.title) });
  await expect(dialog).toBeVisible();
  await dialog.locator("button[aria-pressed]").first().click();
  await expect(dialog).toBeHidden();
  await page
    .locator(EINZELBILD)
    .getByRole("checkbox", { name: d.blockBildunterschrift })
    .check();
  await speichern(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin/reisen/${travelId}/vorschau`);

  const masse = await page.locator("article .einzelbild").evaluate((el) => {
    const platz = el.getBoundingClientRect();
    const bild = el.querySelector("img")!.getBoundingClientRect();
    const unterschrift = el.querySelector("figcaption")!.getBoundingClientRect();
    return {
      platz: { x: platz.x, breite: platz.width, unten: platz.bottom },
      bild: { x: bild.x, breite: bild.width, unten: bild.bottom },
      unterschrift: {
        x: unterschrift.x,
        breite: unterschrift.width,
        oben: unterschrift.top,
      },
    };
  });

  // Die Unterschrift steht UNTER dem Bild …
  expect(masse.unterschrift.oben).toBeGreaterThan(masse.bild.unten - 1);
  // … nicht daneben: gleiche linke Kante, gleiche Breite wie das Bild …
  expect(Math.abs(masse.unterschrift.x - masse.bild.x)).toBeLessThan(1);
  expect(Math.abs(masse.unterschrift.breite - masse.bild.breite)).toBeLessThan(1);
  // … und innerhalb des schwebenden Platzes, der dadurch höher wird.
  expect(masse.platz.unten).toBeGreaterThan(masse.bild.unten);
  expect(Math.abs(masse.platz.breite - masse.bild.breite)).toBeLessThan(1);
});

test("im Pop-up steht der Text ebenfalls unter dem Bild", async ({ page }) => {
  await page.goto(`/admin/reisen/${travelId}/vorschau`);
  await page.locator("article .einzelbild button").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("figcaption")).toHaveCount(1);
  await expect(dialog.locator("figcaption")).not.toBeEmpty();
});

test("ein Fotowechsel nimmt dem Einzelbild die Unterschrift", async ({ page }) => {
  // DER BEFUND (Gegenprüfung zu PR #121): Der Wechsel änderte nur die Bild-ID.
  // Das Häkchen war aber für den Alt-Text des ALTEN Fotos gesetzt — stehen
  // geblieben, erschiene unter dem neuen Bild ein fremder Satz, den für dieses
  // Bild niemand freigegeben hat.
  await page.goto(`/admin/reisen/${travelId}`);
  const haken = page
    .locator(EINZELBILD)
    .getByRole("checkbox", { name: d.blockBildunterschrift });
  await expect(haken).toBeChecked();

  await page
    .locator(EINZELBILD)
    .getByRole("button", { name: ip.change, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: new RegExp(ip.title) });
  await expect(dialog).toBeVisible();
  await dialog.locator("button[aria-pressed]").nth(2).click();
  await expect(dialog).toBeHidden();

  // Das neue Foto HAT einen Alt-Text — sonst wäre das Häkchen ohnehin
  // gesperrt und die Messung sagte nichts.
  await expect(haken).toBeEnabled();
  await expect(haken).not.toBeChecked();

  // Und es bleibt aus, auch nach dem Speichern.
  await speichern(page);
  await page.goto(`/admin/reisen/${travelId}`);
  await expect(
    page.locator(EINZELBILD).getByRole("checkbox", { name: d.blockBildunterschrift }),
  ).not.toBeChecked();
});

test("dasselbe Foto zweimal in einer Gruppe: das Entfernen trifft die STELLE", async ({
  page,
}) => {
  // DER BEFUND (Gegenprüfung, zweite Runde): Über den Archiv-Import kann
  // dasselbe Foto zweimal in EINER Gruppe stehen. Der Bilderwähler meldete
  // seine Änderung als reine ID-Liste — und aus [7, 7] wird beim Entfernen der
  // ERSTEN Kachel dieselbe Liste [7] wie beim Entfernen der zweiten. Die
  // Unterschrift des GELÖSCHTEN Fotos landete damit am überlebenden: eine
  // sichtbare Bildunterschrift ohne eigenes Opt-in.
  //
  // Der Zustand ist über die Oberfläche nicht herzustellen (die Bibliothek
  // schaltet je Foto um), also wird er hier so angelegt, wie ein Import ihn
  // anlegen würde: direkt in der Datenbank.
  const db = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
  const bloecke = db
    .prepare(
      "SELECT id, image_id FROM travel_block WHERE travel_post_id = ? AND gruppe IS NOT NULL ORDER BY sort_order",
    )
    .all(travelId) as Array<{ id: number; image_id: number }>;
  expect(bloecke.length).toBeGreaterThanOrEqual(2);
  // Zweites Bild auf DASSELBE Foto wie das erste — beide in derselben Gruppe.
  // Das erste trägt eine Unterschrift, das zweite nicht.
  db.prepare("UPDATE travel_block SET image_id = ?, bildunterschrift = 0 WHERE id = ?")
    .run(bloecke[0].image_id, bloecke[1].id);
  db.prepare("UPDATE travel_block SET bildunterschrift = 1 WHERE id = ?").run(bloecke[0].id);
  // Alles Weitere aus der Gruppe heraus, damit die Stellen eindeutig sind.
  for (const b of bloecke.slice(2)) {
    db.prepare("DELETE FROM travel_block WHERE id = ?").run(b.id);
  }
  db.close();

  await page.goto(`/admin/reisen/${travelId}`);
  const haken = page.locator(GRUPPE).getByRole("checkbox", {
    name: d.blockBildunterschrift,
  });
  await expect(haken).toHaveCount(2);
  await expect(haken.nth(0)).toBeChecked();
  await expect(haken.nth(1)).not.toBeChecked();

  // Die ERSTE Kachel entfernen — die mit der Unterschrift.
  await page.locator(GRUPPE).getByRole("button", { name: ip.remove }).first().click();

  const uebrig = page.locator(GRUPPE).getByRole("checkbox", {
    name: d.blockBildunterschrift,
  });
  await expect(uebrig).toHaveCount(1);
  // Übrig ist die ZWEITE Stelle — ohne Unterschrift.
  await expect(uebrig).not.toBeChecked();

  await speichern(page);
  const nachher = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
  const rest = nachher
    .prepare(
      "SELECT bildunterschrift FROM travel_block WHERE travel_post_id = ? AND gruppe IS NOT NULL",
    )
    .all(travelId) as Array<{ bildunterschrift: number }>;
  nachher.close();
  expect(rest).toHaveLength(1);
  expect(rest[0].bildunterschrift).toBe(0);
});

test("gesetzt, aber ohne Alt-Text: sichtbar UND abschaltbar", async ({ page }) => {
  // DER BEFUND (Gegenprüfung, dritte Runde): Das Häkchen zeigte „aus", während
  // „an" gespeichert blieb — und war dabei gesperrt, also nicht widerrufbar.
  // Erreichbar ist der Zustand über die Medienverwaltung (Alt-Text
  // nachträglich geleert) und über den Archiv-Import. Trägt später jemand
  // wieder einen Alt-Text ein, erscheint die Unterschrift auf der
  // öffentlichen Seite, ohne dass sie je jemand dafür eingeschaltet hätte.
  //
  // Hier wird genau das hergestellt: gesetzte Angabe, Alt-Text geleert.
  // Eine EIGENE Gruppe für diesen Fall, statt auf den Rest der vorigen Tests
  // zu bauen: Was die hinterlassen, ist ihre Sache, nicht die Voraussetzung
  // dieser Messung.
  await page.goto(`/admin/reisen/${travelId}`);
  await page.getByRole("button", { name: `+ ${d.blockBildgruppe}`, exact: true }).click();
  const neueGruppe = page.locator(GRUPPE).last();
  await neueGruppe.getByRole("button", { name: ip.chooseMultiple }).click();
  const bibliothek = page.getByRole("dialog");
  await expect(bibliothek).toBeVisible();
  await bibliothek.locator("button[aria-pressed]").nth(2).click();
  await bibliothek.getByRole("button", { name: ip.close, exact: true }).click();
  await expect(bibliothek).toBeHidden();
  await speichern(page);

  const db = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
  const block = db
    .prepare(
      "SELECT id, image_id FROM travel_block WHERE travel_post_id = ? AND gruppe IS NOT NULL ORDER BY sort_order DESC LIMIT 1",
    )
    .get(travelId) as { id: number; image_id: number };
  expect(block).toBeDefined();
  const alterText = (
    db.prepare("SELECT alt_text FROM media_image WHERE id = ?").get(block.image_id) as {
      alt_text: string;
    }
  ).alt_text;
  db.prepare("UPDATE travel_block SET bildunterschrift = 1 WHERE id = ?").run(block.id);
  db.prepare("UPDATE media_image SET alt_text = '' WHERE id = ?").run(block.image_id);
  db.close();

  try {
    await page.goto(`/admin/reisen/${travelId}`);
    const haken = page
      .locator(GRUPPE)
      .last()
      .getByRole("checkbox", { name: d.blockBildunterschrift })
      .first();

    // Was dasteht, ist der gespeicherte Zustand — nicht „aus".
    await expect(haken).toBeChecked();
    // Und es lässt sich abschalten. Gesperrt ist nur das EINSCHALTEN ohne
    // Alt-Text; ein Häkchen, das man nicht mehr wegbekommt, wäre die andere
    // Hälfte desselben Fehlers.
    await expect(haken).toBeEnabled();
    await haken.uncheck();
    await expect(haken).not.toBeChecked();
    // Jetzt ist es aus UND ohne Alt-Text — also gesperrt, wie es sein soll.
    await expect(haken).toBeDisabled();

    await speichern(page);
    // Nach der Stelle fragen, nicht nach der Zeilen-ID: Das Speichern legt die
    // Blöcke neu an, die alte ID gibt es danach nicht mehr.
    const nachher = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
    const rest = nachher
      .prepare(
        "SELECT bildunterschrift FROM travel_block WHERE travel_post_id = ? AND gruppe IS NOT NULL ORDER BY sort_order DESC LIMIT 1",
      )
      .get(travelId) as { bildunterschrift: number } | undefined;
    nachher.close();
    expect(rest?.bildunterschrift).toBe(0);
  } finally {
    const zurueck = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
    zurueck
      .prepare("UPDATE media_image SET alt_text = ? WHERE id = ?")
      .run(alterText, block.image_id);
    zurueck.close();
  }
});

/** Aufräumen (B8): Der angelegte Bericht verschwindet wieder. */
test.afterAll(() => {
  if (travelId === null) return;
  const db = new Database(path.resolve(process.cwd(), ".pw-data/app.db"));
  db.prepare("DELETE FROM travel_post WHERE id = ?").run(travelId);
  db.close();
});
