import { describe, expect, it } from "vitest";

import { detectRegionFromAddress, matchesSubregion } from "@/data/regions";
import {
  DEFAULT_EXPLORER_FILTERS,
  PAGE_SIZE,
  rankAttractions,
  filterEvents,
  filtersToSearchParams,
  formatLongRange,
  formatShortRange,
  getScheduleType,
  isApproxDates,
  isFreePrice,
  scheduleText,
  whenLabel,
  searchParamsToFilters,
  sortEvents,
  type ExplorerFilters,
} from "@/lib/events";
import { buildIcs } from "@/lib/ics";
import { resolveInfoUrl } from "@/lib/links";
import type { Event } from "@/types/event";

const TODAY = "2026-10-19";

function ev(overrides: Partial<Event>): Event {
  return {
    id: overrides.id ?? "e1",
    title: "테스트 축제",
    category: "festival",
    description: null,
    start_date: "2026-10-01",
    end_date: "2026-10-31",
    location_name: "테스트 공원",
    address: "서울특별시 중구 세종대로 110",
    latitude: null,
    longitude: null,
    region: "서울특별시",
    district: null,
    is_family_friendly: true,
    target_age_group: null,
    amenities: { parking: false, stroller: false, nursing_room: false },
    booking_required: false,
    price_info: null,
    thumbnail_url: null,
    official_link: null,
    tags: [],
    place_types: [],
    status: "ongoing",
    created_at: "2026-07-28T00:00:00Z",
    updated_at: "2026-07-28T00:00:00Z",
    ...overrides,
  };
}

const f = (o: Partial<ExplorerFilters>): ExplorerFilters => ({
  ...DEFAULT_EXPLORER_FILTERS,
  ...o,
});

