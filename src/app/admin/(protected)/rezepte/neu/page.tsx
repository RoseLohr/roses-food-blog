import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { t } from "@/i18n/de";
import { buildEditorProps, erlaubteVerweise } from "../editor-data";
import { RecipeEditor } from "../recipe-editor";
import { ZwischenstandHinweis } from "../zwischenstand-hinweis";
import { meldungAus } from "@/components/admin/meldung";
import { editorAusDaten, istNeuSchluessel, schluesselFuerNeu } from "@/lib/recipe-zwischenstand";
import { offeneNeueZwischenstaende, zwischenstandLaden } from "@/lib/recipe-zwischenstand-store";
import { alsUhrzeit } from "@/lib/zeitpunkt";

const dict = t();
const d = dict.admin.recipes;
const PFAD = "/admin/rezepte/neu";

export const metadata: Metadata = { title: d.newRecipe };

export default async function NewRecipePage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const searchParams = await props.searchParams;
  const basis = (await buildEditorProps(null))!;

  // Ein neues Rezept hat vor dem ersten Speichern keine Nummer. Den Schlüssel
  // seines Zwischenstands vergibt deshalb der Server beim Rendern; der Editor
  // trägt ihn als verstecktes Feld, und das Speichern räumt ihn damit ab.
  // Wird ein begonnenes Rezept fortgesetzt (`?zwischenstand=neu:…`), bleibt
  // dessen Schlüssel, damit weitere Sicherungen dieselbe Zeile treffen.
  const gewuenscht = searchParams.zwischenstand;
  const fortgesetzt = istNeuSchluessel(gewuenscht) ? await zwischenstandLaden(gewuenscht) : null;
  const wieder = fortgesetzt
    ? editorAusDaten(fortgesetzt.daten, basis.initial, erlaubteVerweise(basis))
    : null;
  const schluessel = fortgesetzt && wieder ? fortgesetzt.schluessel : schluesselFuerNeu(crypto.randomUUID());

  const offene = (await offeneNeueZwischenstaende()).filter((z) => z.schluessel !== schluessel);

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">{d.newRecipe}</h1>
      {fortgesetzt && wieder && (
        <ZwischenstandHinweis
          zeit={alsUhrzeit(fortgesetzt.gespeichertAm)}
          schluessel={fortgesetzt.schluessel}
          zurueck={PFAD}
          live
        />
      )}
      {offene.length > 0 && (
        <section aria-label={d.zwischenstandUnvollendet} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-ink-soft">{d.zwischenstandUnvollendet}</h2>
          {offene.map((z) => (
            <ZwischenstandHinweis
              key={z.schluessel}
              zeit={alsUhrzeit(z.gespeichertAm)}
              schluessel={z.schluessel}
              zurueck={PFAD}
              wiederherstellen={`${PFAD}?zwischenstand=${encodeURIComponent(z.schluessel)}`}
              titel={z.titel}
            />
          ))}
        </section>
      )}
      {/* `key` = Schlüssel: Nach „Verwerfen" (weiche Umleitung) wird der Editor
          neu aufgebaut statt den verworfenen Inhalt zu behalten. */}
      {fortgesetzt && wieder ? (
        <RecipeEditor
          key={schluessel}
          {...basis}
          initial={wieder.initial}
          taxonomiePending={wieder.taxonomiePending}
          zwischenstandSchluessel={schluessel}
          zwischenstandStand={fortgesetzt.gespeichertAm.getTime()}
          message={meldungAus(searchParams)}
        />
      ) : (
        <RecipeEditor
          key={schluessel}
          {...basis}
          zwischenstandSchluessel={schluessel}
          message={meldungAus(searchParams)}
        />
      )}
    </>
  );
}
