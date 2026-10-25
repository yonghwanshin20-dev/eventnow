import { describe, expect, it } from "vitest";

import {
  analyzeMentions,
  badgesFor,
  blogQuery,
  buildQueries,
  countMentions,
  formatCount,
  getKakaoRestKey,
  matchRating,
  rankPicks,
  scorePick,
  toCandidates,
  type FoodPick,
} from "./food";

describe("buildQueries", () => {
  it("좌표가 있으면 반경 검색, 없으면 동네 이름을 붙인다", () => {
    expect(buildQueries({ dong: "홍은동" }, true)).toEqual(["맛집", "가족 외식", "한식"]);
    expect(buildQueries({ dong: "홍은동" }, true, "cafe")).toEqual(["카페", "디저트 카페", "베이커리 카페"]);
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
      { id: "1", place_name: "연희칼국수", category_group_code: "FD6", category_name: "음식점 > 한식 > 국수", road_address_name: "서울 서대문구 연희로 1", distance: "320", place_url: "http://place.map.kakao.com/1", x: "126.93", y: "37.57" },
      { id: "1", place_name: "연희칼국수", category_group_code: "FD6" },
      { id: "2", place_name: "연희 이자카야", category_group_code: "FD6", category_name: "음식점 > 술집 > 일본식주점" },
      { id: "3", place_name: "카페 연희", category_group_code: "CE7", category_name: "음식점 > 카페" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "연희칼국수", category: "한식 · 국수", distance: 320, rank: 0, lat: 37.57 });
  });

  it("카페 탭은 카페만, 키즈카페·스터디카페는 뺀다", () => {
    const out = toCandidates(
      [
        { id: "1", place_name: "연희 로스터리", category_group_code: "CE7", category_name: "음식점 > 카페 > 커피전문점" },
        { id: "2", place_name: "점핑 키즈카페", category_group_code: "CE7", category_name: "음식점 > 카페 > 키즈카페" },
        { id: "3", place_name: "연희칼국수", category_group_code: "FD6" },
      ],
      "cafe",
    );
    expect(out.map((c) => c.name)).toEqual(["연희 로스터리"]);
    expect(out[0].category).toBe("커피전문점");
  });
});

describe("analyzeMentions", () => {
  const area = { dong: "연희동", district: "서대문구" };
  const now = new Date("2026-10-26T00:00:00+09:00");
  it("가게 이름이 나온 글만, 최근 1년·아이랑·웨이팅 말까지 센다", () => {
    const docs = [
      { title: "<b>연희칼국수</b> 다녀왔어요", contents: "아기의자 있어서 아이랑 편했어요", datetime: "2026-09-01T12:00:00.000+09:00" },
      { title: "연희 칼국수 후기", contents: "웨이팅 30분", datetime: "2024-03-01T12:00:00.000+09:00" },
      { title: "서대문구 국수 맛집 모음", contents: "칼국수가 맛있는 집", datetime: "2026-10-01T12:00:00.000+09:00" },
    ];
    expect(analyzeMentions(docs, "연희칼국수", area, null, now)).toEqual({ mentions: 2, recent: 1, family: 1, hot: 1 });
  });
  it("짧은 이름은 동네 이름도 함께 있어야 센다 ('수빈' 같은 흔한 말)", () => {
    const docs = [
      { title: "수빈 한정식", contents: "연희동 골목에 있는" },
      { title: "수빈이 생일파티", contents: "강남에서" },
      { title: "배우 수빈", contents: "드라마" },
    ];
    expect(countMentions(docs, "수빈", area)).toBe(1);
  });
  it("'○○점' 지점 이름은 떼고 찾는다", () => {
    expect(countMentions([{ title: "연경 다녀옴", contents: "연희동 중식" }], "연경 연희점", area)).toBe(1);
  });
});

describe("점수·순위", () => {
  const pick = (name: string, o: Partial<FoodPick>): FoodPick => ({
    name, kind: "meal", category: null, address: null, distance: 300, link: "", naverLink: "",
    blogCount: 0, blogMore: false, recentCount: 0, cafeCount: 0, familyCount: 0, hotCount: 0,
    rating: null, ratingCount: null, score: 0, ...o,
  });
  it("최근 후기·맘카페 언급이 많으면 앞, 후기 없는 곳은 뺀다", () => {
    const base = { rating: null, ratingCount: null, rank: 5, distance: 300 };
    const old = scorePick({ ...base, blogCount: 100, recentCount: 2, cafeCount: 0 });
    const hot = scorePick({ ...base, blogCount: 80, recentCount: 60, cafeCount: 12 });
    expect(hot).toBeGreaterThan(old);
    const picks = rankPicks([pick("오래된집", { score: old, blogCount: 100 }), pick("요즘집", { score: hot, blogCount: 80 }), pick("없는집", {})]);
    expect(picks.map((p) => p.name)).toEqual(["요즘집", "오래된집"]);
  });
  it("구글 별점은 이름 앞부분·150m 안일 때만 붙인다", () => {
    const c = toCandidates([{ id: "1", place_name: "연희칼국수 본점", category_group_code: "FD6", x: "126.9300", y: "37.5700" }])[0];
    const google = [
      { name: "연희칼국수", rating: 4.5, count: 320, lat: 37.5701, lng: 126.9301 },
      { name: "연희칼국수", rating: 3.9, count: 20, lat: 37.6, lng: 126.95 },
    ];
    expect(matchRating(c, google)?.rating).toBe(4.5);
    expect(matchRating(c, [google[1]])).toBeNull();
  });
});

describe("배지", () => {
  it("언급 비율이 충분할 때만", () => {
    expect(badgesFor({ blogCount: 100, cafeCount: 20, familyCount: 9, hotCount: 10 })).toEqual({ family: true, hot: false });
    expect(badgesFor({ blogCount: 30, cafeCount: 0, familyCount: 1, hotCount: 6 })).toEqual({ family: false, hot: true });
  });
});

describe("도우미", () => {
  it("설정·검색어·숫자", () => {
    expect(getKakaoRestKey({})).toBeNull();
    expect(getKakaoRestKey({ KAKAO_REST_API_KEY: " k " })).toBe("k");
    expect(blogQuery("연희칼국수", { dong: "연희동", district: "서대문구" })).toBe("연희칼국수 연희동");
    expect(blogQuery("연희칼국수", {}, "서울 서대문구 연희로 1")).toBe("연희칼국수 서대문구");
    expect(formatCount(1234)).toBe("1,234");
    expect(formatCount(25000)).toBe("2.5만");
  });
});
