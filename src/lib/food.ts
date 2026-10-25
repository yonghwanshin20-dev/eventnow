/**
 * 주변 맛집 — OpenStreetMap(Overpass, 키 없음)에 등록된 식당·카페를 행사 장소/내 위치 근처에서 찾는다.
 *
 * OSM에 없는 가게도 많아서, 네이버·카카오 지도의 '주변 맛집' 검색 바로가기를 함께 보여준다.
 * 평점·리뷰는 지도 앱에서 확인하도록 넘긴다 (무단 수집하지 않음).
 */

import { distanceKm } from "@/lib/events";

export type FoodKind = "meal" | "cafe" | "dessert";

export interface FoodPlace {
  id: string;
  name: string;
  kind: FoodKind;
  /** 한식·중식 같은 짧은 설명 */
  cuisine: string | null;
  lat: number;
  lng: number;
  /** 미터 */
  distance: number;
  address: string | null;
  /** 아이와 가기 좋은 표시 (OSM 태그에 있을 때만) */
  kids: boolean;
  openingHours: string | null;
}

export const FOOD_KIND_LABELS: Record<FoodKind, string> = {
  meal: "식당",
  cafe: "카페",
  dessert: "빵·디저트",
};

export const FOOD_RADIUS_M = 800;
const MAX_RESULTS = 60;

/** 같은 동네는 같은 캐시를 쓰게 좌표를 약 100m 단위로 맞춘다 */
export function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function isValidKoreaCoord(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat > 32.5 && lat < 39 && lng > 124 && lng < 132.5;
}

export function overpassQuery(lat: number, lng: number, radius = FOOD_RADIUS_M): string {
  const around = `(around:${radius},${lat},${lng})`;
  return [
    "[out:json][timeout:20];",
    "(",
    `  nwr${around}["amenity"~"^(restaurant|cafe|fast_food|ice_cream|food_court)$"]["name"];`,
    `  nwr${around}["shop"~"^(bakery|pastry|confectionery)$"]["name"];`,
    ");",
    "out center tags 200;",
  ].join("\n");
}

// OSM cuisine 값은 영어(korean)도 한글(한식;갈비)도 섞여 있다 — 위에서부터 먼저 맞는 것
const CUISINE_LABELS: [RegExp, string][] = [
  [/barbecue|grill|bbq|meat|고기|갈비|삼겹|구이/, "고기"],
  [/chicken|치킨|닭/, "치킨"],
  [/noodle|ramen|udon|soba|naengmyeon|kalguksu|국수|냉면|칼국수|라멘/, "면"],
  [/korean|bibimbap|bulgogi|kimchi|한식|국밥|찌개|백반/, "한식"],
  [/chinese|중식|중국/, "중식"],
  [/japanese|sushi|일식|초밥|돈까스|돈가스/, "일식"],
  [/pizza|피자/, "피자"],
  [/burger|버거/, "버거"],
  [/italian|pasta|western|american|french|steak|양식|파스타/, "양식"],
  [/vietnamese|thai|indian|asian|쌀국수/, "아시아"],
  [/seafood|fish|해산물|횟집|생선/, "해산물"],
  [/bakery|bread|cake|dessert|donut|ice_cream|빵|디저트|케이크/, "디저트"],
  [/coffee|커피/, "커피"],
];

function cuisineLabel(tags: Record<string, string>): string | null {
  const raw = (tags.cuisine ?? "").toLowerCase();
  for (const [re, label] of CUISINE_LABELS) if (re.test(raw)) return label;
  if (tags.amenity === "fast_food") return "간편식";
  if (tags.amenity === "food_court") return "푸드코트";
  return null;
}

function kindOf(tags: Record<string, string>): FoodKind {
  if (tags.shop || tags.amenity === "ice_cream") return "dessert";
  if (tags.amenity === "cafe") {
    return /bakery|cake|dessert|donut|빵|디저트|케이크/.test(tags.cuisine ?? "") ? "dessert" : "cafe";
  }
  return "meal";
}

function addressOf(tags: Record<string, string>): string | null {
  const road = [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" ");
  if (road) return [tags["addr:district"] ?? tags["addr:city"], road].filter(Boolean).join(" ");
  return tags["addr:full"] ?? null;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Overpass 응답 → 가까운 순 목록 (이름 중복·폐업 표시는 거른다) */
export function parseOverpass(
  data: { elements?: OverpassElement[] },
  origin: { lat: number; lng: number },
): FoodPlace[] {
  const seen = new Set<string>();
  const places: FoodPlace[] = [];
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = (tags["name:ko"] || tags.name || "").trim();
    if (!name || lat == null || lng == null) continue;
    if (tags.disused || tags["disused:amenity"] || tags.opening_hours === "closed") continue;
    const distance = Math.round(distanceKm(origin, { lat, lng }) * 1000);
    const key = `${name}|${Math.round(distance / 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push({
      id: `${el.type}/${el.id}`,
      name,
      kind: kindOf(tags),
      cuisine: cuisineLabel(tags),
      lat,
      lng,
      distance,
      address: addressOf(tags),
      kids: tags.kids_area === "yes" || tags.highchair === "yes" || tags.changing_table === "yes",
      openingHours: tags.opening_hours ?? null,
    });
  }
  return places.sort((a, b) => a.distance - b.distance).slice(0, MAX_RESULTS);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

/** 걷는 시간 (분, 분당 70m) */
export function walkMinutes(m: number): number {
  return Math.max(1, Math.round(m / 70));
}

/** 네이버 지도: 좌표 근처에서 검색 */
export function naverSearchUrl(query: string, near?: { lat: number; lng: number }): string {
  const q = encodeURIComponent(query);
  return near
    ? `https://map.naver.com/p/search/${q}?c=${near.lng},${near.lat},16,0,0,0,dh`
    : `https://map.naver.com/p/search/${q}`;
}

/** 카카오맵 검색 */
export function kakaoSearchUrl(query: string): string {
  return `https://map.kakao.com/?q=${encodeURIComponent(query)}`;
}

/** 지도 앱에서 볼 검색어 — 장소 이름이 있으면 '장소 맛집' */
export function nearbyQuery(base: { name?: string | null; area?: string | null }): string {
  const where = [base.area, base.name].filter(Boolean).join(" ").trim();
  return where ? `${where} 맛집` : "맛집";
}
