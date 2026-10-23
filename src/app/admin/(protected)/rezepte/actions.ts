"use server";

import { redirect } from "next/navigation";
import { getCurrentAdmin, requireAdmin } from "@/lib/auth";
import { deleteRecipeById, saveRecipeFromForm } from "@/lib/recipe-save";
import {
  STAND_FELD,
  formularAlsDaten,
  istNeuSchluessel,
  schluesselAus,
} from "@/lib/recipe-zwischenstand";
import { zwischenstandSichern, zwischenstandVerwerfen } from "@/lib/recipe-zwischenstand-store";
import { sichererRueckweg } from "@/lib/sitzung";
import { alsUhrzeit } from "@/lib/zeitpunkt";
import { t } from "@/i18n/de";

const dict = t();

export interface RecipeFormState {
  error?: string;
}

export async function saveRecipeAction(
  _prev: RecipeFormState,
  formData: FormData,
): Promise<RecipeFormState> {
  const admin = await requireAdmin();
  let result: Awaited<ReturnType<typeof saveRecipeFromForm>>;
  try {
    result = await saveRecipeFromForm(formData, admin.id);
  } catch (err) {
    // Ein unerwarteter Laufzeitfehler (z. B. schreibgeschützte/gesperrte DB) darf
    // NIEMALS still verschluckt werden — sonst wirkt es für den Nutzer, als würde
    // „nichts gespeichert", ohne jeden Hinweis. Sichtbar melden statt werfen.
    console.error("[saveRecipeAction] Speichern fehlgeschlagen:", err);
    return { error: dict.admin.recipes.saveFailed };
  }
  if ("error" in result) return { error: result.error };
  // redirect() wirft NEXT_REDIRECT — daher bewusst AUSSERHALB des try/catch.
  redirect(
    `/admin/rezepte/${result.recipeId}?meldung=${encodeURIComponent(dict.admin.recipes.saved)}`,
  );
}

export async function deleteRecipeAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (Number.isInteger(id)) {
    await deleteRecipeById(id);
  }
  redirect(
    `/admin/rezepte?meldung=${encodeURIComponent(dict.admin.recipes.deleted)}`,
  );
}

/**
 * Antwort der Sicherung — KEINE Navigation, der Editor zeigt sie an.
 * `stand` ist der Zeitpunkt der Zeile in ms; der Editor schickt ihn beim
 * nächsten Mal als „bekannten Stand" mit (Schutz vor zwei Tabs).
 */
export type ZwischenstandAntwort =
  | { gesichert: string; stand: number }
  | { fehler: "sitzung" }
  | { fehler: "fremd"; zeit: string; stand: number }
  | { fehler: "ungueltig" };

/**
 * Der Zwischenstand aus dem Editor, alle drei Minuten. Bewusst
 * `getCurrentAdmin` statt `requireAdmin`: Letzteres leitet zum Login um, und
 * aus einem Timer heraus hieße das, der Browser verlässt den Editor samt
 * Inhalt. Eine abgelaufene Sitzung ist hier eine Antwort, kein Redirect.
 * Die Anfrage läuft unter /admin durch den Proxy — das Cookie gleitet mit.
 */
export async function zwischenstandSichernAction(formData: FormData): Promise<ZwischenstandAntwort> {
  const admin = await getCurrentAdmin("admin-anfrage");
  if (!admin) return { fehler: "sitzung" };
  const daten = formularAlsDaten(formData);
  const schluessel = schluesselAus(daten);
  if (!schluessel) return { fehler: "ungueltig" };
  // Der bekannte Stand ist Steuerinformation des Editors, kein Formularfeld —
  // er gehört nicht in den Zwischenstand (sonst änderte jede Sicherung den
  // Fingerabdruck und die nächste käme ohne Änderung).
  const { [STAND_FELD]: standRoh, ...formular } = daten;
  const bekannterStand = Number(standRoh?.[0] ?? 0) || 0;
  const recipeId = schluessel.startsWith("rezept:") ? Number(schluessel.slice("rezept:".length)) : null;
  let ergebnis: Awaited<ReturnType<typeof zwischenstandSichern>>;
  try {
    ergebnis = await zwischenstandSichern({
      schluessel,
      recipeId,
      daten: formular,
      jetzt: new Date(),
      bekannterStand,
    });
  } catch (err) {
    // Z. B. ein Rezept, das es nicht (mehr) gibt — der Fremdschlüssel sagt
    // nein. Sichtbar melden, nicht werfen: Der Editor soll stehen bleiben.
    console.error("[zwischenstandSichernAction] Sichern fehlgeschlagen:", err);
    return { fehler: "ungueltig" };
  }
  if (ergebnis.ergebnis === "fremd") {
    return {
      fehler: "fremd",
      zeit: alsUhrzeit(ergebnis.gespeichertAm),
      stand: ergebnis.gespeichertAm.getTime(),
    };
  }
  return { gesichert: alsUhrzeit(ergebnis.gespeichertAm), stand: ergebnis.gespeichertAm.getTime() };
}

/** „Verwerfen" im Hinweis: löscht die Zeile und kehrt auf die Seite zurück, von der es kam. */
export async function zwischenstandVerwerfenAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const schluessel = String(formData.get("schluessel") ?? "");
  if (istNeuSchluessel(schluessel) || /^rezept:[1-9]\d*$/.test(schluessel)) {
    await zwischenstandVerwerfen(schluessel);
  }
  // Der Rückweg ist Nutzereingabe aus einem versteckten Feld — dieselbe
  // Prüfung wie beim Login: nur in den Admin, nur kanonisch.
  const zurueck = sichererRueckweg(formData.get("zurueck")) ?? "/admin/rezepte";
  redirect(`${zurueck}?meldung=${encodeURIComponent(dict.admin.recipes.zwischenstandVerworfen)}`);
}