describe("filterEvents", () => {
  const ended = ev({ id: "ended", end_date: "2026-10-18", status: "ongoing" });
  const live = ev({ id: "live" });

  it("저장된 status가 낡아도 날짜로 종료를 판단해 기본 숨김", () => {
    expect(filterEvents([ended, live], f({}), TODAY).map((e) => e.id)).toEqual(["live"]);
  });

  it("종료 포함을 켜면 보인다", () => {
    expect(filterEvents([ended, live], f({ includeEnded: true }), TODAY)).toHaveLength(2);
  });

  it("찜 목록은 종료 행사도 보여준다", () => {
    expect(filterEvents([ended, live], f({ favorites: ["ended"] }), TODAY).map((e) => e.id)).toEqual([
      "ended",
    ]);
  });

  it("부산 서구 필터가 강서구 행사를 잡지 않는다", () => {
    const gangseo = ev({ id: "gs", region: "부산광역시", address: "부산광역시 강서구 낙동북로 1" });
    const seo = ev({ id: "s", region: "부산광역시", address: "부산광역시 서구 구덕로 1" });
    const filters = f({ regions: ["부산광역시"], subregions: ["부산광역시:서구"] });
    expect(filterEvents([gangseo, seo], filters, TODAY).map((e) => e.id)).toEqual(["s"]);
    expect(matchesSubregion(gangseo, "강서구")).toBe(true);
  });

  it("지역 여러 개: 서울 전체 + 경기 의정부·포천만", () => {
    const seoul = ev({ id: "seoul", region: "서울특별시", address: "서울특별시 마포구 월드컵로 1" });
    const ui = ev({ id: "ui", region: "경기도", address: "경기도 의정부시 시민로 1" });
    const po = ev({ id: "po", region: "경기도", address: "경기도 포천시 중앙로 87" });
    const suwon = ev({ id: "suwon", region: "경기도", address: "경기도 수원시 팔달구 1" });
    const busan = ev({ id: "busan", region: "부산광역시", address: "부산광역시 서구 1" });
    const filters = f({
      regions: ["서울특별시", "경기도"],
      subregions: ["경기도:의정부시", "경기도:포천시"],
    });
    expect(filterEvents([seoul, ui, po, suwon, busan], filters, TODAY).map((e) => e.id)).toEqual([
      "seoul",
      "ui",
      "po",
    ]);
  });

  it("연령 정보 없는 행사는 연령 필터에서 빠지지 않는다", () => {
    const unknown = ev({ id: "u", target_age_group: null });
    const teen = ev({ id: "t", target_age_group: "elementary" });
    expect(filterEvents([unknown, teen], f({ targetAgeGroup: "toddler" }), TODAY).map((e) => e.id)).toEqual([
      "u",
    ]);
  });

  it("검색어는 공백·대소문자 무시, 모든 단어 포함", () => {
    const a = ev({ id: "a", title: "서울 불꽃 축제", location_name: "여의도 한강공원" });
    const b = ev({ id: "b", title: "서울 빛초롱" });
    expect(filterEvents([a, b], f({ q: "불꽃  여의도" }), TODAY).map((e) => e.id)).toEqual(["a"]);
    expect(filterEvents([a, b], f({ q: "한강 공원" }), TODAY).map((e) => e.id)).toEqual(["a"]);
  });

  it("검색은 같은 뜻의 말·종류·지역 이름도 찾는다", () => {
    const fire = ev({ id: "fire", title: "부산불꽃축제", region: "부산광역시", address: "부산광역시 수영구 광안해변로" });
    const kids = ev({ id: "kids", title: "어린이 과학교실", category: "kids_experience" });
    const art = ev({ id: "art", title: "빛의 정원", category: "exhibition" });
    expect(filterEvents([fire, kids, art], f({ q: "불꽃놀이" }), TODAY).map((e) => e.id)).toEqual(["fire"]);
    expect(filterEvents([fire, kids, art], f({ q: "아이" }), TODAY).map((e) => e.id)).toEqual(["kids"]);
    expect(filterEvents([fire, kids, art], f({ q: "전시" }), TODAY).map((e) => e.id)).toEqual(["art"]);
    expect(filterEvents([fire, kids, art], f({ q: "부산" }), TODAY).map((e) => e.id)).toEqual(["fire"]);
  });

  it("날짜 미정(한 달 통째) 행사는 날짜 조건에 넣지 않는다", () => {
    const approx = ev({ id: "approx", start_date: "2026-10-01", end_date: "2026-10-31" });
    const real = ev({ id: "real", start_date: "2026-10-24", end_date: "2026-10-25" });
    expect(filterEvents([approx, real], f({ when: "weekend" }), TODAY).map((e) => e.id)).toEqual(["real"]);
    expect(filterEvents([approx, real], f({}), TODAY).map((e) => e.id)).toContain("approx");
  });

  it("'더 보기'가 수백 건 넘어도 멈추지 않는다", () => {
    expect(searchParamsToFilters({ n: "720" }).limit).toBe(720);
  });

  it("이번 주말 필터는 주말과 겹치는 행사만", () => {
    const weekdayOnly = ev({ id: "w", start_date: "2026-10-19", end_date: "2026-10-23" });
    const weekend = ev({ id: "we", start_date: "2026-10-24", end_date: "2026-10-24" });
    expect(filterEvents([weekdayOnly, weekend], f({ when: "weekend" }), TODAY).map((e) => e.id)).toEqual([
      "we",
    ]);
  });
});

describe("sortEvents", () => {
  it("추천순: 진행 중 기간형(마감 임박) → 예정 → 상시형", () => {
    const permanent = ev({ id: "perm", start_date: "2026-01-01", end_date: "2027-12-31" });
    const soon = ev({ id: "soon", end_date: "2026-10-20" });
    const later = ev({ id: "later", end_date: "2026-10-30" });
    const upcoming = ev({ id: "up", start_date: "2026-11-01", end_date: "2026-11-02" });
    expect(sortEvents([permanent, upcoming, later, soon], "recommended", TODAY).map((e) => e.id)).toEqual([
      "soon",
      "later",
      "up",
      "perm",
    ]);
  });

  it("가까운 순: 좌표 없는 행사는 뒤로", () => {
    const far = ev({ id: "far", latitude: 35.1, longitude: 129.0 });
    const near = ev({ id: "near", latitude: 37.57, longitude: 126.98 });
    const none = ev({ id: "none" });
    expect(
      sortEvents([none, far, near], "near", TODAY, { lat: 37.56, lng: 126.97 }).map((e) => e.id),
    ).toEqual(["near", "far", "none"]);
  });
});

