/**
 * 주변 맛집 — 행사장(또는 내 위치) 근처에서 블로그 글이 많은 식당 10곳.
 *
 * 카카오 REST API 키 하나(무료)로:
 *  1) 카카오 로컬 키워드 검색 — 기준 좌표 반경 안 '음식점'(FD6) 후보
 *  2) 다음 블로그 검색 — 가게 이름+동네로 나온 글 수 → 많은 순 10곳
 * 별점은 공개 API로 받을 수 없어 '블로그 글 수'를 인기 지표로 쓴다.
 * 키는 서버(Vercel 환경변수)에만 있다. 키가 없으면 지도 검색 바로가기만 보여준다.
 */

export interface FoodPick {
  name: string;
  /** '한식 · 육류,고기' */
  category: string | null;
  address: string | null;
  /** 이 가게를 실제로 언급한 블로그 글 수 (확인한 범위 안에서) */
  blogCount: number;
  /** 확인한 글이 전부 이 가게 글이라 더 있을 수 있음 → 'N건 이상' */
  blogMore: boolean;
  /** 기준점에서 미터, 모르면 null */
  distance: number | null;
  /** 리뷰·사진을 볼 카카오맵 장소 화면 */
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

export const FOOD_LIMIT = 10;
/** 기준점 반경 (m) */
export const FOOD_RADIUS_M = 1500;

export function getKakaoRestKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.KAKAO_REST_API_KEY?.trim() || null;
}

export function isValidKoreaCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 32.5 && lat < 39 && lng > 124 && lng < 132.5;
}

/** 동네 이름 — '서대문구 연희동', 동을 모르면 '서대문구' */
export function areaLabel(area: FoodArea): string {
  return [area.district, area.dong].filter(Boolean).join(" ");
}

/**
 * 키워드 검색어. 좌표가 있으면 반경 검색이라 동네 이름 없이 묻고,
 * 좌표가 없으면 동네·장소 이름을 붙인다.
 */
export function buildQueries(area: FoodArea, hasCoords: boolean): string[] {
  const base = ["맛집", "가족 외식", "한식"];
  if (hasCoords) return base;
  const where = areaLabel(area) || area.place || "";
  return where ? base.map((q) => `${where} ${q}`) : [];
}

export interface KakaoPlace {
  id: string;
  place_name: string;
  category_name?: string;
  category_group_code?: string;
  road_address_name?: string;
  address_name?: string;
  distance?: string;
  place_url?: string;
}

// 밥 먹을 곳만 — 술집·카페·간식은 뺀다
const NOT_MEAL = /술집|호프|요리주점|이자카야|와인|칵테일|카페|간식|제과|베이커리|디저트/;

export interface Candidate {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  distance: number | null;
  link: string;
}

/** 로컬 검색 결과 → 후보 (음식점만, 중복 제거) */
export function toCandidates(places: KakaoPlace[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const p of places) {
    const name = (p.place_name ?? "").trim();
    if (!name || seen.has(p.id)) continue;
    if (p.category_group_code && p.category_group_code !== "FD6") continue;
    if (p.category_name && NOT_MEAL.test(p.category_name)) continue;
    seen.add(p.id);
    // '음식점 > 한식 > 육류,고기' → '한식 · 육류,고기'
    const category = p.category_name
      ? p.category_name.split(">").map((s) => s.trim()).filter((s) => s && s !== "음식점").join(" · ") || null
      : null;
    const d = Number(p.distance);
    out.push({
      id: p.id,
      name,
      category,
      address: p.road_address_name || p.address_name || null,
      distance: p.distance && Number.isFinite(d) ? d : null,
      link: p.place_url || kakaoSearchUrl(name),
    });
  }
  return out;
}

/** 블로그 검색어 — 체인점이 다른 지점 글까지 세지 않게 동네를 붙인다 */
export function blogQuery(name: string, area: FoodArea, address?: string | null): string {
  const near = area.dong || area.district || dongFromAddress(address) || "";
  return `${name} ${near}`.trim();
}

/** 블로그 검색 한 번에 받는 글 수 (다음 검색 최대 50) · 가게마다 확인하는 쪽 수 */
export const BLOG_PAGE_SIZE = 50;
export const BLOG_PAGES = 2;

export interface BlogDoc {
  title?: string;
  contents?: string;
}

const squash = (s: string) => stripHtml(s).replace(/\s+/g, "").toLowerCase();
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ");
}

/**
 * 검색 결과 중 이 가게를 실제로 언급한 글만 센다.
 * 다음 검색의 '전체 건수'는 낱말만 겹쳐도 세어 '수빈'·'유우' 같은 짧은 이름은 수만 건이 나온다 —
 * 그래서 가게 이름이 제목·본문에 그대로 있는 글만, 이름이 짧으면 동네 이름도 함께 있는 글만 센다.
 */
export function countMentions(docs: BlogDoc[], name: string, area: FoodArea, address?: string | null): number {
  const key = squash(name);
  if (!key) return 0;
  const places = [area.dong, area.district, area.place, dongFromAddress(address)]
    .filter((s): s is string => Boolean(s))
    .map((s) => squash(s.replace(/\d+가$/, "")))
    .filter((s) => s.length >= 2);
  const short = key.length <= 3;
  return docs.filter((d) => {
    const text = squash(`${d.title ?? ""} ${d.contents ?? ""}`);
    if (!text.includes(key)) return false;
    return !short || places.length === 0 || places.some((p) => text.includes(p));
  }).length;
}

/** '서울 서대문구 연희로 1' 같은 주소에서 구·시 이름 */
function dongFromAddress(address?: string | null): string | null {
  return address?.split(/\s+/).find((t) => /[구군시]$/.test(t) && t.length > 1) ?? null;
}

export function kakaoSearchUrl(query: string): string {
  return `https://map.kakao.com/?q=${encodeURIComponent(query)}`;
}

/** 블로그 글 많은 순 10곳 (글이 하나도 확인되지 않은 곳은 뺀다) */
export function rankPicks(candidates: (Candidate & { blogCount: number; blogMore?: boolean })[]): FoodPick[] {
  return [...candidates]
    .filter((c) => c.blogCount > 0)
    .sort((a, b) => b.blogCount - a.blogCount || (a.distance ?? 1e9) - (b.distance ?? 1e9))
    .slice(0, FOOD_LIMIT)
    .map(({ name, category, address, blogCount, blogMore, distance, link }) => ({
      name,
      category,
      address,
      blogCount,
      blogMore: Boolean(blogMore),
      distance,
      link,
    }));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export function formatCount(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만` : n.toLocaleString("ko-KR");
}
