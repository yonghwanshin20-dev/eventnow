import type {
  Event,
  EventAmenities,
  EventCategory,
  EventListItem,
  EventMapPoint,
  EventStatus,
  PlaceType,
  RegionCode,
  TargetAgeGroup,
} from "@/types/event";
import {
  REGION_OPTIONS,
  SUBREGIONS_BY_REGION,
  detectSubregion,
  matchesSubregion,
  regionShortLabel,
} from "@/data/regions";
import {
  computeStatus,
  dateWindow,
  daysBetween,
  isIsoDate,
  isMonthScale,
  overlaps,
  todayKst,
  type WhenFilter,
} from "@/lib/dates";

export const CATEGORY_OPTIONS: {
  value: EventCategory | "all";
  label: string;
}[] = [
  { value: "all", label: "전체" },
  { value: "festival", label: "축제" },
  { value: "exhibition", label: "전시" },
  { value: "popup", label: "팝업" },
  { value: "kids_experience", label: "키즈 체험" },
];

export const AGE_GROUP_OPTIONS: {
  value: TargetAgeGroup | "all";
  label: string;
}[] = [
  { value: "all", label: "전 연령" },
  { value: "toddler", label: "영유아" },
  { value: "kids", label: "미취학" },
  { value: "elementary", label: "초등 이상" },
];

export const PLACE_TYPE_OPTIONS: {
  value: PlaceType;
  label: string;
  description: string;
}[] = [
  {
    value: "amusement_park",
    label: "놀이공원",
    description: "테마파크·워터파크",
  },
  {
    value: "park_playground",
    label: "공원·놀이터",
    description: "한강·도시공원·놀이터",
  },
  {
    value: "forest_recreation",
    label: "숲체원·휴양림",
    description: "숲체험·자연휴양림·수목원",
  },
  {
    value: "cultural_center",
    label: "문화센터",
    description: "강좌·프로그램 사전 확인",
  },
  {
    value: "temple",
    label: "사찰·절",
    description: "사찰·암자 나들이",
  },
  {
    value: "historical",
    label: "역사 장소",
    description: "궁·유적·역사관",
  },
  {
    value: "nature_science",
    label: "자연·과학",
    description: "자연사·과학·식물원",
  },
];

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  popup: "팝업",
  exhibition: "전시",
  festival: "축제",
  kids_experience: "키즈 체험",
};

export const STATUS_LABELS: Record<EventStatus, string> = {
  upcoming: "예정",
  ongoing: "진행 중",
  ended: "종료",
};

export const AGE_GROUP_LABELS: Record<TargetAgeGroup, string> = {
  all: "전 연령",
  toddler: "영유아",
  kids: "미취학",
  elementary: "초등 이상",
};

/** 연령대 → 만 나이 범위 (세부 나이가 적힌 행사와 비교할 때) */
export const AGE_GROUP_YEARS: Record<Exclude<TargetAgeGroup, "all">, [number, number]> = {
  toddler: [0, 3],
  kids: [4, 7],
  elementary: [8, 13],
};

/**
 * 세부 대상 나이 문구: "만 4~7세", "36개월 이상", "6세 이상", "7세 이하", "24~48개월".
 * 두 살 아래는 개월로 쓰는 게 자연스러워 개월로 보여준다.
 */
export function formatAgeRange(min: number | null | undefined, max: number | null | undefined): string | null {
  if (min == null && max == null) return null;
  const months = (min ?? max!) < 2;
  const fmt = (v: number) => (months ? `${Math.round(v * 12)}` : `${Math.round(v * 10) / 10}`);
  const unit = months ? "개월" : "세";
  if (min != null && max != null) return `${months ? "" : "만 "}${fmt(min)}~${fmt(max)}${unit}`;
  if (min != null) return `${fmt(min)}${unit} 이상`;
  return `${fmt(max!)}${unit} 이하`;
}

export const AMENITY_META: {
  key: keyof EventAmenities;
  label: string;
}[] = [
  { key: "parking", label: "주차" },
  { key: "stroller", label: "유모차" },
  { key: "nursing_room", label: "수유실" },
];

export function formatDateRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString("ko-KR", {
      month: "short",
      day: "numeric",
    });
  };
  if (start === end) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

