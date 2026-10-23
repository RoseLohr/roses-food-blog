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
  // Die IDENTITÄT des Editors (`key`) hängt allein an der Adresse, nicht an
  // der Zeile — siehe [id]/page.tsx: Nach einer Action rendert die Seite neu,
  // und eine inzwischen fehlende Zeile darf den Editor nicht neu aufbauen.
  const gewuenscht = searchParams.zwischenstand;
  const schluessel = istNeuSchluessel(gewuenscht) ? gewuenscht : null;
  const fortgesetzt = schluessel ? await zwischenstandLaden(schluessel) : null;
  const wieder = fortgesetzt
    ? editorAusDaten(fortgesetzt.daten, basis.initial, erlaubteVerweise(basis))
    : null;
  // Die Liste begonnener Rezepte ist kein Angebot für DIESEN Editor (andere
  // Schlüssel); er sichert daneben normal. Verwirft der Redakteur einen
  // Eintrag, nimmt der Editor ihn aus der Liste, ohne die Seite zu verlassen.
  const offene = (await offeneNeueZwischenstaende()).map((z) => ({
    schluessel: z.schluessel,
    titel: z.titel,
    zeit: alsUhrzeit(z.gespeichertAm),
    wiederherstellen: `${PFAD}?zwischenstand=${encodeURIComponent(z.schluessel)}`,
  }));

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{dict.admin.recipes.newRecipe}</h1>
      {/* `key` je Adresse: Verwirft der Editor den FORTGESETZTEN Stand, wechselt
          er auf die Adresse ohne `?zwischenstand=`, und der Editor wird leer neu
          aufgebaut statt den verworfenen Inhalt zu behalten. Fehlt die Zeile
          zur Adresse, arbeitet der Editor unter demselben Schlüssel weiter. */}
      <RecipeEditor
        key={schluessel ?? "neu"}
        {...basis}
        initial={wieder?.initial ?? basis.initial}
        taxonomiePending={wieder?.taxonomiePending}
        zwischenstandSchluessel={schluessel ?? undefined}
        zwischenstandStand={fortgesetzt && wieder ? fortgesetzt.gespeichertAm.getTime() : 0}
        zwischenstandWiederhergestellt={
          fortgesetzt && wieder
            ? { zeit: alsUhrzeit(fortgesetzt.gespeichertAm), schluessel: fortgesetzt.schluessel, zurueck: PFAD }
            : undefined
        }
        offeneZwischenstaende={offene}
        message={meldungAus(searchParams)}
      />
    </>
  );
}
