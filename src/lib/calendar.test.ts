import { describe, expect, it } from "vitest";

import { buildCalendarCounts } from "@/lib/calendar";
import { daysBetween } from "@/lib/dates";
import { DEFAULT_EXPLORER_FILTERS } from "@/lib/events";
import { googleCalendarUrl } from "@/lib/ics";
import type { Event } from "@/types/event";

const TODAY = "2026-10-20";

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
    status: "ongoing",
    created_at: "",
    updated_at: "",
    source: "kfes",
    ...extra,
  };
}

describe("buildCalendarCounts", () => {
  const events = [
    ev("a", "2026-10-15", "2026-10-25"),
    ev("b", "2026-10-24", "2026-10-24"),
    ev("c", "2026-11-07", "2026-11-08"),
    ev("park", "2020-01-01", "2030-12-31"), // 상시 — 세지 않음
    ev("ended", "2026-10-01", "2026-10-10"),
  ];
  const cal = buildCalendarCounts(events, DEFAULT_EXPLORER_FILTERS, TODAY);
  const at = (d: string) => cal.open[daysBetween(cal.from, d)];
  const startsAt = (d: string) => cal.starts[daysBetween(cal.from, d)];

  it("이번 달 1일부터 6달", () => {
    expect(cal.from).toBe("2026-10-01");
    expect(cal.to).toBe("2027-03-31");
    expect(cal.open).toHaveLength(daysBetween(cal.from, cal.to) + 1);
  });

  it("날짜별 열리는 수 (지난 날·상시 제외)", () => {
    expect(at("2026-10-16")).toBe(0); // 지난 날
    expect(at("2026-10-20")).toBe(1);
    expect(at("2026-10-24")).toBe(2);
    expect(at("2026-10-26")).toBe(0);
    expect(at("2026-11-08")).toBe(1);
  });

  it("새로 시작하는 날 표시 (이미 시작한 행사는 제외)", () => {
    expect(startsAt("2026-10-15")).toBe(0);
    expect(startsAt("2026-10-24")).toBe(1);
    expect(startsAt("2026-11-07")).toBe(1);
  });
});

describe("googleCalendarUrl", () => {
  it("가는 날 하루로 종일 일정", () => {
    const url = new URL(googleCalendarUrl(ev("a", "2026-10-15", "2026-10-25"), "https://x/e/a", "2026-10-24"));
    expect(url.searchParams.get("dates")).toBe("20261024/20261025");
    expect(url.searchParams.get("text")).toBe("a");
  });
  it("날을 안 고르면 기간 전체", () => {
    const url = new URL(googleCalendarUrl(ev("b", "2026-10-24", "2026-10-25"), "https://x/e/b"));
    expect(url.searchParams.get("dates")).toBe("20261024/20261026");
  });
});