/** "10.19 – 10.25" (해가 다르면 "12.20 – 27.1.10") */
export function formatShortRange(start: string, end: string): string {
  const md = (iso: string) => `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;
  if (start === end) return md(start);
  const endLabel =
    start.slice(0, 4) === end.slice(0, 4) ? md(end) : `${end.slice(2, 4)}.${md(end)}`;
  return `${md(start)} – ${endLabel}`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const BRACKET_PREFIX = /^\s*[[【]([^\]】]{1,30})[\]】]\s*(.+)$/;

/**
 * 카드·빠른 보기용 제목: 앞의 '[소마미술관]', '[상설]' 같은 꼬리표를 뗀다
 * (장소·상시 여부는 카드에 따로 보이므로). 남는 제목이 너무 짧으면 그대로 둔다.
 */
export function displayTitle(title: string): string {
  const m = title.match(BRACKET_PREFIX);
  if (!m) return title;
  const rest = m[2].trim();
  return rest.length >= 4 ? rest : title;
}

/** "10.19(일) – 10.25(토)" */
export function formatLongRange(start: string, end: string): string {
  const fmt = (iso: string) => {
    const wd = WEEKDAYS[new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay()];
    return `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}(${wd})`;
  };
  if (start === end) return `${start.slice(0, 4)}.${fmt(start)}`;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${fmt(start)} – ${sameYear ? "" : `${end.slice(0, 4)}.`}${fmt(end)}`;
}

/**
 * 장소 두 줄: 주 표시와 보조 표시가 같은 말을 반복하지 않게 정리한다.
 * - 장소명이 주소 앞부분일 뿐("서울특별시 종로구") → 주소 한 줄
 * - 주소가 '지역 + 장소명'일 뿐("서울 노원문화원") → 장소명 + 지역
 * - 그 외 → 장소명 + 주소
 */
export function placeLines(
  event: Pick<Event, "location_name" | "address" | "region" | "district" | "dong">,
): { main: string; sub: string | null } {
  const name = event.location_name?.trim() ?? "";
  const address = event.address?.trim() ?? "";
  const sub = detectSubregion(event.region, address, event.district);
  const area = [regionShortLabel(event.region), sub, sub ? event.dong : null].filter(Boolean).join(" ");
  if (!address) return { main: name || area, sub: name ? area : null };
  if (!name || address.startsWith(name)) return { main: address, sub: null };
  if (address.endsWith(name)) return { main: name, sub: area || null };
  return { main: name, sub: address };
}

export function isFreePrice(price: string | null | undefined): boolean {
  if (!price) return false;
  const p = price.trim();
  return p.includes("무료") && !p.startsWith("유료");
}

export type WhenTone = "urgent" | "soon" | "live" | "upcoming" | "always" | "approx" | "ended";

/** 상시 운영 장소 vs 기간 한정 행사 */
export type ScheduleType = "permanent" | "limited";
export type ScheduleTypeFilter = ScheduleType | "all";

export const SCHEDULE_TYPE_OPTIONS: {
  value: ScheduleTypeFilter;
  label: string;
  description: string;
}[] = [
  { value: "all", label: "전체", description: "기간 한정 행사와 상시 운영 장소 모두" },
  {
    value: "limited",
    label: "기간 한정",
    description: "날짜가 정해진 축제·전시·팝업·체험",
  },
  {
    value: "permanent",
    label: "상시 운영",
    description: "언제든 갈 수 있는 공원·박물관·상설전시",
  },
];

const PERMANENT_MARK = /상설|상시/;
/** 1년 내내 여는 곳으로 볼 기간 */
const YEAR_ROUND_DAYS = 330;
/** 장소 유형이 있는 비축제 항목은 이 기간 이상이면 상시 운영 장소로 본다 */
const PLACE_LIKE_DAYS = 180;
/** 공식 출처 — 날짜를 믿을 수 있음 */
// 매일 원본 목록과 다시 맞춰 보는 출처 (팝플리는 공공 출처는 아니지만 날짜를 매일 원본에서 다시 읽는다)
const OFFICIAL_SOURCES = new Set([
  "kfes",
  "culture_portal",
  "seoul_portal",
  "mcst_festival",
  "city_calendar",
  "public_data",
  "venue_fair",
  "tour_api",
  "seoul_api",
  "popply",
]);

/** 매일 공식 목록(축제 달력·문화포털 등)과 맞춰 보는 행사인지 — 아니면 일정을 자동으로 확인할 수 없다 */
export function isOfficialSource(source: string | null | undefined): boolean {
  return Boolean(source && OFFICIAL_SOURCES.has(source));
}

type ScheduleFields = Pick<Event, "title" | "tags" | "start_date" | "end_date"> &
  Partial<Pick<Event, "category" | "place_types" | "source">>;

function eventDurationDays(event: ScheduleFields): number {
  return daysBetween(event.start_date, event.end_date) + 1;
}

/**
 * 상시 운영: 제목·태그에 상설/상시가 있거나, 1년 내내 열거나,
 * 장소 유형(공원·박물관 등)이 있는 비축제 항목이 반년 이상 열 때.
 * 축제는 길어도(예: 192일 연극제) 기간 한정으로 본다.
 */
