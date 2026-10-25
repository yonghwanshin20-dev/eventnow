/**
 * 주변 맛집 — 행사장(또는 내 위치) 동네에서 리뷰·블로그 글이 많은 식당 10곳.
 *
 * 네이버 검색 API(무료, 하루 25,000회)를 쓴다:
 *  1) 지역 검색을 '리뷰 많은 순'(sort=comment)으로 동네 검색어 여러 개 → 후보 식당
 *  2) 후보마다 블로그 검색 결과 수 → 많은 순으로 10곳
 * 별점은 공개 API로 받을 수 없어 '블로그 글 수'를 인기 지표로 쓴다.
 * 키는 서버(Vercel 환경변수)에만 있다. 키가 없으면 네이버 검색 바로가기만 보여준다.
 */

import { distanceKm } from "@/lib/events";

export interface FoodPick {
  name: string;
  /** '한식 · 육류,고기요리' */
  category: string | null;
  address: string | null;
  /** 네이버 블로그에 이 가게 이름+동네로 나온 글 수 */
  blogCount: number;
  /** 행사장(기준점)에서 미터, 좌표가 없으면 null */
  distance: number | null;
  /** 리뷰·사진을 볼 네이버 검색 */
  link: string;
}

export interface FoodArea {
  /** '연희동' */
  dong?: string | null;
  /** '서대문구' */
  district?: string | null;
  /** '홍제폭포' */
  place?: string | null;
}

export interface NaverConfig {
  id: string;
  secret: string;
}

export const FOOD_LIMIT = 10;
/** 행사장에서 이보다 먼 후보는 뺀다 */
export const FOOD_MAX_DISTANCE_M = 2000;

export function getNaverConfig(env: Record<string, string | undefined> = process.env): NaverConfig | null {
  const id = env.NAVER_CLIENT_ID?.trim();
  const secret = env.NAVER_CLIENT_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

export function isValidKoreaCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 32.5 && lat < 39 && lng > 124 && lng < 132.5;
}

/** 동네 이름 — '서대문구 연희동', 동을 모르면 '서대문구' */
export function areaLabel(area: FoodArea): string {
  return [area.district, area.dong].filter(Boolean).join(" ");
}

/** 지역 검색은 한 번에 5곳만 주므로 검색어를 몇 개로 나눠 묻는다 */
export function buildQueries(area: FoodArea): string[] {
  const where = areaLabel(area);
  const near = area.dong || area.district || "";
  const qs = [
    where && `${where} 맛집`,
    area.place && `${area.place} 맛집`,
    area.place && `${area.place} 근처 식당`,
    near && `${near} 가족 외식`,
    near && `${near} 한식 맛집`,
    near && `${near} 아이랑 식당`,
  ];
  return [...new Set(qs.filter((q): q is string => Boolean(q)))];
}

export interface NaverLocalItem {
  title: string;
  link?: string;
  category?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string;
  mapy?: string;
}

const stripTags = (s: string) =>
  s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

// 밥 먹을 곳만 — 카페·술집은 뺀다
const NOT_MEAL = /카페|디저트|베이커리|제과|술집|호프|요리주점|이자카야|와인|칵테일|바\(BAR\)|포장마차|유흥/;

export interface Candidate {
  name: string;
  category: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
}

/** 지역 검색 결과 → 후보 (식당만, 이름·주소 중복 제거) */
export function toCandidates(items: NaverLocalItem[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const it of items) {
    const name = stripTags(it.title ?? "");
    const category = it.category ? it.category.replace(/>/g, " · ") : null;
    if (!name || (it.category && NOT_MEAL.test(it.category))) continue;
    const address = it.roadAddress || it.address || null;
    const key = name.replace(/\s/g, "");
    if (seen.has(key)) continue;
    seen.add(key);
    // 새 지역 검색 API의 mapx·mapy 는 경도·위도 × 10^7
    const x = Number(it.mapx);
    const y = Number(it.mapy);
    const ok = x > 1e9 && y > 1e8;
    out.push({ name, category, address, lat: ok ? y / 1e7 : null, lng: ok ? x / 1e7 : null });
  }
  return out;
}

/** 블로그 검색어 — 체인점이 다른 동네 지점 글까지 세지 않게 동네를 붙인다 */
export function blogQuery(name: string, area: FoodArea): string {
  const near = area.dong || area.district || "";
  return `"${name}" ${near}`.trim();
}

export function naverSearchUrl(query: string): string {
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
}

/** 블로그 글 많은 순 10곳 (기준점에서 너무 먼 곳은 뺀다) */
export function rankPicks(
  candidates: (Candidate & { blogCount: number })[],
  origin: { lat: number; lng: number } | null,
  area: FoodArea,
): FoodPick[] {
  return candidates
    .map((c) => {
      const distance =
        origin && c.lat != null && c.lng != null
          ? Math.round(distanceKm(origin, { lat: c.lat, lng: c.lng }) * 1000)
          : null;
      return {
        name: c.name,
        category: c.category,
        address: c.address,
        blogCount: c.blogCount,
        distance,
        link: naverSearchUrl([area.dong || area.district, c.name].filter(Boolean).join(" ")),
      };
    })
    .filter((p) => p.distance == null || p.distance <= FOOD_MAX_DISTANCE_M)
    .sort((a, b) => b.blogCount - a.blogCount)
    .slice(0, FOOD_LIMIT);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export function formatCount(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만` : n.toLocaleString("ko-KR");
}