describe("URL 직렬화", () => {
  it("왕복 변환이 같은 필터를 만든다", () => {
    const filters = f({
      q: "불꽃",
      regions: ["경기도", "서울특별시"],
      subregions: ["경기도:광주시", "경기도:포천시"],
      when: "weekend",
      includeEnded: true,
      sort: "near",
      near: { lat: 37.5, lng: 127 },
      limit: PAGE_SIZE * 2,
      view: "map",
      amenities: { parking: true },
    });
    const params = filtersToSearchParams(filters);
    expect(searchParamsToFilters(params)).toEqual(filters);
  });

  it("서버 searchParams 객체도 읽는다", () => {
    expect(searchParamsToFilters({ category: "popup", n: "30" })).toMatchObject({
      category: "popup",
      limit: PAGE_SIZE * 2,
    });
  });

  it("알 수 없는 지역 값은 무시", () => {
    expect(searchParamsToFilters({ region: "<script>" }).regions).toEqual([]);
  });

  it("예전 한 지역 링크(region=…&sub=…)도 그대로 읽는다", () => {
    expect(searchParamsToFilters({ region: "경기도", sub: "의정부시" })).toMatchObject({
      regions: ["경기도"],
      subregions: ["경기도:의정부시"],
    });
    // 고르지 않은 시·도의 구·시는 버린다
    expect(searchParamsToFilters({ region: "서울특별시", sub: "경기도:의정부시" }).subregions).toEqual([]);
  });
});

describe("detectRegionFromAddress", () => {
  it("경기도 광주시는 광주광역시가 아니다", () => {
    expect(detectRegionFromAddress("경기도 광주시 퇴촌면")).toBe("경기도");
    expect(detectRegionFromAddress("경기 광주시 오포읍")).toBe("경기도");
  });
  it("광역시 정식 명칭", () => {
    expect(detectRegionFromAddress("광주광역시 북구 첨단로")).toBe("광주광역시");
  });
  it("전남광주통합특별시는 구 이름으로 나눈다", () => {
    expect(detectRegionFromAddress("전남광주통합특별시 북구 첨단과기로")).toBe("광주광역시");
    expect(detectRegionFromAddress("전남광주통합특별시 화순군 도곡면")).toBe("전라남도");
  });
  it("모르면 서울로 넘기지 않고 null", () => {
    expect(detectRegionFromAddress("주소 미상")).toBeNull();
  });
});

describe("카드 라벨", () => {
  it("남은 기간을 구체적으로", () => {
    expect(whenLabel(ev({ end_date: "2026-10-19" }), TODAY)).toEqual({ text: "오늘 마감", tone: "urgent" });
    expect(whenLabel(ev({ end_date: "2026-10-25" }), TODAY).text).toBe("6일 남음");
    expect(whenLabel(ev({ start_date: "2026-10-20", end_date: "2026-10-22" }), TODAY).text).toBe("내일 시작");
    expect(whenLabel(ev({ start_date: "2026-10-24", end_date: "2026-10-26" }), TODAY).text).toBe("D-5");
    expect(whenLabel(ev({ start_date: "2026-01-01", end_date: "2027-12-31" }), TODAY).text).toBe("상시 운영");
    expect(whenLabel(ev({ start_date: "2026-10-01", end_date: "2026-10-31" }), TODAY)).toEqual({
      text: "날짜 미정",
      tone: "approx",
    });
    expect(whenLabel(ev({ start_date: "2026-11-07", end_date: "2026-11-07" }), TODAY).text).toBe("D-19");
    expect(whenLabel(ev({ start_date: "2026-11-27", end_date: "2026-12-27" }), TODAY).text).toBe("11.27 시작");
    expect(whenLabel(ev({ end_date: "2026-10-18" }), TODAY).text).toBe("종료");
  });
  it("짧은 날짜 범위", () => {
    expect(formatShortRange("2026-10-01", "2026-10-31")).toBe("10.1 – 10.31");
    expect(formatShortRange("2026-12-20", "2027-01-10")).toBe("12.20 – 27.1.10");
    expect(formatLongRange("2026-10-24", "2026-10-25")).toBe("10.24(토) – 10.25(일)");
  });
  it("무료 판정", () => {
    expect(isFreePrice("무료(일부 유료)")).toBe(true);
    expect(isFreePrice("유료 (무료 입장 시간 있음)")).toBe(false);
    expect(isFreePrice(null)).toBe(false);
  });
});

