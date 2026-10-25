import { describe, expect, it } from "vitest";

import { blogQuery, buildQueries, formatCount, getNaverConfig, rankPicks, toCandidates } from "./food";

describe("buildQueries", () => {
  it("동네·장소로 검색어 여러 개 (중복 없이)", () => {
    expect(buildQueries({ district: "서대문구", dong: "홍은동", place: "홍제폭포" })).toEqual([
      "서대문구 홍은동 맛집",
      "홍제폭포 맛집",
      "홍제폭포 근처 식당",
      "홍은동 가족 외식",
      "홍은동 한식 맛집",
      "홍은동 아이랑 식당",
    ]);
    expect(buildQueries({})).toEqual([]);
  });
});

describe("toCandidates", () => {
  it("태그를 지우고 카페·술집과 중복은 뺀다, 좌표는 ×10^7", () => {
    const out = toCandidates([
      { title: "<b>연희</b>칼국수", category: "한식>칼국수,만두", roadAddress: "서울 서대문구 연희로 1", mapx: "1269300000", mapy: "375700000" },
      { title: "연희 칼국수", category: "한식>칼국수,만두" },
      { title: "카페 연희", category: "카페,디저트>카페" },
      { title: "연희 이자카야", category: "술집>이자카야" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "연희칼국수", category: "한식 · 칼국수,만두", lat: 37.57, lng: 126.93 });
  });
});

describe("rankPicks", () => {
  it("블로그 글 많은 순, 너무 먼 곳은 빼고 10곳까지", () => {
    const origin = { lat: 37.57, lng: 126.93 };
    const near = (name: string, blogCount: number) => ({ name, category: null, address: null, lat: 37.571, lng: 126.931, blogCount });
    const picks = rankPicks(
      [
        near("보통집", 120),
        near("인기집", 3400),
        { ...near("먼집", 99999), lat: 37.7, lng: 127.1 },
        ...Array.from({ length: 12 }, (_, i) => near(`집${i}`, i)),
      ],
      origin,
      { dong: "연희동" },
    );
    expect(picks).toHaveLength(10);
    expect(picks[0].name).toBe("인기집");
    expect(picks.some((p) => p.name === "먼집")).toBe(false);
    expect(picks[0].link).toContain(encodeURIComponent("연희동 인기집"));
  });
});

describe("도우미", () => {
  it("설정·검색어·숫자", () => {
    expect(getNaverConfig({})).toBeNull();
    expect(getNaverConfig({ NAVER_CLIENT_ID: "a", NAVER_CLIENT_SECRET: "b" })).toEqual({ id: "a", secret: "b" });
    expect(blogQuery("연희칼국수", { dong: "연희동", district: "서대문구" })).toBe('"연희칼국수" 연희동');
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(25000)).toBe("2.5만");
  });
});
