/**
 * Empfängt die Verweildauer vom sendBeacon (visibilitychange/pagehide).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginRequest } from "@/lib/csrf";
import { rateLimit } from "@/lib/ratelimit";
import { getClientIp } from "@/lib/request";
import { recordDuration } from "@/lib/tracking";

const bodySchema = z.object({
  token: z.string().length(32),
  ms: z.number().int().min(0),
});

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const ip = await getClientIp();
  if (!rateLimit(`beacon:${ip}`, 60, 60_000).ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  try {
    const body = bodySchema.parse(await req.json());
    await recordDuration(body.token, body.ms);
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
