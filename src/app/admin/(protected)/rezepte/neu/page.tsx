import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { buildEditorProps, erlaubteVerweise } from "../editor-data";
import { RecipeEditor } from "../recipe-editor";
import { meldungAus } from "@/components/admin/meldung";
import { editorAusDaten, istNeuSchluessel } from "@/lib/recipe-zwischenstand";
import { offeneNeueZwischenstaende, zwischenstandLaden } from "@/lib/recipe-zwischenstand-store";
import { alsUhrzeit } from "@/lib/zeitpunkt";

const dict = t();
const PFAD = "/admin/rezepte/neu";

export const metadata: Metadata = { title: dict.admin.recipes.newRecipe };

export default async function NewRecipePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const basis = (await buildEditorProps(null))!;

  // Ein neues Rezept hat vor dem ersten Speichern keine Nummer. Den Schlüssel
  // seines Zwischenstands vergibt der EDITOR im Browser (nicht diese Seite:
  // sie rendert nach jeder Action neu und würfelte jedes Mal neu). Nur ein
  // fortgesetztes Rezept (`?zwischenstand=neu:…`) bringt seinen Schlüssel mit,
  // damit weitere Sicherungen dieselbe Zeile treffen.
  const gewuenscht = searchParams.zwischenstand;
  const fortgesetzt = istNeuSchluessel(gewuenscht) ? await zwischenstandLaden(gewuenscht) : null;
  const wieder = fortgesetzt
    ? editorAusDaten(fortgesetzt.daten, basis.initial, erlaubteVerweise(basis))
    : null;
  const offene = (await offeneNeueZwischenstaende()).map((z) => ({
    schluessel: z.schluessel,
    titel: z.titel,
    zeit: alsUhrzeit(z.gespeichertAm),
    zurueck: PFAD,
    wiederherstellen: `${PFAD}?zwischenstand=${encodeURIComponent(z.schluessel)}`,
  }));

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{dict.admin.recipes.newRecipe}</h1>
      {/* `key` je Zustand: Nach „Verwerfen" (weiche Umleitung) wird der Editor
          neu aufgebaut statt den verworfenen Inhalt zu behalten. */}
      {fortgesetzt && wieder ? (
        <RecipeEditor
          key={fortgesetzt.schluessel}
          {...basis}
          initial={wieder.initial}
          taxonomiePending={wieder.taxonomiePending}
          zwischenstandSchluessel={fortgesetzt.schluessel}
          zwischenstandStand={fortgesetzt.gespeichertAm.getTime()}
          zwischenstandWiederhergestellt={{
            zeit: alsUhrzeit(fortgesetzt.gespeichertAm),
            schluessel: fortgesetzt.schluessel,
            zurueck: PFAD,
          }}
          offeneZwischenstaende={offene}
          message={meldungAus(searchParams)}
        />
      ) : (
        <RecipeEditor key="neu" {...basis} offeneZwischenstaende={offene} message={meldungAus(searchParams)} />
      )}
    </>
  );
}
