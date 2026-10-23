import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { buildEditorProps, erlaubteVerweise, rezeptGespeichertAm } from "../editor-data";
import { RecipeEditor } from "../recipe-editor";
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
  //
  // Angeboten heißt NICHT übernommen: Den Stand der Zeile bekommt der Editor
  // nur, wenn er sie auch geladen hat (`zwischenstandStand`). Solange das
  // Angebot unentschieden ist, sichert der Editor nicht in diese Zeile — ein
  // Timer würde sonst drei Minuten nach dem Öffnen überschreiben, was dem
  // Redakteur gerade zur Entscheidung vorliegt. Bekäme er den Stand trotzdem,
  // hielte der Server die Zeile für seine eigene und ließe ihn.
  const schluessel = schluesselFuerRezept(recipeId);
  const zwischenstand = await zwischenstandLaden(schluessel);
  const angeboten =
    zwischenstand && nichtAelterAls(zwischenstand.gespeichertAm, await rezeptGespeichertAm(recipeId))
      ? editorAusDaten(zwischenstand.daten, editorProps.initial, erlaubteVerweise(editorProps))
      : null;
  const wiederhergestellt = angeboten !== null && searchParams.zwischenstand === "1";
  const stand = zwischenstand?.gespeichertAm.getTime() ?? 0;
  const hinweis = zwischenstand ? { zeit: alsUhrzeit(zwischenstand.gespeichertAm), schluessel } : null;

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {dict.admin.recipes.editRecipe}: {editorProps.initial.title}
      </h1>
      {/* Der `key` wechselt nur zwischen den ZUSTÄNDEN: Verwirft der Editor
          einen WIEDERHERGESTELLTEN Stand, wechselt er auf die Adresse ohne
          `?zwischenstand=1`, und React muss ihn mit dem gespeicherten Stand
          neu aufbauen statt die Instanz samt verworfenem Inhalt zu behalten.
          Innerhalb eines Zustands bleibt er stabil — ein Neu-Rendering (etwa
          nach Speichern mit Fehler) darf den Editor nicht neu aufbauen. */}
      <RecipeEditor
        key={wiederhergestellt ? "zwischenstand" : "gespeichert"}
        {...editorProps}
        initial={wiederhergestellt ? angeboten.initial : editorProps.initial}
        taxonomiePending={wiederhergestellt ? angeboten.taxonomiePending : undefined}
        zwischenstandStand={wiederhergestellt ? stand : 0}
        zwischenstandAngebot={
          angeboten && !wiederhergestellt && hinweis
            ? { ...hinweis, stand, wiederherstellen: `${pfad}?zwischenstand=1` }
            : undefined
        }
        zwischenstandWiederhergestellt={wiederhergestellt && hinweis ? { ...hinweis, zurueck: pfad } : undefined}
        message={message}
      />
    </>
  );
}