describe("상시 운영 vs 기간 한정", () => {
  it("길어도 축제는 기간 한정", () => {
    expect(getScheduleType(ev({ category: "festival", start_date: "2026-04-01", end_date: "2026-10-09" }))).toBe(
      "limited",
    );
  });
  it("1년 내내 여는 곳·상설 표기는 상시", () => {
    expect(getScheduleType(ev({ start_date: "2026-01-01", end_date: "2026-12-31" }))).toBe("permanent");
    expect(getScheduleType(ev({ title: "국립박물관 상설전시", start_date: "2026-10-01", end_date: "2026-11-01" }))).toBe(
      "permanent",
    );
  });
  it("장소 유형이 있는 비축제는 반년 이상이면 상시, 장기 기획전은 기간 한정", () => {
    expect(
      getScheduleType(
        ev({ category: "kids_experience", place_types: ["park_playground"], start_date: "2026-03-01", end_date: "2026-11-30" }),
      ),
    ).toBe("permanent");
    expect(
      getScheduleType(ev({ category: "exhibition", start_date: "2026-03-01", end_date: "2026-11-30" })),
    ).toBe("limited");
  });
  it("공식 출처의 한 달 일정은 임시 날짜로 보지 않는다", () => {
    expect(isApproxDates(ev({ start_date: "2026-10-01", end_date: "2026-10-31" }))).toBe(true);
    expect(isApproxDates(ev({ source: "kfes", start_date: "2026-10-01", end_date: "2026-10-31" }))).toBe(false);
    expect(isApproxDates(ev({ start_date: "2026-10-01", end_date: "2026-10-30" }))).toBe(false);
  });
  it("카드 일정 문구", () => {
    expect(scheduleText(ev({ start_date: "2026-01-01", end_date: "2026-12-31" }))).toBe("언제든 방문");
    expect(scheduleText(ev({ start_date: "2026-11-01", end_date: "2026-11-30" }))).toBe("11월 중");
    expect(scheduleText(ev({ start_date: "2026-10-16", end_date: "2026-10-25" }))).toBe("10.16 – 10.25");
  });
});

describe("resolveInfoUrl", () => {
  it("공식 링크가 없으면 구청 대신 행사명 검색", () => {
    const info = resolveInfoUrl(ev({ district: "중구" }));
    expect(info.kind).toBe("search");
    expect(info.href).toContain("search.naver.com");
  });
});

describe("buildIcs", () => {
  it("종일 일정의 DTEND는 종료일 다음 날", () => {
    const ics = buildIcs(ev({ start_date: "2026-10-24", end_date: "2026-10-25" }), "https://x/e");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261024");
    expect(ics).toContain("DTEND;VALUE=DATE:20261026");
    expect(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
  });
});

describe("rankAttractions", () => {
  it("사진·잘 알려진 곳을 먼저, 작은 갤러리·옛터는 뒤로", () => {
    const p = (title: string, thumb = false) => ({ title, thumbnail_url: thumb ? "https://x/y.jpg" : null, description: null });
    const out = rankAttractions([
      p("(재)한원미술관"),
      p("갤러리관악"),
      p("국립중앙박물관"),
      p("수원 화성", true),
      p("떡박물관"),
    ]).map((e) => e.title);
    expect(out).toEqual(["수원 화성", "국립중앙박물관", "떡박물관", "(재)한원미술관", "갤러리관악"]);
  });
});
