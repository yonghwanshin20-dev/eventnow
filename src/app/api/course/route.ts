import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { courseStops } from "@/lib/course";
import { isIsoDate, todayKst } from "@/lib/dates";
import { getAllEvents } from "@/lib/events-data";
import { KID_AGE_COOKIE, parseKidAge } from "@/lib/kid-age";
import { pickVisitDay } from "@/lib/visit-day";

/**
 * GET /api/course?id=<행사>&day=YYYY-MM-DD — '같은 날 같이 들르기 좋은 곳'.
 * day가 없거나 행사 기간 밖이면 가는 날(이번 주말 → 오늘 → 시작일)로 정한다.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const all = await getAllEvents();
  const base = all.find((e) => e.id === id);
  if (!base) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const today = todayKst();
  const asked = params.get("day");
  const day = pickVisitDay(
    base.start_date.slice(0, 10),
    base.end_date.slice(0, 10),
    today,
    isIsoDate(asked) ? asked : null,
  );
  const kid = parseKidAge((await cookies()).get(KID_AGE_COOKIE)?.value);
  return NextResponse.json(
    { day, stops: courseStops(base, all, day, today, kid) },
    // 아이 나이(쿠키)에 따라 달라지므로 저장하지 않는다 — 나이를 바꾸면 바로 반영되게
    { headers: { "Cache-Control": "no-store" } },
  );
}