export function getScheduleType(event: ScheduleFields): ScheduleType {
  const tags = (event.tags ?? []).join(" ");
  if (PERMANENT_MARK.test(tags) || PERMANENT_MARK.test(event.title)) return "permanent";
  const days = eventDurationDays(event);
  if (days >= YEAR_ROUND_DAYS) return "permanent";
  if (
    event.category !== "festival" &&
    (event.place_types ?? []).length > 0 &&
    days >= PLACE_LIKE_DAYS
  ) {
    return "permanent";
  }
  return "limited";
}

/**
 * 공식 출처가 아닌데 '1일~말일' 한 달 통째로 잡힌 일정 — 실제 날짜를 모르는 임시값.
 * 정확한 날짜처럼 보여주지 않는다.
 */
export function isApproxDates(event: ScheduleFields): boolean {
  // 시·군청 연간 일정표는 날짜가 '미정'이면 그달 전체로 넣으므로 공식 출처여도 날짜 미정일 수 있다
  if (event.source && OFFICIAL_SOURCES.has(event.source) && event.source !== "city_calendar") {
    return false;
  }
  const [sy, sm, sd] = event.start_date.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = event.end_date.slice(0, 10).split("-").map(Number);
  const lastDay = new Date(Date.UTC(ey, em, 0)).getUTCDate();
  return sy === ey && sm === em && sd === 1 && ed === lastDay;
}

/** 카드·상세에 보여줄 남은 기간 라벨 (진행 중/예정보다 구체적으로) */
export function whenLabel(
  event: ScheduleFields,
  today: string = todayKst(),
): { text: string; tone: WhenTone } {
  const status = computeStatus(event.start_date, event.end_date, today);
  if (status === "ended") return { text: "종료", tone: "ended" };
  if (getScheduleType(event) === "permanent") return { text: "상시 운영", tone: "always" };
  if (isApproxDates(event)) return { text: "날짜 미정", tone: "approx" };
  if (status === "upcoming") {
    const n = daysBetween(today, event.start_date);
    if (n === 1) return { text: "내일 시작", tone: "upcoming" };
    if (n <= 30) return { text: `D-${n}`, tone: "upcoming" };
    return { text: `${formatShortRange(event.start_date, event.start_date)} 시작`, tone: "upcoming" };
  }
  const left = daysBetween(today, event.end_date);
  if (left === 0) return { text: "오늘 마감", tone: "urgent" };
  if (left <= 7) return { text: `${left}일 남음`, tone: "soon" };
  return { text: "진행 중", tone: "live" };
}

/** 빠른 보기의 한 줄 안내: "오늘 열려요 · 이번 주말에도 열려요" (상시·날짜 미정은 없음) */
export function scheduleHint(
  event: Pick<Event, "start_date" | "end_date">,
  kind: { permanent: boolean; approx: boolean },
  today: string = todayKst(),
): string | null {
  if (kind.permanent || kind.approx) return null;
  const status = computeStatus(event.start_date, event.end_date, today);
  if (status === "ended") return null;
  const weekend = dateWindow("weekend", today);
  const openWeekend = overlaps(event.start_date, event.end_date, weekend);
  const isWeekendToday = weekend[0] === today;
  if (status === "ongoing") {
    if (openWeekend && !isWeekendToday) return "오늘 열려요 · 이번 주말에도 열려요";
    return "오늘 열려요";
  }
  return openWeekend ? "이번 주말에 열려요" : null;
}

/** 카드에 쓰는 일정 문구: 기간 한정은 날짜, 상시는 '언제든 방문', 임시 일정은 경고 */
export function scheduleText(event: ScheduleFields): string {
  if (getScheduleType(event) === "permanent") return "언제든 방문";
  if (isApproxDates(event)) return `${Number(event.start_date.slice(5, 7))}월 중`;
  return formatShortRange(event.start_date, event.end_date);
}

export type FamilyTagFilter = "indoor" | "outdoor" | "experience" | null;
export type SortOption = "recommended" | "ending_soon" | "newest" | "near";

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "recommended", label: "추천순" },
  { value: "ending_soon", label: "마감 임박" },
  { value: "newest", label: "최신 등록" },
  { value: "near", label: "가까운 순" },
];

export const WHEN_OPTIONS: { value: WhenFilter; label: string }[] = [
  { value: "today", label: "오늘" },
  { value: "weekend", label: "이번 주말" },
  { value: "next_weekend", label: "다음 주말" },
  { value: "week", label: "이번 주" },
  { value: "this_month", label: "이번 달" },
  { value: "next_month", label: "다음 달" },
  { value: "month", label: "한 달 내" },
];

/** "언제 갈까" 계획 타일에 쓰는 기간 (자주 묻는 질문 순서) */
export const PLAN_WHENS = ["weekend", "next_weekend", "this_month", "next_month"] as const satisfies readonly WhenFilter[];

