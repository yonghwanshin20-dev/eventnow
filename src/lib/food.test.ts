import { describe, expect, it } from "vitest";

import { blogQuery, buildQueries, formatCount, getKakaoRestKey, rankPicks, toCandidates } from "./food";

describe("buildQueries", () => {
  it("좌표가 있으면 반경 검색, 없으면 동네 이름을 붙인다", () => {
    expect(buildQueries({ dong: "홍은동" }, true)).toEqual(["맛집", "가족 외식", "한식"]);
    expect(buildQueries({ district: "서대문구", dong: "홍은동" }, false)).toEqual([
      "서대문구 홍은동 맛집",
      "서대문구 홍은동 가족 외식",
      "서대문구 홍은동 한식",
    ]);
    expect(buildQueries({}, false)).toEqual([]);
  });
});

describe("toCandidates", () => {
  it("음식점만, 술집·카페·중복은 빼고 분류를 짧게", () => {
    const out = toCandidates([
      { id: "1", place_name: "연희칼국수", category_group_code: "FD6", category_name: "음식점 > 한식 > 국수", road_address_name: "서울 서대문구 연희로 1", distance: "320", place_url: "http://place.map.kakao.com/1" },
      { id: "1", place_name: "연희칼국수", category_group_code: "FD6" },
      { id: "2", place_name: "연희 이자카야", category_group_code: "FD6", category_name: "음식점 > 술집 > 일본식주점" },
      { id: "3", place_name: "카페 연희", category_group_code: "CE7", category_name: "음식점 > 카페" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "연희칼국수", category: "한식 · 국수", distance: 320, link: "http://place.map.kakao.com/1" });
  });
});

describe("rankPicks", () => {
  it("블로그 글 많은 순 10곳", () => {
    const c = (name: string, blogCount: number) => ({ id: name, name, category: null, address: null, distance: null, link: "", blogCount });
    const picks = rankPicks([c("보통집", 120), c("인기집", 3400), ...Array.from({ length: 12 }, (_, i) => c(`집${i}`, i))]);
    expect(picks).toHaveLength(10);
    expect(picks.map((p) => p.name).slice(0, 2)).toEqual(["인기집", "보통집"]);
  });
});

describe("도우미", () => {
  it("설정·검색어·숫자", () => {
    expect(getKakaoRestKey({})).toBeNull();
    expect(getKakaoRestKey({ KAKAO_REST_API_KEY: " k " })).toBe("k");
    expect(blogQuery("연희칼국수", { dong: "연희동", district: "서대문구" })).toBe('"연희칼국수" 연희동');
    expect(blogQuery("연희칼국수", {}, "서울 서대문구 연희로 1")).toBe('"연희칼국수" 서대문구');
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(25000)).toBe("2.5만");
  });
});
