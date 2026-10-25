/**
 * 주변 맛집·카페 — 행사장(또는 내 위치) 근처에서 '많이 알려지고 후기 좋은' 곳 10곳.
 *
 * 카카오 REST API 키 하나(무료)로 여러 신호를 모아 점수를 매긴다:
 *  - 후보: 카카오 로컬 키워드 검색 (음식점 FD6 / 카페 CE7, 반경 1.5km, 카카오 정확도순)
 *  - 블로그 후기: 다음 블로그 검색 — 결과의 대부분이 네이버 블로그라 사실상 '네이버 블로그 후기 수'
 *    · 가게 이름이 실제로 나온 글만 센다, 최근 1년 글은 따로 센다 (요즘도 인기인지)
 *  - 맘카페 언급: 다음 카페 검색 — 아이 엄마들이 실제로 다녀온 이야기
 *  - 글 속 낱말: '아기의자·유아의자·키즈존·놀이방·아이랑' → 아이랑 가기 좋음,
 *    '웨이팅·줄 서·오픈런' → 줄 서는 인기집
 *  - (선택) 구글 지도 별점·리뷰 수 — GOOGLE_PLACES_API_KEY 가 있을 때만
 * 네이버 지도·인스타그램은 공개 API가 없고 자동 수집이 약관상 막혀 있어 쓰지 않는다.
 */

export type FoodKind = "meal" | "cafe";

export interface FoodPick {
  name: string;
  kind: FoodKind;
  /** '한식 · 육류,고기' */
  category: string | null;
  address: string | null;
  /** 기준점에서 미터, 모르면 null */
  distance: number | null;
  /** 카카오맵 장소 화면 (별점·리뷰·사진) */
  link: string;
  /** 네이버 검색 (블로그·플레이스 리뷰) */
  naverLink: string;
  /** 이 가게를 실제로 언급한 블로그 글 수 (확인한 범위 안에서) */
  blogCount: number;
  /** 확인한 글이 전부 이 가게 글이라 더 있을 수 있음 → 'N건 이상' */
  blogMore: boolean;
  /** 그중 최근 1년 글 */
  recentCount: number;
  /** 카페(맘카페 등) 글 언급 수 */
  cafeCount: number;
  /** 아이랑 가기 좋다는 말이 나온 글 수 */
  familyCount: number;
  /** 웨이팅·줄 선다는 말이 나온 글 수 */
  hotCount: number;
  /** 구글 지도 별점·리뷰 수 (키가 있을 때만) */
  rating: number | null;
  ratingCount: number | null;
  /** 정렬 점수 (높을수록 앞) */
  score: number;
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
export const FOOD_KIND_LABELS: Record<FoodKind, string> = { meal: "식당", cafe: "카페" };

export function getKakaoRestKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.KAKAO_REST_API_KEY?.trim() || null;
}

export function getGooglePlacesKey(env: Record<string, string | undefined> = process.env): string | null {
  return env.GOOGLE_PLACES_API_KEY?.trim() || null;
}

export function isValidKoreaCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 32.5 && lat < 39 && lng > 124 && lng < 132.5;
}

/** 동네 이름 — '서대문구 연희동', 동을 모르면 '서대문구' */
export function areaLabel(area: FoodArea): string {
  return [area.district, area.dong].filter(Boolean).join(" ");
}

/** 카카오 분류 코드 — 음식점 FD6, 카페 CE7 */
export const KAKAO_GROUP: Record<FoodKind, string> = { meal: "FD6", cafe: "CE7" };

/**
 * 키워드 검색어. 좌표가 있으면 반경 검색이라 동네 이름 없이 묻고,
 * 좌표가 없으면 동네·장소 이름을 붙인다.
 */
export function buildQueries(area: FoodArea, hasCoords: boolean, kind: FoodKind = "meal"): string[] {
  const base = kind === "cafe" ? ["카페", "디저트 카페", "베이커리 카페"] : ["맛집", "가족 외식", "한식"];
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
  x?: string;
  y?: string;
}

// 밥 먹을 곳만 — 술집은 뺀다 (카페는 카페 탭에서)
const NOT_MEAL = /술집|호프|요리주점|이자카야|와인|칵테일|카페|간식|제과|베이커리|디저트/;
const NOT_CAFE = /PC|스터디|룸카페|보드게임|만화|키즈카페|애견|고양이|무인/;