/** 기간 필터의 실제 날짜를 짧게: "10.24–25", "11월" */
export function whenRangeText(when: WhenFilter, today: string = todayKst()): string {
  const [from, to] = dateWindow(when, today);
  if (when === "next_month") return `${Number(from.slice(5, 7))}월`;
  if (when === "this_month") return `~${Number(to.slice(5, 7))}.${Number(to.slice(8, 10))}`;
  return formatShortRange(from, to);
}

/** 이 기간에 쓸 이름: 다음 달은 "11월"처럼 달 이름으로 */
export function whenTitle(when: WhenFilter, today: string = todayKst()): string {
  if (when === "next_month") return `${Number(dateWindow(when, today)[0].slice(5, 7))}월`;
  if (when === "this_month") return `이번 달 (${Number(today.slice(5, 7))}월)`;
  return WHEN_OPTIONS.find((o) => o.value === when)?.label ?? "";
}

export const PAGE_SIZE = 24;
/** URL의 n(불러온 개수) 상한 — 데이터 전체보다 넉넉하게 ('더 보기'가 멈추지 않게) */
const MAX_LIMIT = 3000;

export interface ExplorerFilters {
  q: string;
  category: EventCategory | "all";
  scheduleType: ScheduleTypeFilter;
  /** 고른 시·도 (여러 개 가능, 비면 전국) */
  regions: RegionCode[];
  /**
   * 고른 구·군·시 — "경기도:의정부시" 꼴 (여러 개 가능).
   * 어떤 시·도에서 구·시를 하나라도 골랐으면 그 시·도는 고른 구·시만, 안 골랐으면 시·도 전체.
   */
  subregions: string[];
  when: WhenFilter | null;
  /** 특정 날짜 (YYYY-MM-DD) — when보다 우선 */
  date: string | null;
  includeEnded: boolean;
  familyFriendlyOnly: boolean;
  targetAgeGroup: TargetAgeGroup | "all";
  amenities: Partial<Record<keyof EventAmenities, boolean>>;
  familyTag: FamilyTagFilter;
  placeTypes: PlaceType[];
  /** 찜만 보기 — 찜한 id 목록 */
  favorites: string[];
  sort: SortOption;
  /** 가까운 순 기준 좌표 */
  near: { lat: number; lng: number } | null;
  limit: number;
  view: ExplorerView;
}

/** 목록 · 지도 · 달력 */
export type ExplorerView = "list" | "map" | "calendar";

export const DEFAULT_EXPLORER_FILTERS: ExplorerFilters = {
  q: "",
  category: "all",
  scheduleType: "all",
  regions: [],
  subregions: [],
  when: null,
  date: null,
  includeEnded: false,
  familyFriendlyOnly: false,
  targetAgeGroup: "all",
  amenities: {},
  familyTag: null,
  placeTypes: [],
  favorites: [],
  sort: "recommended",
  near: null,
  limit: PAGE_SIZE,
  view: "list",
};

const CATEGORY_VALUES = new Set(
  CATEGORY_OPTIONS.map((o) => o.value).filter((v) => v !== "all"),
);
const SCHEDULE_VALUES = new Set<ScheduleTypeFilter>([
  "all",
  "permanent",
  "limited",
]);
const PLACE_TYPE_VALUES = new Set(PLACE_TYPE_OPTIONS.map((o) => o.value));
const AGE_VALUES = new Set(AGE_GROUP_OPTIONS.map((o) => o.value));
const FAMILY_TAG_VALUES = new Set(["indoor", "outdoor", "experience"]);
const AMENITY_KEYS = AMENITY_META.map((m) => m.key);
const REGION_VALUES = new Set(REGION_OPTIONS.map((o) => o.value));
const SORT_VALUES = new Set(SORT_OPTIONS.map((o) => o.value));
const WHEN_VALUES = new Set(WHEN_OPTIONS.map((o) => o.value));

/** 구·시 선택 값: "경기도:의정부시" */
export function subregionKey(region: RegionCode, sub: string): string {
  return `${region}:${sub}`;
}

export function parseSubregionKey(key: string): { region: RegionCode; sub: string } {
  const [region, sub] = key.split(":", 2);
  return { region: region as RegionCode, sub };
}

/**
 * 지역 여러 개 고르기: 고른 시·도 중 하나에 들고, 그 시·도에서 구·시를 골랐다면 그중 하나에 들어야 한다.
 * (서울 전체 + 경기 의정부·포천 처럼 섞어 고를 수 있다)
 */
export function matchesRegions(
  event: Pick<Event, "region" | "address" | "district" | "location_name">,
  regions: RegionCode[],
  subregions: string[],
): boolean {
  if (regions.length === 0) return true;
  if (!regions.includes(event.region)) return false;
  const subs = subregions
    .map(parseSubregionKey)
    .filter((s) => s.region === event.region)
    .map((s) => s.sub);
  return subs.length === 0 || subs.some((sub) => matchesSubregion(event, sub));
}

