/**
 * One-Click-Abmeldung: GET (Link in jeder Mail) und POST
 * (RFC 8058 List-Unsubscribe-Post) melden ab und leiten auf die
 * Bestätigungsseite weiter.
 */
import { NextResponse } from "next/server";
import { unsubscribeContact } from "@/lib/newsletter";
import { rateLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";
import { getBaseUrl } from "@/lib/base-url";

async function handle(token: string): Promise<Response> {
  const ip = await getClientIp();
  const limited = !rateLimit(`unsub:${ip}`, 20, 60_000).ok;
  const result = limited ? "ungueltig" : await unsubscribeContact(token);
  return NextResponse.redirect(
    `${getBaseUrl()}/newsletter/abgemeldet?status=${result}`,
    303,
  );
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  return handle(token);
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  return handle(token);
}
