import { describe, expect, it } from "vitest";

import { courseHref, courseStops, shortDayLabel } from "@/lib/course";
import { parseCourse } from "@/lib/course-page";
import { DEFAULT_EXPLORER_FILTERS, filterEvents, formatAgeRange } from "@/lib/events";
import { ageFit, parseKidAge, preferKidAge } from "@/lib/kid-age";
import { pickVisitDay } from "@/lib/visit-day";
import type { Event } from "@/types/event";

const TUE = "2026-10-20";
const SAT = "2026-10-24";

function ev(id: string, extra: Partial<Event> = {}): Event {
  return {
    id,
    title: id,
    category: "festival",
    description: null,
    start_date: "2026-10-01",
    end_date: "2026-10-31",
    location_name: "장소",
    address: "서울특별시 종로구 세종로",
    latitude: 37.57,
    longitude: 126.977,
    region: "서울특별시",
    district: "종로구",
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
    created_at: "",
    updated_at: "",
    source: "kfes",
    ...extra,
  };
}

describe("아이 나이", () => {
  it("대상이 다르면 뒤로, 누구나·정보 없음은 그대로", () => {
    const list = [
      ev("초등", { target_age_group: "elementary" }),
      ev("누구나", { target_age_group: "all" }),
      ev("유아", { target_age_group: "kids" }),
      ev("모름"),
    ];
    expect(preferKidAge(list, "4-5").map((e) => e.id)).toEqual(["누구나", "유아", "모름", "초등"]);
    expect(preferKidAge(list, null)).toBe(list);
    expect(ageFit({ target_age_group: "kids" }, "6-7")).toBe("fit");
    expect(ageFit({ target_age_group: "all" }, "4-5")).toBeNull();
    expect(ageFit({ target_age_group: "toddler" }, "8-10")).toBe("mismatch");
  });

  it("세부 나이가 있으면 그 범위로 판단 (연령대보다 우선)", () => {
    const fiveToSeven = { age_min: 5, age_max: 7, target_age_group: "kids" as const };
    expect(ageFit(fiveToSeven, "4-5")).toBe("fit"); // 5세가 겹침
    expect(ageFit(fiveToSeven, "2-3")).toBe("mismatch");
    expect(ageFit(fiveToSeven, "8-10")).toBe("mismatch");
    // "36개월 이상": 갈 수는 있지만 범위가 넓어 '딱'은 아님, 2살 미만은 안 됨
    expect(ageFit({ age_min: 3, age_max: null }, "6-7")).toBeNull();
    expect(ageFit({ age_min: 3, age_max: null }, "0-1")).toBe("mismatch");
  });

  it("예전 3단계 쿠키 값도 받는다", () => {
    expect(parseKidAge("kids")).toBe("4-5");
    expect(parseKidAge("6-7")).toBe("6-7");
    expect(parseKidAge("bogus")).toBeNull();
  });

  it("세부 나이 문구", () => {
    expect(formatAgeRange(5, 7)).toBe("만 5~7세");
    expect(formatAgeRange(3, null)).toBe("3세 이상");
    expect(formatAgeRange(null, 7)).toBe("7세 이하");
    expect(formatAgeRange(1.5, null)).toBe("18개월 이상");
    expect(formatAgeRange(null, null)).toBeNull();
  });

  it("연령 필터: 세부 나이 범위가 겹치는 행사만", () => {
    const tiny = ev("tiny", { age_min: 0.5, age_max: 2 });
    const kinder = ev("kinder", { age_min: 5, age_max: 7 });
    const plain = ev("plain");
    const got = filterEvents([tiny, kinder, plain], { ...DEFAULT_EXPLORER_FILTERS, targetAgeGroup: "elementary" }, TUE);
    expect(got.map((e) => e.id)).toEqual(["plain"]);
  });
});

describe("가는 날", () => {
  it("고른 날 → 이번 주말 → 오늘 → 시작일", () => {
    expect(pickVisitDay("2026-10-01", "2026-10-31", TUE, "2026-10-28")).toBe("2026-10-28");
    expect(pickVisitDay("2026-10-01", "2026-10-31", TUE)).toBe(SAT);
    expect(pickVisitDay("2026-10-01", "2026-10-22", TUE)).toBe(TUE);
    expect(pickVisitDay("2026-11-07", "2026-11-08", TUE)).toBe("2026-11-07");
  });
});

describe("하루 코스", () => {
  const base = ev("기준축제");
  const near = ev("근처전시", { category: "exhibition", latitude: 37.58, longitude: 126.98 });
  const park = ev("근처공원", {
    start_date: "2020-01-01",
    end_date: "2030-12-31",
    latitude: 37.575,
    longitude: 126.99,
  });
  const far = ev("먼곳", { latitude: 37.9, longitude: 127.5 }); // 50km+
  const closedThatDay = ev("평일만", { start_date: "2026-10-26", end_date: "2026-10-30" });
  const otherRegion = ev("부산", { region: "부산광역시", latitude: 37.571, longitude: 126.977 });
  const sameTitleNextYear = ev("2026 기준축제", { latitude: 37.571, longitude: 126.978 });

  it("그날 열린 가까운 곳만, 가까운 순 (상시 장소 포함)", () => {
    const stops = courseStops(
      base,
      [base, far, near, park, closedThatDay, otherRegion, sameTitleNextYear],
      SAT,
      TUE,
    );
    expect(stops.map((s) => s.item.id)).toEqual(["근처전시", "근처공원"]);
    expect(stops[0].km).toBeLessThan(2);
  });

  it("링크·날짜 표시와 공유 링크 해석", () => {
    expect(shortDayLabel(SAT)).toBe("10.24(토)");
    // 실제 id는 evt-xxxx / UUID 형식
    const a = ev("evt-aaa1", { title: "기준축제" });
    const b = ev("evt-bbb2", { title: "근처전시" });
    const href = courseHref([a.id, b.id], SAT);
    const parsed = parseCourse(new URL(`https://x${href}`).searchParams, [a, b], TUE)!;
    expect(parsed.title).toBe("10.24(토) 하루 코스 · 2곳");
    expect(parsed.description).toBe("기준축제 → 근처전시");
    expect(parseCourse(new URLSearchParams("ids=없는id"), [base], TUE)).toBeNull();
  });
});
