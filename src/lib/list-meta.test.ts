import { describe, expect, it } from "vitest";

import { DEFAULT_EXPLORER_FILTERS, filterEvents, rankByQuery, type ExplorerFilters } from "@/lib/events";
import { describeList } from "@/lib/list-meta";
import type { Event } from "@/types/event";

const TUE = "2026-10-20";

function ev(id: string, extra: Partial<Event> = {}): Event {
  return {
    id,
    title: id,
    category: "festival",
    description: null,
    start_date: "2026-10-24",
    end_date: "2026-10-25",
    location_name: "공원",
    address: "부산광역시 해운대구 우동",
    latitude: null,
    longitude: null,
    region: "부산광역시",
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
    source: "kfes",
    ...extra,
  };
}

const f = (o: Partial<ExplorerFilters>): ExplorerFilters => ({ ...DEFAULT_EXPLORER_FILTERS, ...o });

describe("describeList (공유 링크 미리보기)", () => {
  const events = [
    ev("불꽃축제"),
    ev("국화전시", { category: "exhibition" }),
    ev("상설공원", { start_date: "2020-01-01", end_date: "2030-12-31" }),
    ev("서울행사", { region: "서울특별시", address: "서울특별시 중구" }),
  ];

  it("조건이 없으면 기본 소개", () => {
    expect(describeList(f({}), events, TUE)).toBeNull();
    expect(describeList(f({ view: "calendar" }), events, TUE)).toBeNull();
  });

  it("지역 + 이번 주말 (상시는 세지 않음)", () => {
    const meta = describeList(f({ when: "weekend", regions: ["부산광역시"] }), events, TUE)!;
    expect(meta.title).toBe("부산 · 이번 주말 갈 만한 곳 2곳");
    expect(meta.eyebrow).toBe("10.24 – 10.25");
    expect(meta.lines.sort()).toEqual(["국화전시", "불꽃축제"]);
  });

  it("다음 달 + 카테고리, 찜 목록", () => {
    expect(describeList(f({ when: "next_month", category: "exhibition" }), events, TUE)!.title).toBe(
      "11월 전시 0곳",
    );
    expect(describeList(f({ favorites: ["불꽃축제", "서울행사"] }), events, TUE)!.title).toBe("찜한 행사 2곳");
  });
});

describe("미리보기 문구 보호", () => {
  it("없는 구 이름·결과 없는 검색어는 제목에 찍히지 않는다", async () => {
    const { searchParamsToFilters } = await import("@/lib/events");
    const fake = searchParamsToFilters(
      new URLSearchParams({ region: "서울특별시", sub: "무료쿠폰 받기 evil.com" }),
    );
    expect(fake.subregions).toEqual([]);
    const real = searchParamsToFilters(new URLSearchParams({ region: "서울특별시", sub: "종로구" }));
    expect(real.subregions).toEqual(["서울특별시:종로구"]);
    const meta = describeList(f({ q: "무료쿠폰 evil.com" }), [ev("불꽃축제")], TUE)!;
    expect(meta.title).toBe("검색 결과 0곳");
  });
});

describe("검색", () => {
  const dino = ev("가을 체험전", { description: "공룡 화석 발굴 체험을 할 수 있어요" });
  const titled = ev("공룡 대탐험");
  it("소개글에만 나오는 말도 찾고, 제목에 있는 행사를 먼저", () => {
    const found = filterEvents([dino, titled], f({ q: "공룡" }), TUE);
    expect(found).toHaveLength(2);
    expect(rankByQuery(found, "공룡").map((e) => e.id)).toEqual(["공룡 대탐험", "가을 체험전"]);
  });
});
