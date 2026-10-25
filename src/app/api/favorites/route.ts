import { NextResponse } from "next/server";

import { todayKst } from "@/lib/dates";
import { toListItem } from "@/lib/events";
import { getAllEvents } from "@/lib/events-data";

const MAX_IDS = 200;

/**
 * GET /api/favorites?ids=a,b,c — 찜 목록은 브라우저에만 있어서, 찜 알림을 그릴 때 그 행사들만 받아 간다.
 * 사라진 행사(정리된 id)는 그냥 빠진다.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[\w-]{1,64}$/.test(s))
      .slice(0, MAX_IDS),
  );
  if (ids.size === 0) return NextResponse.json({ items: [] });
  const today = todayKst();
  const items = (await getAllEvents())
    .filter((e) => ids.has(e.id))
    .map((e) => toListItem(e, null, today));
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
