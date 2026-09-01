/**
 * Daten für die aufklappbaren Hauptmenü-Einträge:
 * - Rezepte → Kategorien („Art des Gerichts", z. B. Hauptgericht), die
 *   mindestens ein veröffentlichtes Rezept haben, alphabetisch.
 * - Reisen → veröffentlichte Reiseberichte, neueste zuerst.
 * - Ernährung → Ernährungsformen (mit ihren Formen) und Saisonkalender.
 * Alles serverseitig geladen und ans SiteHeader durchgereicht.
 */
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { NavChild } from "@/components/site-header";
import { taxonomienMitRezepten } from "@/lib/taxonomies";
import {
  ERNAEHRUNGSFORMEN_PFAD,
  ERNAEHRUNGSFORMEN_SLUG,
  ernaehrungsformPfad,
} from "@/lib/ernaehrung";
import { VEROEFFENTLICHT } from "@/db/schema";
import { t } from "@/i18n/de";

const dict = t();

export async function getNavMenus(): Promise<{
  recipeChildren: NavChild[];
  travelChildren: NavChild[];
  nutritionChildren: NavChild[];
}> {
  const [kategorien, formen, travelRows, seitenZeile] = await Promise.all([
    taxonomienMitRezepten("kategorie"),
    taxonomienMitRezepten("ernaehrungsform"),
    db
      .select({
        title: schema.travelPost.title,
        slug: schema.travelPost.slug,
      })
      .from(schema.travelPost)
      .where(eq(schema.travelPost.status, VEROEFFENTLICHT))
      .orderBy(desc(schema.travelPost.publishedAt))
      .limit(20),
    // Die Übersichtsseite selbst. Ihr Titel steht im Menü, damit eine
    // Umbenennung im Admin dort ankommt statt zu einem zweiten, abweichenden
    // Namen zu führen.
    db
      .select({ title: schema.page.title, status: schema.page.status })
      .from(schema.page)
      .where(eq(schema.page.slug, ERNAEHRUNGSFORMEN_SLUG))
      .limit(1),
  ]);

  const recipeChildren: NavChild[] = kategorien.map((c) => ({
    href: `/rezepte/kategorie/${encodeURIComponent(c.slug)}`,
    label: c.name,
  }));

  const travelChildren: NavChild[] = travelRows.map((tp) => ({
    href: `/reisen/${tp.slug}`,
    label: tp.title,
  }));

  /**
   * „Ernährungsformen" erscheint nur, wenn die Seite dahinter VERÖFFENTLICHT
   * ist — sonst zeigte das Hauptmenü jeder Seite auf einen 404.
   *
   * Bewusst OHNE Rücksicht auf die Sitzung: Die Navigation ist ein Nebenweg
   * und bleibt bei Veröffentlichtem, auch für den angemeldeten Admin
   * (CLAUDE.md, „Maschinen und Nebenwege"). Mit den Ernährungsformen fallen
   * dann auch ihre Unterpunkte weg — sie sind Kinder dieses Eintrags, und
   * ohne ihn hätten sie im Menü keinen Platz.
   */
  const seite = seitenZeile[0];
  const ernaehrungsformenEintrag: NavChild[] =
    seite && seite.status === VEROEFFENTLICHT
      ? [
          {
            href: ERNAEHRUNGSFORMEN_PFAD,
            label: seite.title || dict.nav.dietForms,
            children: formen.map((f) => ({
              href: ernaehrungsformPfad(f.slug),
              label: f.name,
            })),
          },
        ]
      : [];

  const nutritionChildren: NavChild[] = [
    ...ernaehrungsformenEintrag,
    { href: "/saisonkalender", label: dict.nav.seasonCalendar },
  ];

  return { recipeChildren, travelChildren, nutritionChildren };
}
