import { describe, expect, it } from "vitest";

import { formatDistance, isValidKoreaCoord, nearbyQuery, parseOverpass, roundCoord, walkMinutes } from "./food";

const origin = { lat: 37.579, lng: 126.936 };

describe("parseOverpass", () => {
  it("가까운 순으로, 종류·음식·아이 편의를 붙인다", () => {
    const places = parseOverpass(
      {
        elements: [
          { type: "node", id: 1, lat: 37.585, lon: 126.936, tags: { amenity: "restaurant", name: "먼식당", cuisine: "한식;갈비" } },
          { type: "node", id: 2, lat: 37.5795, lon: 126.936, tags: { amenity: "cafe", name: "Cafe", "name:ko": "가까운카페", highchair: "yes" } },
          { type: "way", id: 3, center: { lat: 37.58, lon: 126.937 }, tags: { shop: "bakery", name: "빵집" } },
          { type: "node", id: 4, lat: 37.58, lon: 126.936, tags: { amenity: "restaurant" } }, // 이름 없음
          { type: "node", id: 5, lat: 37.58, lon: 126.936, tags: { amenity: "cafe", name: "폐업", disused: "yes" } },
        ],
      },
      origin,
    );
    expect(places.map((p) => p.name)).toEqual(["가까운카페", "빵집", "먼식당"]);
    expect(places[0]).toMatchObject({ kind: "cafe", kids: true });
    expect(places[1].kind).toBe("dessert");
    expect(places[2]).toMatchObject({ kind: "meal", cuisine: "고기" });
  });

  it("같은 가게가 노드·건물로 두 번 오면 하나만", () => {
    const tags = { amenity: "restaurant", name: "중복집", cuisine: "korean" };
    const places = parseOverpass(
      {
        elements: [
          { type: "node", id: 1, lat: 37.58, lon: 126.936, tags },
          { type: "way", id: 2, center: { lat: 37.58001, lon: 126.93601 }, tags },
        ],
      },
      origin,
    );
    expect(places).toHaveLength(1);
    expect(places[0].cuisine).toBe("한식");
  });
});

describe("도우미", () => {
  it("좌표·거리 표시", () => {
    expect(roundCoord(37.57912)).toBe(37.579);
    expect(isValidKoreaCoord(37.5, 127)).toBe(true);
    expect(isValidKoreaCoord(0, 0)).toBe(false);
    expect(formatDistance(234)).toBe("230m");
    expect(formatDistance(1530)).toBe("1.5km");
    expect(walkMinutes(700)).toBe(10);
    expect(nearbyQuery({ name: "홍제폭포", area: "서대문구" })).toBe("서대문구 홍제폭포 맛집");
  });
});
