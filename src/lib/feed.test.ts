import { describe, expect, it } from "vitest";

import { displayTitle, placeLines, scheduleHint } from "@/lib/events";
import { activeFilterChips } from "@/components/events/active-filter-chips";
import { DEFAULT_EXPLORER_FILTERS } from "@/lib/events";
import { relatedShelves } from "@/lib/related";
import { buildFeed } from "@/lib/feed";
import type { Event } from "@/types/event";

const TODAY = "2026-10-19"; // 월요일

function ev(o: Partial<Event>): Event {
  return {
    id: o.id ?? "x",
    title: "행사",
    category: "festival",
    description: null,
    start_date: "2026-10-01",
    end_date: "2026-10-31",
    location_name: "공원",
    address: "서울특별시 중구 세종대로 1",
    latitude: null,
    longitude: null,
    region: "서울특별시",
    district: null,
    is_family_friendly: false,
    target_age_group: null,
    amenities: { parking: false, stroller: false, nursing_room: false },
    booking_required: false,
    price_info: null,
    thumbnail_url: null,
    official_link: null,
    tags: [],
    place_types: [],
    status: "ongoing",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...o,
  };
}

describe("placeLines", () => {
  it("장소명이 주소 앞부분이면 주소 한 줄", () => {
    expect(
      placeLines(ev({ location_name: "서울특별시 종로구", address: "서울특별시 종로구 사직로 161" })),
    ).toEqual({ main: "서울특별시 종로구 사직로 161", sub: null });
  });
  it("주소가 '지역 + 장소명'이면 장소명 + 지역", () => {
    expect(
      placeLines(ev({ location_name: "노원문화원", address: "서울 노원문화원", district: null })),
    ).toEqual({ main: "노원문화원", sub: "서울" });
  });
  it("그 외에는 장소명 + 주소", () => {
    expect(placeLines(ev({ location_name: "여의도공원", address: "서울특별시 영등포구 여의공원로 68" }))).toEqual({
      main: "여의도공원",
      sub: "서울특별시 영등포구 여의공원로 68",
    });
  });
});

describe("buildFeed", () => {
  const events = [
    ev({ id: "weekend-photo", start_date: "2026-10-24", end_date: "2026-10-25", thumbnail_url: "https://x/a.jpg" }),
    ev({ id: "weekend-plain", start_date: "2026-10-24", end_date: "2026-10-25" }),
    ev({ id: "ending", start_date: "2026-10-01", end_date: "2026-10-21" }),
    ev({ id: "ending2", start_date: "2026-10-01", end_date: "2026-10-20" }),
    ev({ id: "park", start_date: "2026-01-01", end_date: "2026-12-31" }),
    ev({ id: "park2", start_date: "2026-01-01", end_date: "2026-12-31" }),
  ];

  it("주말 선반은 사진 있는 행사를 앞에, 같은 행사는 한 선반에만", () => {
    const feed = buildFeed(events, TODAY);
    const weekend = feed.find((s) => s.key === "weekend")!;
    expect(weekend.items[0].id).toBe("weekend-photo");
    const all = feed.flatMap((s) => s.items.map((i) => i.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it("곧 끝나요는 마감 빠른 순, 상시 운영은 따로", () => {
    const feed = buildFeed(events, TODAY);
    const keys = feed.map((s) => s.key);
    expect(keys).toContain("permanent");
    const permanent = feed.find((s) => s.key === "permanent")!;
    expect(permanent.items.map((i) => i.id).sort()).toEqual(["park", "park2"]);
  });

  it("2개 미만인 선반은 숨긴다", () => {
    const feed = buildFeed([ev({ id: "only", start_date: "2026-10-24", end_date: "2026-10-25" })], TODAY);
    expect(feed).toEqual([]);
  });
});

describe("displayTitle", () => {
  it("앞의 [꼬리표]를 떼되 남는 제목이 짧으면 그대로", () => {
    expect(displayTitle("[소마미술관] 조각이 꿈+틀")).toBe("조각이 꿈+틀");
    expect(displayTitle("[상설] 외규장각 의궤실 공개")).toBe("외규장각 의궤실 공개");
    expect(displayTitle("[특별전] 빛")).toBe("[특별전] 빛");
    expect(displayTitle("유영국: 산은 내 안에 있다")).toBe("유영국: 산은 내 안에 있다");
  });
});

describe("scheduleHint", () => {
  const none = { permanent: false, approx: false };
  it("진행 중이고 주말까지 열면 둘 다 안내", () => {
    expect(scheduleHint({ start_date: "2026-10-01", end_date: "2026-10-31" }, none, TODAY)).toBe(
      "오늘 열려요 · 이번 주말에도 열려요",
    );
  });
  it("주말 전에 끝나면 오늘만", () => {
    expect(scheduleHint({ start_date: "2026-10-01", end_date: "2026-10-21" }, none, TODAY)).toBe("오늘 열려요");
  });
  it("주말에 시작하면 주말 안내, 상시·날짜 미정은 없음", () => {
    expect(scheduleHint({ start_date: "2026-10-24", end_date: "2026-10-24" }, none, TODAY)).toBe(
      "이번 주말에 열려요",
    );
    expect(
      scheduleHint({ start_date: "2026-01-01", end_date: "2026-12-31" }, { permanent: true, approx: false }, TODAY),
    ).toBeNull();
  });
});

describe("activeFilterChips", () => {
  it("걸린 조건마다 칩, 지역을 빼면 세부 지역도 같이 빠진다", () => {
    const chips = activeFilterChips({
      ...DEFAULT_EXPLORER_FILTERS,
      q: "불꽃",
      region: "서울특별시",
      subregion: "마포구",
      when: "weekend",
      amenities: { parking: true },
    });
    expect(chips.map((c) => c.label)).toEqual(["‘불꽃’", "이번 주말", "서울", "마포구", "주차"]);
    expect(chips.find((c) => c.key === "region")?.clear).toEqual({ region: "all", subregion: "all" });
  });
  it("기본 상태면 칩 없음", () => {
    expect(activeFilterChips(DEFAULT_EXPLORER_FILTERS)).toEqual([]);
  });
});

describe("relatedShelves", () => {
  it("같은 구 → 같은 시도 순, 자기 자신·종료 행사 제외", () => {
    const me = ev({ id: "me", address: "서울특별시 마포구 월드컵로 1" });
    const all = [
      me,
      ev({ id: "mapo", address: "서울특별시 마포구 합정동 1" }),
      ev({ id: "seoul", address: "서울특별시 중구 세종대로 1" }),
      ev({ id: "ended", address: "서울특별시 마포구 망원동", end_date: "2026-10-01" }),
      ev({ id: "busan", region: "부산광역시", address: "부산광역시 해운대구 1", category: "exhibition" }),
    ];
    const [nearby] = relatedShelves(me, all, TODAY);
    expect(nearby.title).toBe("마포구의 다른 행사");
    expect(nearby.items.map((i) => i.id)).toEqual(["mapo", "seoul"]);
  });
});