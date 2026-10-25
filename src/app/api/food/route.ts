import { NextResponse } from "next/server";

import { detectSubregion } from "@/data/regions";
import { getEventById } from "@/lib/events-data";
import {
  BLOG_PAGES,
  BLOG_PAGE_SIZE,
  FOOD_RADIUS_M,
  KAKAO_GROUP,
  analyzeMentions,
  blogQuery,
  buildQueries,
  getGooglePlacesKey,
  getKakaoRestKey,
  isValidKoreaCoord,
  matchRating,
  naverSearchUrl,
  rankPicks,
  scorePick,
  toCandidates,
  type BlogDoc,
  type Candidate,
  type FoodArea,
  type FoodKind,
  type FoodPick,
  type GoogleRating,
  type KakaoPlace,
} from "@/lib/food";

export const maxDuration = 45;

const WEEK = 60 * 60 * 24 * 7;
const MAX_CANDIDATES = 20;

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

/** (선택) 구글 지도 별점 — 동네 한 번에 20곳을 받아 이름·위치로 맞춘다. 키가 없거나 실패하면 빈 목록 */
async function googleRatings(
  key: string | null,
  kind: FoodKind,
  origin: { lat: number; lng: number } | null,
  area: FoodArea,
): Promise<GoogleRating[]> {
  if (!key) return [];
  const textQuery = `${[area.district, area.dong].filter(Boolean).join(" ")} ${kind === "cafe" ? "카페" : "맛집"}`.trim();
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount,places.location",
      },
      body: JSON.stringify({
        textQuery,
        languageCode: "ko",
        maxResultCount: 20,
        ...(origin
          ? { locationBias: { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: FOOD_RADIUS_M } } }
          : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      places?: { displayName?: { text?: string }; rating?: number; userRatingCount?: number; location?: { latitude: number; longitude: number } }[];
    };
    return (data.places ?? []).map((p) => ({
      name: p.displayName?.text ?? "",
      rating: p.rating ?? null,
      count: p.userRatingCount ?? null,
      lat: p.location?.latitude ?? null,
      lng: p.location?.longitude ?? null,
    }));
  } catch {
    return [];
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

/** 블로그(대부분 네이버 블로그)·카페 글을 받아 이 가게 이야기만 센다 */
async function enrich(key: string, c: Candidate, area: FoodArea, google: GoogleRating[]): Promise<FoodPick> {
  const query = blogQuery(c.name, area, c.address);
  let blog = { mentions: 0, recent: 0, family: 0, hot: 0 };
  let more = false;
  for (let page = 1; page <= BLOG_PAGES; page++) {
    const res = await kakao<{ documents?: BlogDoc[]; meta?: { is_end?: boolean } }>(key, "/v2/search/blog", {
      query,
      size: String(BLOG_PAGE_SIZE),
      page: String(page),
    }).catch(() => ({ documents: [], meta: { is_end: true } }));
    const docs = res.documents ?? [];
    const s = analyzeMentions(docs, c.name, area, c.address);
    blog = {
      mentions: blog.mentions + s.mentions,
      recent: blog.recent + s.recent,
      family: blog.family + s.family,
      hot: blog.hot + s.hot,
    };
    // 받은 글이 거의 다 이 가게 글일 때만 다음 쪽까지 본다
    const full = s.mentions >= docs.length * 0.8;
    more = page === BLOG_PAGES && full && !res.meta?.is_end;
    if (res.meta?.is_end || docs.length < BLOG_PAGE_SIZE || !full) break;
  }
  const cafe = await kakao<{ documents?: BlogDoc[] }>(key, "/v2/search/cafe", { query, size: "50" }).catch(() => ({
    documents: [],
  }));
  const cs = analyzeMentions(cafe.documents ?? [], c.name, area, c.address);
  const g = matchRating(c, google);
  const pick = {
    name: c.name,
    kind: c.kind,
    category: c.category,
    address: c.address,
    distance: c.distance,
    link: c.link,
    naverLink: naverSearchUrl([area.dong || area.district, c.name].filter(Boolean).join(" ")),
    blogCount: blog.mentions,
    blogMore: more,
    recentCount: blog.recent,
    cafeCount: cs.mentions,
    familyCount: blog.family + cs.family,
    hotCount: blog.hot + cs.hot,
    rating: g?.rating ?? null,
    ratingCount: g?.count ?? null,
  };
  return { ...pick, score: scorePick({ ...pick, rank: c.rank }) };
}

/** GET /api/food?event=<id> 또는 ?lat=..&lng=.. [&kind=cafe] → 인지도·후기 좋은 근처 식당/카페 10곳 */
export async function GET(request: Request) {
  const key = getKakaoRestKey();
  if (!key) {
    return NextResponse.json({ error: "맛집 추천을 준비 중이에요." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const kind: FoodKind = searchParams.get("kind") === "cafe" ? "cafe" : "meal";
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

  const queries = buildQueries(area, origin != null, kind);
  if (queries.length === 0) {
    return NextResponse.json({ error: "위치를 알 수 없어 추천하지 못했어요." }, { status: 422 });
  }
  try {
    const near: Record<string, string> = origin
      ? { x: String(origin.lng), y: String(origin.lat), radius: String(FOOD_RADIUS_M) }
      : {};
    const [pages, google] = await Promise.all([
      inBatches(queries, 3, (query) =>
        kakao<{ documents?: KakaoPlace[] }>(key, "/v2/local/search/keyword.json", {
          query,
          category_group_code: KAKAO_GROUP[kind],
          size: "15",
          sort: "accuracy",
          ...near,
        }),
      ),
      googleRatings(getGooglePlacesKey(), kind, origin, area),
    ]);
    // 검색어마다 순위를 섞어 '여러 검색에서 위에 나온 곳'이 앞에 오게
    const merged: KakaoPlace[] = [];
    for (let i = 0; i < 15; i++) for (const p of pages) if (p.documents?.[i]) merged.push(p.documents[i]);
    const candidates = toCandidates(merged, kind).slice(0, MAX_CANDIDATES);
    const picks = await inBatches(candidates, 6, (c) => enrich(key, c, area, google));
    return NextResponse.json(
      { picks: rankPicks(picks), area, kind, rated: google.length > 0 },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (err) {
    console.error("[food] kakao failed:", err);
    return NextResponse.json({ error: "지금은 맛집을 불러오지 못했어요." }, { status: 502 });
  }
}