export interface Candidate {
  id: string;
  name: string;
  kind: FoodKind;
  category: string | null;
  address: string | null;
  distance: number | null;
  link: string;
  /** 카카오 검색 순위 (작을수록 카카오가 더 '정확'하다고 본 곳) */
  rank: number;
  lat: number | null;
  lng: number | null;
}

/** 로컬 검색 결과 → 후보 (분류에 맞는 곳만, 중복 제거) */
export function toCandidates(places: KakaoPlace[], kind: FoodKind = "meal"): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  places.forEach((p, i) => {
    const name = (p.place_name ?? "").trim();
    if (!name || seen.has(p.id)) return;
    if (p.category_group_code && p.category_group_code !== KAKAO_GROUP[kind]) return;
    const cat = p.category_name ?? "";
    if (kind === "meal" ? NOT_MEAL.test(cat) : NOT_CAFE.test(`${cat} ${name}`)) return;
    seen.add(p.id);
    // '음식점 > 한식 > 육류,고기' → '한식 · 육류,고기'
    const category =
      cat
        .split(">")
        .map((s) => s.trim())
        .filter((s) => s && s !== "음식점" && s !== "카페")
        .join(" · ") || null;
    const d = Number(p.distance);
    out.push({
      id: p.id,
      name,
      kind,
      category,
      address: p.road_address_name || p.address_name || null,
      distance: p.distance && Number.isFinite(d) ? d : null,
      link: p.place_url || kakaoSearchUrl(name),
      rank: i,
      lat: p.y ? Number(p.y) : null,
      lng: p.x ? Number(p.x) : null,
    });
  });
  return out;
}

/** 블로그·카페 검색어 — 체인점이 다른 지점 글까지 세지 않게 동네를 붙인다 */
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
  datetime?: string;
}

const squash = (s: string) => stripHtml(s).replace(/\s+/g, "").toLowerCase();
function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ");
}

/** '서울 서대문구 연희로 1' 같은 주소에서 구·시 이름 */
function dongFromAddress(address?: string | null): string | null {
  return address?.split(/\s+/).find((t) => /[구군시]$/.test(t) && t.length > 1) ?? null;
}

const FAMILY_WORDS = /아기\s?의자|유아\s?의자|아이\s?의자|키즈\s?존|놀이방|아이랑|아기랑|애기랑|유모차|아기\s?식기|유아\s?식기|가족\s?외식|키즈\s?메뉴|어린이\s?메뉴/;
// 실제로 줄을 서는지 — '재방문'·'인생맛집' 같은 칭찬 말은 넣지 않는다
const HOT_WORDS = /웨이팅|대기\s?(?:시간|줄|번호)|줄\s?(?:서|을\s?서|이\s?길)|오픈\s?런|캐치테이블|테이블링/;

/** 배지 기준 — 언급 글 중 일정 비율 이상일 때만 (글이 많은 집이 우연히 걸리지 않게) */
export function badgesFor(p: Pick<FoodPick, "blogCount" | "cafeCount" | "familyCount" | "hotCount">): {
  family: boolean;
  hot: boolean;
} {
  const total = p.blogCount + p.cafeCount;
  return {
    family: p.familyCount >= Math.max(3, total * 0.06),
    hot: p.hotCount >= Math.max(4, total * 0.15),
  };
}

export interface MentionStats {
  /** 이 가게를 실제로 언급한 글 */
  mentions: number;
  /** 그중 최근 1년 글 */
  recent: number;
  family: number;
  hot: number;
}

/**
 * 검색 결과 중 이 가게를 실제로 언급한 글만 센다.
 * 다음 검색의 '전체 건수'는 낱말만 겹쳐도 세어 '수빈'·'유우' 같은 짧은 이름은 수만 건이 나온다 —
 * 그래서 가게 이름이 제목·본문에 그대로 있는 글만, 이름이 짧으면 동네 이름도 함께 있는 글만 센다.
 */
