/**
 * Was der Reise-Editor ZEIGT — und wie es sich in die gespeicherte Blockfolge
 * übersetzt.
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────────
 *
 * Der Editor zeigte die Blockfolge so, wie sie in der Datenbank steht: EINE
 * Karte je Bild. Wer eine Gruppe aus fünf Fotos bauen wollte, legte fünf
 * Karten an und stellte an jeder einzeln dieselbe Zugehörigkeit ein („Gruppe
 * B"). Fünf Handgriffe für eine Aussage, die einmal gilt — und untereinander
 * fünf fast gleich aussehende Kästen, in denen man die Gruppe erst suchen
 * musste.
 *
 * Das ist kein Anzeigeproblem, sondern ein Modellproblem: Die Datenbank
 * speichert Bilder, der Redakteur denkt in GRUPPEN. Der Editor sprach die
 * Sprache der Tabelle statt die der Sache.
 *
 * ── DIE UMRECHNUNG ──────────────────────────────────────────────────────────
 *
 * Deshalb rechnet dieses Modul zwischen beiden Sprachen um:
 *
 *   `zuItems`    Blockfolge → Editor-Einträge. Ein ununterbrochener Lauf von
 *                Bildern mit derselben Marke wird EIN Gruppen-Eintrag.
 *   `zuBloecken` Editor-Einträge → Blockfolge. Jede Gruppe bekommt eine eigene
 *                Marke, jedes ihrer Bilder eine eigene Zeile.
 *
 * Die Gruppierung in `zuItems` ist ABSICHTLICH dieselbe Regel wie in
 * `zuRenderBloecken` (src/lib/bildreihen.ts): ein Lauf gleicher Marke. Damit
 * zeigt der Editor genau die Gruppen, die der Bericht später auch rendert —
 * und nicht eine zweite, eigene Lesart derselben Daten. Genau daran ist die
 * Vorgängerfassung zerbrochen.
 *
 * ── WAS DIESE UMRECHNUNG GARANTIERT ─────────────────────────────────────────
 *
 * `zuBloecken(zuItems(b))` ist nicht Feld für Feld dasselbe wie `b` — die
 * Marken werden neu durchgezählt. Es ist aber GLEICHWERTIG: Beide ergeben
 * unter `zuRenderBloecken` dieselben Renderblöcke. Nur das zählt, denn nur das
 * sieht der Leser. Ein Test nagelt genau diese Gleichung fest
 * (tests/travel-editor-items.test.ts), damit die neue Bedienung das Frontend
 * nachweislich unberührt lässt.
 *
 * Bewusst OHNE zod und ohne weitere Abhängigkeiten: Dieses Modul läuft im
 * Browser-Bündel des Reise-Editors mit, und dessen Routenbudget ist der
 * knappste Posten der Anwendung (scripts/regime/bundle-budget.mjs).
 */
import type { Ausrichtung, Bildgroesse } from "@/lib/bildreihen";
import { EINZELBILD_VORGABE } from "@/lib/bildreihen";
import type { TravelBlock } from "@/lib/travel-blocks";

/**
 * Ein Eintrag im Editor — das, was als EINE Karte erscheint.
 *
 * Der Unterschied zur Blockfolge ist allein die Bildgruppe: Sie ist hier EIN
 * Eintrag mit mehreren Bildern, dort mehrere Zeilen mit derselben Marke.
 */
export type EditorItem =
  | { art: "text"; markdown: string }
  /** Ein Bild, um das der Text herumläuft — mit eigener Größe und Seite. */
  | {
      art: "einzelbild";
      /** 0 = noch kein Foto gewählt. */
      imageId: number;
      groesse: Bildgroesse;
      ausrichtung: Ausrichtung;
    }
  /**
   * Eine Bildgruppe: das erste Bild über die ganze Breite, alle weiteren in
   * einer Reihe darunter. Die REIHENFOLGE ist die ganze Einstellung — mehr
   * gibt es an einer Gruppe nicht zu entscheiden.
   */
  | { art: "bildgruppe"; imageIds: number[] }
  | { art: "restaurant"; index: number };

/** Die Karte einer Bildgruppe — die einzige Art mit mehreren Fotos. */
export type Bildgruppe = Extract<EditorItem, { art: "bildgruppe" }>;

