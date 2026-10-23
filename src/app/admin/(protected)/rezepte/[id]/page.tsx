import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { buildEditorProps, erlaubteVerweise, rezeptGespeichertAm } from "../editor-data";
import { RecipeEditor } from "../recipe-editor";
import { ZwischenstandHinweis } from "../zwischenstand-hinweis";
import { meldungAus } from "@/components/admin/meldung";
import { editorAusDaten, nichtAelterAls, schluesselFuerRezept } from "@/lib/recipe-zwischenstand";
import { zwischenstandLaden } from "@/lib/recipe-zwischenstand-store";
import { alsUhrzeit } from "@/lib/zeitpunkt";

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
  const pfad = `/admin/rezepte/${recipeId}`;

  // Liegt ein Zwischenstand, der nicht älter ist als das gespeicherte Rezept,
  // wird er angeboten — oder, mit `?zwischenstand=1`, in den Editor gelegt.
  // Was sich nicht in Anfangswerte übersetzen lässt, wird nicht angeboten.
  const schluessel = schluesselFuerRezept(recipeId);
  const zwischenstand = await zwischenstandLaden(schluessel);
  const angeboten =
    zwischenstand && nichtAelterAls(zwischenstand.gespeichertAm, await rezeptGespeichertAm(recipeId))
      ? editorAusDaten(zwischenstand.daten, editorProps.initial, erlaubteVerweise(editorProps))
      : null;
  const wiederhergestellt = angeboten !== null && searchParams.zwischenstand === "1";
  const zeit = zwischenstand ? alsUhrzeit(zwischenstand.gespeichertAm) : "";

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {dict.admin.recipes.editRecipe}: {editorProps.initial.title}
      </h1>
      {angeboten && (
        <ZwischenstandHinweis
          zeit={zeit}
          schluessel={schluessel}
          zurueck={pfad}
          wiederherstellen={wiederhergestellt ? undefined : `${pfad}?zwischenstand=1`}
          live
        />
      )}
      {/* Der `key` wechselt mit dem Zustand: „Verwerfen" und „Speichern" leiten
          WEICH um, und React behielte sonst die Editor-Instanz samt State —
          der verworfene Inhalt stünde weiter im Formular. */}
      {wiederhergestellt ? (
        <RecipeEditor
          key={`zwischenstand-${zwischenstand!.gespeichertAm.getTime()}`}
          {...editorProps}
          initial={angeboten.initial}
          taxonomiePending={angeboten.taxonomiePending}
          zwischenstandStand={zwischenstand!.gespeichertAm.getTime()}
          message={message}
        />
      ) : (
        <RecipeEditor key="gespeichert" {...editorProps} message={message} />
      )}
    </>
  );
}
