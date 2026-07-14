/**
 * Anonymes Liken ohne Konto (Client-Seite): eine zufällige Client-ID (UUID)
 * in localStorage, serverseitige Dedup. Geteilt von LikeButton (Detailseite)
 * und CompactLike (Kachel/Slider), damit ein Like überall denselben Status
 * hat und dieselbe API nutzt.
 */
const CLIENT_ID_KEY = "roses-client-id";
const LIKED_KEY = "roses-likes";

export function getClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

export function getLikedIds(): number[] {
  try {
    return JSON.parse(localStorage.getItem(LIKED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function markLiked(recipeId: number): void {
  localStorage.setItem(
    LIKED_KEY,
    JSON.stringify([...new Set([...getLikedIds(), recipeId])]),
  );
}

/**
 * Sendet ein Like an die API. Gibt den neuen Zählerstand zurück oder null bei
 * Fehler. Bei Erfolg wird das Rezept lokal als „geliked" markiert.
 */
export async function sendLike(recipeId: number): Promise<number | null> {
  const res = await fetch("/api/likes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipeId, clientId: getClientId() }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { likeCount: number };
  markLiked(recipeId);
  return data.likeCount;
}
