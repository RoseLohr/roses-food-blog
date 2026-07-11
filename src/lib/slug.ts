/**
 * URL-Slugs: Kleinbuchstaben, deutsche Umlaute transliteriert,
 * sonstige Diakritika entfernt, alles andere zu Bindestrichen.
 */
const UMLAUTS: Record<string, string> = {
  ä: "ae",
  ö: "oe",
  ü: "ue",
  ß: "ss",
};

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => UMLAUTS[c])
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

/** Eindeutigen Slug bestimmen: base, base-2, base-3, ... */
export function uniqueSlug(base: string, exists: (s: string) => boolean): string {
  const root = slugify(base) || "inhalt";
  if (!exists(root)) return root;
  for (let i = 2; ; i++) {
    const candidate = `${root}-${i}`;
    if (!exists(candidate)) return candidate;
  }
}
