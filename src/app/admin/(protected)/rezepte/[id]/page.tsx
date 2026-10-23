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
  // Der Editor friert Angebot und Stand beim Einhängen ein: Nach jeder Action
  // rendert diese Seite neu und sähe sonst den eben gesicherten Stand als
  // „Zwischenstand von …".
  const schluessel = schluesselFuerRezept(recipeId);
  const zwischenstand = await zwischenstandLaden(schluessel);
  const angeboten =
    zwischenstand && nichtAelterAls(zwischenstand.gespeichertAm, await rezeptGespeichertAm(recipeId))
      ? editorAusDaten(zwischenstand.daten, editorProps.initial, erlaubteVerweise(editorProps))
      : null;
  const wiederhergestellt = angeboten !== null && searchParams.zwischenstand === "1";
  const hinweis = zwischenstand
    ? { zeit: alsUhrzeit(zwischenstand.gespeichertAm), schluessel, zurueck: pfad }
    : null;

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">
        {dict.admin.recipes.editRecipe}: {editorProps.initial.title}
      </h1>
      {/* Der `key` wechselt nur zwischen den ZUSTÄNDEN: „Verwerfen" leitet weich
          um, und React behielte sonst die Editor-Instanz samt verworfenem
          Inhalt. Innerhalb eines Zustands bleibt er stabil — die Neu-Renderings
          nach jeder Sicherung dürfen den Editor nicht neu aufbauen. */}
      <RecipeEditor
        key={wiederhergestellt ? "zwischenstand" : "gespeichert"}
        {...editorProps}
        initial={wiederhergestellt ? angeboten.initial : editorProps.initial}
        taxonomiePending={wiederhergestellt ? angeboten.taxonomiePending : undefined}
        zwischenstandStand={zwischenstand?.gespeichertAm.getTime() ?? 0}
        zwischenstandAngebot={
          angeboten && !wiederhergestellt && hinweis
            ? { ...hinweis, wiederherstellen: `${pfad}?zwischenstand=1` }
            : undefined
        }
        zwischenstandWiederhergestellt={wiederhergestellt && hinweis ? hinweis : undefined}
        message={message}
      />
    </>
  );
}