/** Eine leere Gruppe, wie sie der Knopf „+ Bildgruppe" anlegt. */
export function neueBildgruppe(): EditorItem {
  return { art: "bildgruppe", imageIds: [] };
}

/** Ein neues Einzelbild mit den Vorgaben. */
export function neuesEinzelbild(): EditorItem {
  return {
    art: "einzelbild",
    imageId: 0,
    groesse: EINZELBILD_VORGABE.groesse,
    ausrichtung: EINZELBILD_VORGABE.ausrichtung,
  };
}

/**
 * Blockfolge → Editor-Einträge.
 *
 * Ein ununterbrochener Lauf von Bildern mit DERSELBEN Marke wird ein
 * Gruppen-Eintrag. Ein Text-, Restaurant- oder Einzelbild-Block beendet den
 * Lauf, ebenso ein Wechsel der Marke — Wort für Wort die Regel aus
 * `zuRenderBloecken`.
 */
export function zuItems(blocks: TravelBlock[]): EditorItem[] {
  const items: EditorItem[] = [];
  /**
   * Der Lauf, der gerade offen ist — Marke UND Karte in EINER Angabe.
   *
   * Bewusst nicht „Marke hier, letzte Karte über `items[items.length - 1]`":
   * Das wären zwei Buchführungen über denselben Sachverhalt, und die dürfen
   * dann auch auseinanderlaufen. Hier gibt es nichts zu vergleichen — ist ein
   * Lauf offen, steht seine Karte daneben; ist keiner offen, ist alles `null`.
   */
  let offen: { marke: number; karte: Bildgruppe } | null = null;

  for (const b of blocks) {
    if (b.type === "text") {
      items.push({ art: "text", markdown: b.markdown });
      offen = null;
    } else if (b.type === "restaurant") {
      items.push({ art: "restaurant", index: b.index });
      offen = null;
    } else if (b.gruppe === null) {
      items.push({
        art: "einzelbild",
        imageId: b.imageId,
        groesse: b.groesse ?? EINZELBILD_VORGABE.groesse,
        ausrichtung: b.ausrichtung ?? EINZELBILD_VORGABE.ausrichtung,
      });
      offen = null;
    } else if (offen !== null && offen.marke === b.gruppe) {
      offen.karte.imageIds.push(b.imageId);
    } else {
      const karte: Bildgruppe = { art: "bildgruppe", imageIds: [b.imageId] };
      items.push(karte);
      offen = { marke: b.gruppe, karte };
    }
  }
  return items;
}

/**
 * Editor-Einträge → Blockfolge.
 *
 * Jede Gruppe bekommt eine EIGENE, fortlaufende Marke. Das ist keine
 * Kosmetik: Zwei Gruppen dürfen niemals dieselbe Marke tragen, sonst zöge
 * `zuRenderBloecken` sie zu einer zusammen, sobald sie nebeneinander stehen.
 * Ein Zähler kann das nicht falsch machen — eine übernommene Altmarke schon.
 *
 * Bilder ohne Foto (`imageId <= 0`) fallen heraus: Sie werden ohnehin nicht
 * gespeichert, und eine leere Zeile in der Mitte einer Gruppe wäre eine Lücke,
 * die niemand bestellt hat.
 */
export function zuBloecken(items: EditorItem[]): TravelBlock[] {
  const blocks: TravelBlock[] = [];
  let marke = 0;

  for (const item of items) {
    if (item.art === "text") {
      blocks.push({ type: "text", markdown: item.markdown });
    } else if (item.art === "restaurant") {
      blocks.push({ type: "restaurant", index: item.index });
    } else if (item.art === "einzelbild") {
      blocks.push({
        type: "bild",
        imageId: item.imageId,
        gruppe: null,
        groesse: item.groesse,
        ausrichtung: item.ausrichtung,
      });
    } else {
      const bilder = item.imageIds.filter((id) => id > 0);
      if (bilder.length === 0) continue;
      marke += 1;
      for (const imageId of bilder) {
        blocks.push({
          type: "bild",
          imageId,
          gruppe: marke,
          // In einer Gruppe bestimmt die Position die Anordnung. Eine Größe
          // daneben wäre eine zweite, unwirksame Wahrheit — Vertrag und
          // Datenbank weisen sie zurück (travel_block_bild_regler_check).
          groesse: null,
          ausrichtung: null,
        });
      }
    }
  }
  return blocks;
}
