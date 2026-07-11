/** Öffentliche Basis-URL aus der Umgebung (ohne abschließenden Slash). */
export function getBaseUrl(): string {
  return (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
