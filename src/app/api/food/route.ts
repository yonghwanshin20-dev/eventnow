import { NextResponse } from "next/server";

import { getEventById } from "@/lib/events-data";
import {
  blogQuery,
  buildQueries,
  getNaverConfig,
  isValidKoreaCoord,
  rankPicks,
  toCandidates,
  type Candidate,
  type FoodArea,
  type NaverConfig,
  type NaverLocalItem,
} from "@/lib/food";
import { detectSubregion } from "@/data/regions";

export const maxDuration = 30;

const WEEK = 60 * 60 * 24 * 7;
const MAX_CANDIDATES = 20;

async function naver<T>(config: NaverConfig, path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`https://openapi.naver.com/v1/search/${path}?${new URLSearchParams(params)}`, {
    headers: { "X-Naver-Client-Id": config.id, "X-Naver-Client-Secret": config.secret },
    // 같은 동네·가게는 일주일 동안 다시 묻지 않는다 (무료 한도 아끼기)
    next: { revalidate: WEEK },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`naver ${path} ${res.status}`);
  return (await res.json()) as T;
}

/** 좌표 → 동·구 (OpenStreetMap, 키 없음) — '내 위치'로 찾을 때 */
async function reverseArea(lat: number, lng: number): Promise<FoodArea> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2&zoom=16&addressdetails=1`,
      {
        headers: { "User-Agent": "EventNow/1.0 (family event guide; non-commercial)", "Accept-Language": "ko" },
        next: { revalidate: WEEK },
        signal: AbortSignal.timeout(8000),
      },
    );
    const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
    const district = a.borough || a.county || a.city || null;
    const dong = [a.quarter, a.suburb, a.city_district, a.town].find((v) => v && /[동읍면]$/.test(v)) ?? null;
    return { district, dong: dong?.replace(/\d+가$/, "") ?? null };
  } catch {
    return {};
  }
}

/** 한 번에 몇 개씩만 (네이버 검색 API 초당 호출 제한) */
async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/** GET /api/food?event=<id> 또는 ?lat=..&lng=.. → 블로그 글 많은 동네 식당 10곳 */
export async function GET(request: Request) {
  const config = getNaverConfig();
  if (!config) {
    return NextResponse.json({ error: "맛집 추천을 준비 중이에요." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  let area: FoodArea = {};
  let origin: { lat: number; lng: number } | null = null;

  const eventId = searchParams.get("event");
  if (eventId) {
    const found = await getEventById(eventId);
    if (!found) return NextResponse.json({ error: "행사를 찾지 못했어요." }, { status: 404 });
    const e = found.event;
    area = {
      dong: e.dong ?? null,
      district: detectSubregion(e.region, e.address ?? "", e.district) ?? e.district ?? null,
      place: e.location_name && e.location_name !== e.address ? e.location_name : null,
    };
    if (e.latitude != null && e.longitude != null) origin = { lat: e.latitude, lng: e.longitude };
  } else {
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    if (!isValidKoreaCoord(lat, lng)) {
      return NextResponse.json({ error: "위치가 올바르지 않아요." }, { status: 400 });
    }
    // 같은 동네는 같은 캐시를 쓰게 약 100m 단위로
    origin = { lat: Math.round(lat * 1000) / 1000, lng: Math.round(lng * 1000) / 1000 };
    area = await reverseArea(origin.lat, origin.lng);
  }

  const queries = buildQueries(area);
  if (queries.length === 0) {
    return NextResponse.json({ error: "동네를 알 수 없어 추천하지 못했어요." }, { status: 422 });
  }
  try {
    const pages = await inBatches(queries, 3, (query) =>
      naver<{ items?: NaverLocalItem[] }>(config, "local.json", { query, display: "5", sort: "comment" }).catch(
        () => ({ items: [] }),
      ),
    );
    const candidates = toCandidates(pages.flatMap((p) => p.items ?? [])).slice(0, MAX_CANDIDATES);
    const counted = await inBatches<Candidate, Candidate & { blogCount: number }>(candidates, 5, async (c) => {
      const blog = await naver<{ total?: number }>(config, "blog.json", {
        query: blogQuery(c.name, area),
        display: "1",
      }).catch(() => ({ total: 0 }));
      return { ...c, blogCount: blog.total ?? 0 };
    });
    const picks = rankPicks(counted, origin, area);
    return NextResponse.json(
      { picks, area },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (err) {
    console.error("[food] naver failed:", err);
    return NextResponse.json({ error: "지금은 맛집을 불러오지 못했어요." }, { status: 502 });
  }
}
