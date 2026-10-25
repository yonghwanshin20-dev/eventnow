import { describe, expect, it } from "vitest";

import { toListItem } from "@/lib/events";
import { favoriteDigest } from "@/lib/reminders";
import type { Event } from "@/types/event";

const TUE = "2026-10-20";

function ev(id: string, start: string, end: string, extra: Partial<Event> = {}): Event {
  return {
    id,
    title: id,
    category: "festival",
    description: null,
    start_date: start,
    end_date: end,
    location_name: "공원",
    address: "서울특별시 중구",
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

const items = (list: Event[]) => list.map((e) => toListItem(e, null, TUE));

describe("favoriteDigest", () => {
  it("곧 끝나는 것 → 곧 시작하는 것 순, 먼 것·상시·종료는 알림 없음", () => {
    const d = favoriteDigest(
      items([
        ev("start-tomorrow", "2026-10-21", "2026-10-30"),
        ev("ends-in-4", "2026-10-01", "2026-10-24"),
        ev("ends-today", "2026-10-01", "2026-10-20"),
        ev("far", "2026-10-01", "2026-12-31"),
        ev("park", "2020-01-01", "2030-12-31"),
        ev("ended", "2026-09-01", "2026-10-10"),
        ev("starts-later", "2026-11-10", "2026-11-12"),
      ]),
      TUE,
    );
    expect(d.reminders.map((r) => [r.id, r.text])).toEqual([
      ["ends-today", "오늘이 마지막 날이에요"],
      ["ends-in-4", "4일 남았어요 · 10.24까지"],
      ["start-tomorrow", "내일 시작해요"],
    ]);
    expect(d.endedCount).toBe(1);
    // 이번 주말(10.24–25)에 열리는 찜: ends-in-4, start-tomorrow, far, park(상시)
    expect(d.weekendCount).toBe(4);
  });

  it("알릴 게 없으면 빈 목록", () => {
    expect(favoriteDigest(items([ev("far", "2026-10-01", "2026-12-31")]), TUE).reminders).toEqual([]);
  });
});