/** 필터 → URL 쿼리 (기본값 필드는 생략) */
export function filtersToSearchParams(filters: ExplorerFilters): URLSearchParams {
  const p = new URLSearchParams();
  const q = filters.q.trim();
  if (q) p.set("q", q);
  if (filters.category !== "all") p.set("category", filters.category);
  if (filters.scheduleType !== "all") p.set("schedule", filters.scheduleType);
  if (filters.regions.length > 0) p.set("region", filters.regions.join(","));
  if (filters.subregions.length > 0) p.set("sub", filters.subregions.join(","));
  if (filters.date) p.set("date", filters.date);
  else if (filters.when) p.set("when", filters.when);
  if (filters.includeEnded) p.set("ended", "1");
  if (filters.familyFriendlyOnly) p.set("family", "1");
  if (filters.targetAgeGroup !== "all") p.set("age", filters.targetAgeGroup);
  if (filters.familyTag) p.set("ftag", filters.familyTag);
  if (filters.placeTypes.length > 0) {
    p.set("place", filters.placeTypes.join(","));
  }
  for (const key of AMENITY_KEYS) {
    if (filters.amenities[key]) p.set(key, "1");
  }
  if (filters.favorites.length > 0) p.set("fav", filters.favorites.join(","));
  if (filters.sort !== "recommended") p.set("sort", filters.sort);
  if (filters.sort === "near" && filters.near) {
    p.set("near", `${filters.near.lat.toFixed(4)},${filters.near.lng.toFixed(4)}`);
  }
  if (filters.limit !== PAGE_SIZE) p.set("n", String(filters.limit));
  if (filters.view !== "list") p.set("view", filters.view);
  return p;
}

/** Next.js ReadonlyURLSearchParams / 서버 searchParams 호환 */
type SearchParamsLike =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

function getter(params: SearchParamsLike): (name: string) => string | null {
  if (typeof (params as { get?: unknown }).get === "function") {
    return (name) => (params as { get(n: string): string | null }).get(name);
  }
  return (name) => {
    const v = (params as Record<string, string | string[] | undefined>)[name];
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  };
}

