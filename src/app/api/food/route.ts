import { NextResponse } from "next/server";

import { isValidKoreaCoord, overpassQuery, parseOverpass, roundCoord } from "@/lib/food";

/** 키 없는 공개 Overpass 서버들 — 동시에 물어 먼저 답한 곳을 쓴다 (한 곳이 바쁘거나 멈춰도 괜찮게) */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export const maxDuration = 30;

async function ask(endpoint: string, query: string, signal: AbortSignal) {
  const res = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "EventNow/1.0 (family event guide; non-commercial)" },
    // 가게 목록은 자주 안 바뀐다 — 같은 동네는 일주일 동안 다시 묻지 않는다
    next: { revalidate: 60 * 60 * 24 * 7 },
    signal,
  });
  if (!res.ok) throw new Error(`${endpoint} ${res.status}`);
  return (await res.json()) as Parameters<typeof parseOverpass>[0];
}

/** GET /api/food?lat=..&lng=.. → 주변 식당·카페 (가까운 순) */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = roundCoord(Number(searchParams.get("lat")));
  const lng = roundCoord(Number(searchParams.get("lng")));
  if (!isValidKoreaCoord(lat, lng)) {
    return NextResponse.json({ error: "위치가 올바르지 않아요." }, { status: 400 });
  }
  const query = overpassQuery(lat, lng);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const data = await Promise.any(ENDPOINTS.map((e) => ask(e, query, controller.signal)));
    controller.abort(); // 나머지 요청은 끊는다
    const places = parseOverpass(data, { lat, lng });
    return NextResponse.json(
      { places, origin: { lat, lng } },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (err) {
    console.error("[food] overpass failed:", err);
    return NextResponse.json(
      { error: "지금은 맛집 목록을 불러오지 못했어요." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    clearTimeout(timer);
  }
}
