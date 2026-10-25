import { NextResponse } from "next/server";

import { isValidKoreaCoord, overpassQuery, parseOverpass, roundCoord } from "@/lib/food";

/** 키 없는 공개 Overpass 서버 — 하나가 바쁘면 다음 것 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** GET /api/food?lat=..&lng=.. → 주변 식당·카페 (가까운 순) */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = roundCoord(Number(searchParams.get("lat")));
  const lng = roundCoord(Number(searchParams.get("lng")));
  if (!isValidKoreaCoord(lat, lng)) {
    return NextResponse.json({ error: "위치가 올바르지 않아요." }, { status: 400 });
  }
  const query = overpassQuery(lat, lng);
  for (const endpoint of ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
        headers: { "User-Agent": "EventNow/1.0 (family event guide; non-commercial)" },
        // 가게 목록은 자주 안 바뀐다 — 같은 동네는 일주일 동안 다시 묻지 않는다
        next: { revalidate: 60 * 60 * 24 * 7 },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const places = parseOverpass(await res.json(), { lat, lng });
      return NextResponse.json(
        { places, origin: { lat, lng } },
        { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
      );
    } catch (err) {
      console.error("[food] overpass failed:", endpoint, err);
    }
  }
  return NextResponse.json({ error: "지금은 맛집 목록을 불러오지 못했어요." }, { status: 502 });
}