function parseNear(raw: string | null): ExplorerFilters["near"] {
  if (!raw) return null;
  const [lat, lng] = raw.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/** URL 쿼리 → 필터 */
export function searchParamsToFilters(params: SearchParamsLike): ExplorerFilters {
  const get = getter(params);
  const category = get("category");
  const schedule = get("schedule");
  const region = get("region");
  const age = get("age");
  const ftag = get("ftag");
  const when = get("when");
  const date = get("date");
  const sort = get("sort");
  const n = Number(get("n"));

  const amenities: Partial<Record<keyof EventAmenities, boolean>> = {};
  for (const key of AMENITY_KEYS) {
    if (get(key) === "1") amenities[key] = true;
  }

  const placeTypes = (get("place") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is PlaceType => PLACE_TYPE_VALUES.has(s as PlaceType));

  const favorites = (get("fav") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);

  const parsedRegions = [
    ...new Set(
      (region ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is RegionCode => s !== "all" && REGION_VALUES.has(s as RegionCode)),
    ),
  ];
  // 구·시: "경기도:의정부시" 꼴. 예전 링크(region=…&sub=의정부시)도 받는다.
  // 고른 시·도의 실제 구·시 이름만 받는다 (아무 글자나 제목·미리보기 그림에 찍히지 않게)
  const rawSubs = (get("sub") || get("district") || get("gycity") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const parsedSubs = [
    ...new Set(
      rawSubs
        .map((s) => {
          const [r, name] = s.includes(":") ? s.split(":", 2) : [parsedRegions[0] ?? "", s];
          return parsedRegions.includes(r as RegionCode) &&
            SUBREGIONS_BY_REGION[r as RegionCode].includes(name)
            ? subregionKey(r as RegionCode, name)
            : null;
        })
        .filter((s): s is string => s != null),
    ),
  ];

  return {
    q: (get("q") ?? "").slice(0, 100),
    category:
      category && CATEGORY_VALUES.has(category as EventCategory)
        ? (category as EventCategory)
        : "all",
    scheduleType:
      schedule && SCHEDULE_VALUES.has(schedule as ScheduleTypeFilter)
        ? (schedule as ScheduleTypeFilter)
        : "all",
    regions: parsedRegions,
    subregions: parsedSubs,
    when: when && WHEN_VALUES.has(when as WhenFilter) ? (when as WhenFilter) : null,
    date: isIsoDate(date) ? date : null,
    includeEnded: get("ended") === "1",
    familyFriendlyOnly: get("family") === "1",
    targetAgeGroup:
      age && AGE_VALUES.has(age as TargetAgeGroup | "all")
        ? (age as TargetAgeGroup | "all")
        : "all",
    amenities,
    familyTag:
      ftag && FAMILY_TAG_VALUES.has(ftag)
        ? (ftag as NonNullable<FamilyTagFilter>)
        : null,
    placeTypes,
    favorites,
    sort: sort && SORT_VALUES.has(sort as SortOption) ? (sort as SortOption) : "recommended",
    near: parseNear(get("near")),
    limit:
      Number.isInteger(n) && n > 0
        ? Math.min(Math.ceil(n / PAGE_SIZE) * PAGE_SIZE, MAX_LIMIT)
        : PAGE_SIZE,
    view: get("view") === "map" ? "map" : get("view") === "calendar" ? "calendar" : "list",
  };
}

export function filtersToQueryString(filters: ExplorerFilters): string {
  const q = filtersToSearchParams(filters).toString();
  return q ? `?${q}` : "";
}

/** 활성 필터 개수 (모바일 접기 버튼 배지용) */
export function countActiveFilters(filters: ExplorerFilters): number {
  let n = 0;
  if (filters.category !== "all") n++;
  if (filters.scheduleType !== "all") n++;
  n += filters.regions.length;
  n += filters.subregions.length;
  if (filters.when || filters.date) n++;
  if (filters.includeEnded) n++;
  if (filters.familyFriendlyOnly) n++;
  if (filters.targetAgeGroup !== "all") n++;
  if (filters.familyTag) n++;
  n += filters.placeTypes.length;
  n += Object.values(filters.amenities).filter(Boolean).length;
  return n;
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/**
 * 검색어 → 같이 찾을 말. 사람들이 쓰는 말과 데이터의 말이 달라 못 찾는 경우를 줄인다
 * (예: '불꽃놀이' → 데이터는 '불꽃축제', '아이' → '어린이·키즈').
 */
const SEARCH_SYNONYMS: Record<string, string[]> = {
  불꽃놀이: ["불꽃"],
  아이: ["아이", "어린이", "키즈", "유아", "아동", "가족"],
  아이랑: ["아이", "어린이", "키즈", "가족"],
  어린이: ["어린이", "아이", "키즈", "아동"],
  키즈: ["키즈", "어린이", "아이"],
  가족: ["가족", "어린이", "아이"],
  전시회: ["전시"],
  페스티벌: ["페스티벌", "축제"],
  축제: ["축제", "페스티벌", "문화제"],
  팝업스토어: ["팝업"],
  공연: ["공연", "콘서트", "뮤지컬", "연극", "음악회"],
  체험: ["체험", "만들기", "클래스", "교실"],
  꽃: ["꽃", "국화", "장미", "벚꽃", "튤립", "억새", "코스모스", "유채"],
  야경: ["야경", "야간", "빛", "달빛", "별빛"],
  빛축제: ["빛축제", "빛", "미디어아트", "야간"],
  공원: ["공원", "놀이터", "숲"],
};

function searchBlob(event: Event): string {
  const placeLabels = PLACE_TYPE_OPTIONS.filter((o) => (event.place_types ?? []).includes(o.value))
    .map((o) => o.label)
    .join(" ");
  return normalizeText(
    [
      event.title,
      event.location_name,
      event.address,
      event.district ?? "",
      (event.tags ?? []).join(" "),
      CATEGORY_LABELS[event.category],
      event.region,
      regionShortLabel(event.region),
      placeLabels,
      event.price_info ?? "",
      // 소개글에만 나오는 말('공룡 화석', '도자기 만들기')도 찾게 — 앞부분만
      (event.description ?? "").slice(0, 300),
    ].join(" "),
  );
}

/**
 * 검색 결과에서 제목·장소에 검색어가 들어간 행사를 앞으로 (소개글에만 나온 것은 뒤로).
 * 순서는 각 묶음 안에서 그대로 둔다.
 */
export function rankByQuery(events: Event[], q: string): Event[] {
  const terms = q.split(/\s+/).map(normalizeText).filter(Boolean);
  if (terms.length === 0) return events;
  const strong = (e: Event) => {
    const head = normalizeText(`${e.title} ${e.location_name}`);
    return terms.some((t) => (SEARCH_SYNONYMS[t] ?? [t]).some((alt) => head.includes(alt)));
  };
  return [...events.filter(strong), ...events.filter((e) => !strong(e))];
}

function matchesQuery(event: Event, q: string): boolean {
  const terms = q
    .split(/\s+/)
    .map(normalizeText)
    .filter(Boolean);
  if (terms.length === 0) return true;
  const blob = searchBlob(event);
  // 단어마다 (그 단어 또는 같은 뜻의 말 중 하나가) 들어 있어야 한다
  return terms.every((t) => (SEARCH_SYNONYMS[t] ?? [t]).some((alt) => blob.includes(alt)));
}

const OUTDOOR_PLACES = new Set(["park_playground", "forest_recreation", "amusement_park"]);
const INDOOR_PLACES = new Set(["cultural_center", "nature_science"]);
const INDOOR_VENUE = /미술관|박물관|전시관|기념관|도서관|과학관|아쿠아리움|갤러리|아트홀|문화센터|문화회관|예술회관|복합문화|센터|홀$|실내/;

/**
 * 비 와도 갈 수 있는 곳인지 — 전시·팝업은 대부분 실내이고, 장소 이름(미술관·과학관·센터…)도 본다.
 * '야외'가 붙었거나 공원·숲·놀이공원이면 실내로 보지 않는다.
 */
export function isIndoor(
  event: Pick<Event, "category" | "tags" | "place_types" | "location_name">,
): boolean {
  const tags = event.tags ?? [];
  if (tags.some((t) => t.includes("실내"))) return true;
  if (tags.some((t) => t.includes("야외"))) return false;
  const types = event.place_types ?? [];
  if (types.some((t) => OUTDOOR_PLACES.has(t))) return false;
  if (event.category === "exhibition" || event.category === "popup") return true;
  if (types.some((t) => INDOOR_PLACES.has(t))) return true;
  return INDOOR_VENUE.test(event.location_name ?? "");
}

export function filterEvents(
  events: Event[],
  filters: ExplorerFilters,
  today: string = todayKst(),
): Event[] {
  const window: [string, string] | null = filters.date
    ? [filters.date, filters.date]
    : filters.when
      ? dateWindow(filters.when, today)
      : null;
  const favSet = filters.favorites.length > 0 ? new Set(filters.favorites) : null;

  return events.filter((event) => {
    if (favSet && !favSet.has(event.id)) return false;

    // 날짜로 계산한 상태 — 기본은 종료 행사 숨김 (찜 목록은 예외)
    const status = computeStatus(event.start_date, event.end_date, today);
    if (!filters.includeEnded && !favSet && status === "ended") return false;

    if (window && !overlaps(event.start_date, event.end_date, window)) {
      return false;
    }
    // 날짜를 모르는 행사(한 달 통째 임시 일정)는 '오늘·이번 주말' 같은 날짜 조건에 넣지 않는다
    // ('다음 달'처럼 한 달 단위로 볼 때는 '11월 중'이어도 계획에 도움이 되니 넣는다)
    const monthScale = !filters.date && isMonthScale(filters.when);
    if (window && !monthScale && isApproxDates(event)) return false;

    if (filters.q && !matchesQuery(event, filters.q)) return false;

    if (filters.category !== "all" && event.category !== filters.category) {
      return false;
    }

    if (
      filters.scheduleType !== "all" &&
      getScheduleType(event) !== filters.scheduleType
    ) {
      return false;
    }

    if (!matchesRegions(event, filters.regions, filters.subregions)) return false;

    if (filters.familyFriendlyOnly && !event.is_family_friendly) {
      return false;
    }

    // 세부 나이(age_min~age_max)가 있으면 그 범위로, 없으면 연령대로 거른다.
    // 연령 정보가 없는(null) 행사는 "전 연령"으로 간주해 남긴다
    if (filters.targetAgeGroup !== "all") {
      const [gLo, gHi] = AGE_GROUP_YEARS[filters.targetAgeGroup];
      if (event.age_min != null || event.age_max != null) {
        if ((event.age_max ?? 99) < gLo || (event.age_min ?? 0) > gHi) return false;
      } else if (
        event.target_age_group != null &&
        event.target_age_group !== "all" &&
        event.target_age_group !== filters.targetAgeGroup
      ) {
        return false;
      }
    }

    for (const [key, required] of Object.entries(filters.amenities)) {
      if (!required) continue;
      if (!event.amenities[key as keyof EventAmenities]) return false;
    }

    if (filters.placeTypes.length > 0) {
      const types = event.place_types ?? [];
      if (!filters.placeTypes.some((t) => types.includes(t))) return false;
    }

    if (filters.familyTag) {
      const tags = event.tags ?? [];
      const types = event.place_types ?? [];
      if (filters.familyTag === "indoor") {
        if (!isIndoor(event)) return false;
      } else if (filters.familyTag === "outdoor") {
        const outdoorish =
          types.some((t) =>
            [
              "park_playground",
              "forest_recreation",
              "amusement_park",
              "historical",
            ].includes(t),
          ) || tags.some((t) => t.includes("야외"));
        if (!outdoorish) return false;
      } else if (filters.familyTag === "experience") {
        const ok =
          event.category === "kids_experience" ||
          tags.some((t) => /체험|교육/.test(t));
        if (!ok) return false;
      }
    }

    return true;
  });
}

/** 두 좌표 사이 거리 (km, haversine) */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function eventDistanceKm(
  event: Pick<Event, "latitude" | "longitude">,
  near: { lat: number; lng: number } | null,
): number | null {
  if (!near || event.latitude == null || event.longitude == null) return null;
  return distanceKm(near, { lat: event.latitude, lng: event.longitude });
}

/**
 * 추천순: 진행 중 기간형(마감 임박 순) → 예정(가까운 시작 순) →
 * 진행 중 상시형 → 종료(최근 종료 순)
 */
function recommendedRank(event: Event, today: string): number {
  const status = computeStatus(event.start_date, event.end_date, today);
  if (status === "ongoing") {
    return getScheduleType(event) === "limited" ? 0 : 2;
  }
  return status === "upcoming" ? 1 : 3;
}

export function sortEvents(
  events: Event[],
  sort: SortOption,
  today: string = todayKst(),
  near: { lat: number; lng: number } | null = null,
): Event[] {
  const list = [...events];
  const byTitle = (a: Event, b: Event) => a.title.localeCompare(b.title, "ko");

  if (sort === "near" && near) {
    const dist = new Map(list.map((e) => [e.id, eventDistanceKm(e, near)]));
    return list.sort((a, b) => {
      const da = dist.get(a.id) ?? Infinity;
      const db = dist.get(b.id) ?? Infinity;
      return da - db || byTitle(a, b);
    });
  }

  if (sort === "newest") {
    return list.sort(
      (a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || byTitle(a, b),
    );
  }

  if (sort === "ending_soon") {
    return list.sort((a, b) => {
      const ea = computeStatus(a.start_date, a.end_date, today) === "ended";
      const eb = computeStatus(b.start_date, b.end_date, today) === "ended";
      if (ea !== eb) return ea ? 1 : -1;
      return a.end_date.localeCompare(b.end_date) || byTitle(a, b);
    });
  }

  return list.sort((a, b) => {
    const ra = recommendedRank(a, today);
    const rb = recommendedRank(b, today);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a.end_date.localeCompare(b.end_date) || byTitle(a, b);
    if (ra === 1) return a.start_date.localeCompare(b.start_date) || byTitle(a, b);
    if (ra === 3) return b.end_date.localeCompare(a.end_date) || byTitle(a, b);
    return byTitle(a, b);
  });
}

/**
 * 앞으로의 기간(다음 주말·다음 달)을 계획할 때의 추천 순서:
 * 그 기간에 새로 시작하는 행사 → 기간이 짧은(그때만 볼 수 있는) 행사 순.
 * 몇 달째 하는 전시보다 '그 주말에만 하는 축제'가 계획에 더 쓸모 있다.
 */
export function sortForPlan(events: Event[], when: WhenFilter, today: string = todayKst()): Event[] {
  const [from, to] = dateWindow(when, today);
  const span = (e: Event) => daysBetween(e.start_date.slice(0, 10), e.end_date.slice(0, 10));
  return [...events].sort((a, b) => {
    const na = a.start_date >= from && a.start_date <= to ? 0 : 1;
    const nb = b.start_date >= from && b.start_date <= to ? 0 : 1;
    if (na !== nb) return na - nb;
    return span(a) - span(b) || a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title, "ko");
  });
}

/** 추천순일 때 계획용 순서를 쓰는 기간 */
export const PLAN_SORT_WHENS = new Set<WhenFilter>(["next_weekend", "next_month"]);

export function toListItem(
  event: Event,
  near: { lat: number; lng: number } | null = null,
  today: string = todayKst(),
): EventListItem {
  return {
    id: event.id,
    title: event.title,
    category: event.category,
    start_date: event.start_date,
    end_date: event.end_date,
    location_name: event.location_name,
    address: event.address,
    region: event.region,
    district: event.district,
    dong: event.dong ?? null,
    is_family_friendly: event.is_family_friendly,
    target_age_group: event.target_age_group ?? null,
    age_min: event.age_min ?? null,
    age_max: event.age_max ?? null,
    booking_required: event.booking_required,
    thumbnail_url: event.thumbnail_url,
    place_types: event.place_types ?? [],
    status: computeStatus(event.start_date, event.end_date, today),
    // 빠른 보기 시트에 필요한 만큼만 (설명은 앞부분만 보내 전송량을 줄인다)
    description: event.description ? event.description.slice(0, 320) : null,
    price_info: event.price_info,
    official_link: event.official_link,
    source: event.source ?? null,
    distance_km: eventDistanceKm(event, near),
    when: whenLabel(event, today),
    is_free: isFreePrice(event.price_info),
    schedule: getScheduleType(event),
    date_text: scheduleText(event),
    coords:
      event.latitude != null && event.longitude != null
        ? [Number(event.latitude), Number(event.longitude)]
        : null,
  };
}

export function toMapPoint(event: Event): EventMapPoint | null {
  if (event.latitude == null || event.longitude == null) return null;
  return {
    id: event.id,
    title: event.title,
    category: event.category,
    start_date: event.start_date,
    end_date: event.end_date,
    latitude: Number(event.latitude),
    longitude: Number(event.longitude),
  };
}