import { describe, expect, it } from "vitest";

import { dateWindow } from "@/lib/dates";
import {
  DEFAULT_EXPLORER_FILTERS,
  filterEvents,
  sortForPlan,
  whenRangeText,
  whenTitle,
} from "@/lib/events";
import type { Event } from "@/types/event";

// 2026-10-20은 화요일
const TUE = "2026-10-20";
const SAT = "2026-10-24";
const SUN = "2026-10-25";

describe("dateWindow", () => {
  it("이번 주말 / 다음 주말", () => {
    expect(dateWindow("weekend", TUE)).toEqual(["2026-10-24", "2026-10-25"]);
    expect(dateWindow("next_weekend", TUE)).toEqual(["2026-10-31", "2026-11-01"]);
    expect(dateWindow("weekend", SAT)).toEqual(["2026-10-24", "2026-10-25"]);
    expect(dateWindow("next_weekend", SAT)).toEqual(["2026-10-31", "2026-11-01"]);
    // 일요일: 이번 주말은 오늘 하루, 다음 주말은 6일 뒤 토요일부터
    expect(dateWindow("weekend", SUN)).toEqual(["2026-10-25", "2026-10-25"]);
    expect(dateWindow("next_weekend", SUN)).toEqual(["2026-10-31", "2026-11-01"]);
  });

  it("이번 달 / 다음 달 (해 넘김 포함)", () => {
    expect(dateWindow("this_month", TUE)).toEqual(["2026-10-20", "2026-10-31"]);
    expect(dateWindow("next_month", TUE)).toEqual(["2026-11-01", "2026-11-30"]);
    expect(dateWindow("next_month", "2026-12-31")).toEqual(["2027-01-01", "2027-01-31"]);
    expect(dateWindow("next_month", "2027-01-31")).toEqual(["2027-02-01", "2027-02-28"]);
  });

  it("기간 이름·날짜 표시", () => {
    expect(whenRangeText("next_weekend", TUE)).toBe("10.31 – 11.1");
    expect(whenRangeText("next_month", TUE)).toBe("11월");
    expect(whenTitle("next_month", TUE)).toBe("11월");
  });
});

function ev(id: string, start: string, end: string, extra: Partial<Event> = {}): Event {
  return {
    id,
    title: id,
    category: "festival",
    description: null,
    start_date: start,
    end_date: end,
    location_name: "공원",
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
    status: "upcoming",
    created_at: "",
    updated_at: "",
    ...extra,
  };
}

describe("다음 달 계획", () => {
  const approxNov = ev("approx", "2026-11-01", "2026-11-30");
  const exactNov = ev("exact", "2026-11-07", "2026-11-08", { source: "kfes" });

  it("한 달 단위로 볼 때는 '11월 중' 행사도 넣고, 주말 단위에서는 뺀다", () => {
    const month = filterEvents([approxNov, exactNov], { ...DEFAULT_EXPLORER_FILTERS, when: "next_month" }, TUE);
    expect(month.map((e) => e.id).sort()).toEqual(["approx", "exact"]);
    const nextWeekend = filterEvents(
      [approxNov, exactNov],
      { ...DEFAULT_EXPLORER_FILTERS, when: "next_weekend" },
      TUE,
    );
    expect(nextWeekend).toEqual([]);
  });

  it("그달에 새로 시작하는 짧은 행사가 몇 달째 하는 전시보다 앞", () => {
    const longExpo = ev("long", "2026-08-29", "2026-11-01", { source: "kfes" });
    const shortFest = ev("short", "2026-11-14", "2026-11-15", { source: "kfes" });
    const midFest = ev("mid", "2026-11-03", "2026-11-20", { source: "kfes" });
    expect(sortForPlan([longExpo, midFest, shortFest], "next_month", TUE).map((e) => e.id)).toEqual([
      "short",
      "mid",
      "long",
    ]);
  });
});
