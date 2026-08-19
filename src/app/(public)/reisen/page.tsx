import type { Metadata } from "next";
import { TravelMap } from "@/components/travel-map";
import { TravelPostCard } from "@/components/travel-post-card";
import { getTravelMapPins } from "@/lib/travel-map";
import { publishedTravelCards } from "@/lib/travel";
import { getReisenTextUnten } from "@/lib/settings";
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
  // Im Admin (Reiseberichte) bearbeitbarer Seitentext zwischen Weltkarte und
  // Reiseliste. Über der Karte steht der feste Einleitungssatz — kein Textfeld.
  const textUnten = getReisenTextUnten();

  return (
    <main>
      <PageTracker contentType="seite" path="/reisen" />
      <h1 className="font-display text-3xl font-bold md:text-4xl">{d.title}</h1>

      {/* Einleitung unter der Überschrift: bewusst schmal (max-w-2xl) — hier
          liest sich eine Zeilenlänge um 65 Zeichen besser als die volle Breite. */}
      <p className="mt-2 max-w-2xl text-ink-soft">{d.intro}</p>

      {/* Weltkarte der Restaurant-Standorte (aus den Gericht-Foto-GPS-Daten) */}
      <TravelMap pins={mapPins} />

      {/* Bewusst OHNE max-w-2xl: Der Text unter der Weltkarte läuft über die
          volle Inhaltsbreite (abgestimmt). */}
      {textUnten && (
        <div
          className="prose-content mt-6 text-ink-soft"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(textUnten) }}
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
