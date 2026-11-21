import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { buildEditorProps, erlaubteVerweise } from "../editor-data";
import { RecipeEditor } from "../recipe-editor";
import { meldungAus } from "@/components/admin/meldung";
import { editorAusDaten, schluesselFuerRezept } from "@/lib/recipe-zwischenstand";
import { zwischenstandLaden } from "@/lib/recipe-zwischenstand-store";
import { alsZeitpunkt } from "@/lib/zeitpunkt";

const dict = t();

export const metadata: Metadata = { title: dict.admin.recipes.editRecipe };

export default async function EditRecipePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const searchParams = await props.searchParams;
  const recipeId = Number(id);
  if (!Number.isInteger(recipeId)) notFound();

  const editorProps = await buildEditorProps(recipeId);
  if (!editorProps) notFound();

  const message = meldungAus(searchParams);

  // `?zwischenstand=1` legt den Zwischenstand des Rezepts in den Editor; ohne
  // den Parameter steht dort das gespeicherte Rezept. Gespeichert wird dabei
  // nichts: Das tut erst der Redakteur. Die Ablage liefert nur, was sich laden
  // lässt (`ladbareDatenAus`, dieselbe Regel wie `editorAusDaten`); der Typ
  // weiß das nicht, deshalb gilt auch hier: nicht übersetzbar heißt nicht
  // wiederhergestellt. Nach dem Alter der Zeile fragt niemand: Speichern
  // räumt sie ab, also ist jede Zeile nach dem letzten Speichern entstanden.
  const verlangt = searchParams.zwischenstand === "1";
  const zwischenstand = verlangt ? await zwischenstandLaden(schluesselFuerRezept(recipeId)) : null;
  const wiederhergestellt =
    zwischenstand && editorAusDaten(zwischenstand.daten, editorProps.initial, erlaubteVerweise(editorProps));

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {dict.admin.recipes.editRecipe}: {editorProps.initial.title}
      </h1>
      {/* Der Editor liest Anfangswerte und Hinweis nur beim Einhängen. Ein
          Neu-Rendern unter derselben Adresse (Speichern mit Fehler) lässt ihn
          deshalb stehen, auch wenn die Zeile inzwischen fehlt und `initial`
          wieder das gespeicherte Rezept ist. Nach erfolgreichem Speichern
          hängt die Umleitung die Seite neu ein: Erst das beendet den Hinweis.
          Beides gemessen in tests/e2e/rezept-zwischenstand.spec.ts.
          Überschrift und Adresse der öffentlichen Seite kommen aus
          `editorProps` und bleiben die des gespeicherten Rezepts.
          War Wiederherstellen verlangt und liegt nichts vor, sagt die Seite
          es (`zwischenstandFehlt`), statt still das gespeicherte Rezept zu
          zeigen. Sie leitet dafür NICHT um: Nach einem Speichern mit Fehler
          rendert dieselbe Seite neu, und eine Umleitung verließe dann den
          Editor samt Getipptem. */}
      <RecipeEditor
        {...editorProps}
        initial={wiederhergestellt?.initial ?? editorProps.initial}
        taxonomiePending={wiederhergestellt?.taxonomiePending}
        zwischenstandWiederhergestellt={
          zwischenstand && wiederhergestellt
            ? { zeit: alsZeitpunkt(zwischenstand.gesichertAm), stand: zwischenstand.stand }
            : undefined
        }
        zwischenstandFehlt={verlangt && !wiederhergestellt}
        message={message}
      />
    </>
  );
}
