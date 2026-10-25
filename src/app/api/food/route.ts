import { NextResponse } from "next/server";

import { detectSubregion } from "@/data/regions";
import { getEventById } from "@/lib/events-data";
import {
  BLOG_PAGES,
  BLOG_PAGE_SIZE,
  FOOD_RADIUS_M,
  blogQuery,
  countMentions,
  type BlogDoc,
  buildQueries,
  getKakaoRestKey,
  isValidKoreaCoord,
  rankPicks,
  toCandidates,
  type Candidate,
  type FoodArea,
  type KakaoPlace,
} from "@/lib/food";

export const maxDuration = 30;

const WEEK = 60 * 60 * 24 * 7;
const MAX_CANDIDATES = 25;

async function kakao<T>(key: string, path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`https://dapi.kakao.com${path}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    // 같은 동네·가게는 일주일 동안 다시 묻지 않는다 (무료 한도 아끼기)
    next: { revalidate: WEEK },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`kakao ${path} ${res.status}`);
  return (await res.json()) as T;
}

/** 좌표 → 동·구 (카카오 좌표→행정구역) — '내 위치'로 찾을 때 블로그 검색어에 쓴다 */
async function reverseArea(key: string, lat: number, lng: number): Promise<FoodArea> {
  try {
    const data = await kakao<{ documents?: { region_type: string; region_2depth_name: string; region_3depth_name: string }[] }>(
      key,
      "/v2/local/geo/coord2regioncode.json",
      { x: String(lng), y: String(lat) },
    );
    const h = data.documents?.find((d) => d.region_type === "H") ?? data.documents?.[0];
    // '고양시 일산동구' → '일산동구' 보다 시 이름이 검색에 낫다
    return h ? { district: h.region_2depth_name.split(" ")[0], dong: h.region_3depth_name || null } : {};
  } catch {
    return {};
  }
}

/** 한 번에 몇 개씩만 */
async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/** GET /api/food?event=<id> 또는 ?lat=..&lng=.. → 블로그 글 많은 근처 식당 10곳 */
export async function GET(request: Request) {
  const key = getKakaoRestKey();
  if (!key) {
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
    area = await reverseArea(key, origin.lat, origin.lng);
  }

  const queries = buildQueries(area, origin != null);
  if (queries.length === 0) {
    return NextResponse.json({ error: "위치를 알 수 없어 추천하지 못했어요." }, { status: 422 });
  }
  try {
    const near: Record<string, string> = origin
      ? { x: String(origin.lng), y: String(origin.lat), radius: String(FOOD_RADIUS_M) }
      : {};
    const pages = await inBatches(queries, 3, (query) =>
      kakao<{ documents?: KakaoPlace[] }>(key, "/v2/local/search/keyword.json", {
        query,
        category_group_code: "FD6",
        size: "15",
        sort: "accuracy",
        ...near,
      }),
    );
    const candidates = toCandidates(pages.flatMap((p) => p.documents ?? [])).slice(0, MAX_CANDIDATES);
    type Counted = Candidate & { blogCount: number; blogMore: boolean };
    const counted = await inBatches<Candidate, Counted>(candidates, 5, async (c) => {
      // '전체 건수'는 믿을 수 없어 글을 받아 이 가게를 실제로 언급한 글만 센다 (최대 100건 확인)
      let count = 0;
      let more = false;
      for (let page = 1; page <= BLOG_PAGES; page++) {
        const blog = await kakao<{ documents?: BlogDoc[]; meta?: { is_end?: boolean } }>(key, "/v2/search/blog", {
          query: blogQuery(c.name, area, c.address),
          size: String(BLOG_PAGE_SIZE),
          page: String(page),
        }).catch(() => ({ documents: [], meta: { is_end: true } }));
        const docs = blog.documents ?? [];
        const hits = countMentions(docs, c.name, area, c.address);
        count += hits;
        // 받은 글이 거의 다 이 가게 글일 때만 다음 쪽까지 본다
        more = page === BLOG_PAGES && hits >= docs.length * 0.8 && !blog.meta?.is_end;
        if (blog.meta?.is_end || docs.length < BLOG_PAGE_SIZE || hits < docs.length * 0.8) break;
      }
      return { ...c, blogCount: count, blogMore: more };
    });
    return NextResponse.json(
      { picks: rankPicks(counted), area },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (err) {
    console.error("[food] kakao failed:", err);
    return NextResponse.json({ error: "지금은 맛집을 불러오지 못했어요." }, { status: 502 });
  }
}