export function analyzeMentions(
  docs: BlogDoc[],
  name: string,
  area: FoodArea,
  address?: string | null,
  now: Date = new Date(),
): MentionStats {
  const key = squash(name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+\S+점$/, ""));
  const stats: MentionStats = { mentions: 0, recent: 0, family: 0, hot: 0 };
  if (!key) return stats;
  const places = [area.dong, area.district, area.place, dongFromAddress(address)]
    .filter((s): s is string => Boolean(s))
    .map((s) => squash(s.replace(/\d+가$/, "")))
    .filter((s) => s.length >= 2);
  const short = key.length <= 3;
  const yearAgo = now.getTime() - 365 * 86_400_000;
  for (const d of docs) {
    const raw = stripHtml(`${d.title ?? ""} ${d.contents ?? ""}`);
    const text = raw.replace(/\s+/g, "").toLowerCase();
    if (!text.includes(key)) continue;
    if (short && places.length > 0 && !places.some((p) => text.includes(p))) continue;
    stats.mentions++;
    const t = d.datetime ? Date.parse(d.datetime) : NaN;
    if (Number.isFinite(t) && t >= yearAgo) stats.recent++;
    if (FAMILY_WORDS.test(raw)) stats.family++;
    if (HOT_WORDS.test(raw)) stats.hot++;
  }
  return stats;
}

/** 예전 이름 — 확인한 블로그 글 중 이 가게를 언급한 글 수만 */
export function countMentions(docs: BlogDoc[], name: string, area: FoodArea, address?: string | null): number {
  return analyzeMentions(docs, name, area, address).mentions;
}

/**
 * 점수: 블로그 후기(최근 1년 가중) + 맘카페 언급 + 구글 별점 + 카카오 순위, 너무 먼 곳은 살짝 감점.
 * 글 수는 로그로 눌러 한두 곳이 압도하지 않게 한다.
 */
export function scorePick(p: {
  blogCount: number;
  recentCount: number;
  cafeCount: number;
  rating: number | null;
  ratingCount: number | null;
  rank: number;
  distance: number | null;
}): number {
  const log = (n: number) => Math.log10(1 + Math.max(0, n));
  let s = 3 * log(p.blogCount) + 2 * log(p.recentCount) + 2 * log(p.cafeCount);
  if (p.rating != null && (p.ratingCount ?? 0) >= 10) {
    // 4.0을 기준으로 별점이 높을수록, 리뷰가 많을수록 더
    s += (p.rating - 4.0) * 2 + 0.8 * log(p.ratingCount ?? 0);
  }
  s += Math.max(0, 1 - p.rank / 15) * 0.6;
  if (p.distance != null && p.distance > 1000) s -= 0.3;
  return Math.round(s * 100) / 100;
}

export interface GoogleRating {
  name: string;
  rating: number | null;
  count: number | null;
  lat: number | null;
  lng: number | null;
}

/** 구글 지도 결과를 카카오 후보와 이름·위치로 맞춘다 (100m 안, 이름 앞부분이 같을 때) */
export function matchRating(c: Candidate, google: GoogleRating[]): GoogleRating | null {
  const key = squash(c.name).slice(0, 4);
  if (key.length < 2) return null;
  let best: GoogleRating | null = null;
  for (const g of google) {
    const gk = squash(g.name);
    if (!gk.includes(key) && !squash(c.name).includes(gk.slice(0, 4))) continue;
    if (c.lat != null && c.lng != null && g.lat != null && g.lng != null) {
      const dy = (c.lat - g.lat) * 111_000;
      const dx = (c.lng - g.lng) * 88_000;
      if (Math.hypot(dx, dy) > 150) continue;
    }
    best = g;
    break;
  }
  return best;
}

export function kakaoSearchUrl(query: string): string {
  return `https://map.kakao.com/?q=${encodeURIComponent(query)}`;
}

export function naverSearchUrl(query: string): string {
  return `https://search.naver.com/search.naver?query=${encodeURIComponent(query)}`;
}

/** 점수 높은 순 10곳 (후기가 하나도 확인되지 않은 곳은 뺀다) */
export function rankPicks(picks: FoodPick[]): FoodPick[] {
  return [...picks]
    .filter((p) => p.blogCount > 0 || p.cafeCount > 0 || (p.ratingCount ?? 0) > 0)
    .sort((a, b) => b.score - a.score || (a.distance ?? 1e9) - (b.distance ?? 1e9))
    .slice(0, FOOD_LIMIT);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export function formatCount(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만` : n.toLocaleString("ko-KR");
}
