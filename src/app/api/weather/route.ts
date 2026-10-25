import { NextResponse } from "next/server";

import { REGION_OPTIONS, type RegionCode } from "@/data/regions";
import { getForecast } from "@/lib/weather";

const REGIONS = new Set(REGION_OPTIONS.map((o) => o.value).filter((v) => v !== "all"));

/**
 * GET /api/weather?region=부산광역시 — 빠른 보기에서 행사 지역의 주말 날씨를 보여줄 때 쓴다.
 * 예보 자체는 getForecast가 3시간 캐시하고, 브라우저·CDN도 1시간 재사용한다.
 */
export async function GET(request: Request) {
  const region = new URL(request.url).searchParams.get("region") ?? "";
  if (!REGIONS.has(region as RegionCode)) {
    return NextResponse.json({ error: "unknown_region" }, { status: 400 });
  }
  const forecast = await getForecast(region as RegionCode);
  if (!forecast) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json(forecast, {
    headers: { "Cache-Control": "public, max-age=1800, s-maxage=3600, stale-while-revalidate=3600" },
  });
}
