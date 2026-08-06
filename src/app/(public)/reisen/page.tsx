import type { Metadata } from "next";
import { TravelMap } from "@/components/travel-map";
import { TravelPostCard } from "@/components/travel-post-card";
import { getTravelMapPins } from "@/lib/travel-map";
import { publishedTravelCards } from "@/lib/travel";
import { getReisenTexte } from "@/lib/settings";
import { renderMarkdown } from "@/lib/markdown";
import { t } from "@/i18n/de";
import { PageTracker } from "@/components/page-tracker";

const dict = t();
const d = dict.travelList;

export const metadata: Metadata = {
  title: d.title,
  description: d.intro,
  alternates: { canonical: "/reisen" },
};

export const dynamic = "force-dynamic";

export default async function TravelListPage() {
  const mapPins = await getTravelMapPins();
  const posts = await publishedTravelCards();
  // Im Admin (Reiseberichte) bearbeitbare Seitentexte: oben = vor der
  // Weltkarte (leer → Standard-Einleitung), unten = nach der Weltkarte.
  const texte = getReisenTexte();

  return (
    <main>
      <PageTracker contentType="seite" path="/reisen" />
      <h1 className="font-display text-3xl font-bold md:text-4xl">{d.title}</h1>
      {texte.oben ? (
        <div
          className="prose-content mt-2 max-w-2xl text-ink-soft"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(texte.oben) }}
        />
      ) : (
        <p className="mt-2 max-w-2xl text-ink-soft">{d.intro}</p>
      )}

      {/* Weltkarte der Restaurant-Standorte (aus den Gericht-Foto-GPS-Daten) */}
      <TravelMap pins={mapPins} />

      {texte.unten && (
        <div
          className="prose-content mt-6 max-w-2xl text-ink-soft"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(texte.unten) }}
        />
      )}

      {posts.length === 0 ? (
        <p className="mt-8 text-ink-soft">{d.empty}</p>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {posts.map((p) => (
            <TravelPostCard key={p.slug} post={p} />
          ))}
        </div>
      )}
    </main>
  );
}
