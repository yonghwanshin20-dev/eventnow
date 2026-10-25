import { describe, expect, it } from "vitest";

import { visitDays } from "@/components/events/event-weather";
import { isIndoor } from "@/lib/events";
import { isWetDay, parseForecast, weatherFor, weatherKind } from "@/lib/weather";

const SAMPLE = {
  daily: {
    time: ["2026-10-24", "2026-10-25", "2026-10-26"],
    weather_code: [3, 61, 0],
    temperature_2m_max: [21.1, 18.5, 20.1],
    temperature_2m_min: [10.8, 11.2, 10.9],
    precipitation_probability_max: [6, 53, null],
  },
};

describe("weather", () => {
  it("Open-Meteo 응답을 날짜별로", () => {
    const f = parseForecast(SAMPLE, "서울")!;
    expect(f.days[1]).toEqual({ date: "2026-10-25", kind: "rain", tmax: 19, tmin: 11, pop: 53 });
    expect(f.days[2].pop).toBe(0);
    expect(weatherFor(f, ["2026-10-24", "2026-10-25"]).map((d) => d.date)).toEqual([
      "2026-10-24",
      "2026-10-25",
    ]);
    expect(weatherFor(null, ["2026-10-24", "2026-10-25"])).toEqual([]);
  });

  it("비 걱정 판단: 비 예보 또는 강수 확률 50% 이상", () => {
    const f = parseForecast(SAMPLE, "서울")!;
    expect(f.days.map(isWetDay)).toEqual([false, true, false]);
    expect(isWetDay({ date: "x", kind: "cloudy", tmax: 1, tmin: 0, pop: 60 })).toBe(true);
  });

  it("WMO 코드", () => {
    expect(weatherKind(0)).toBe("clear");
    expect(weatherKind(80)).toBe("rain");
    expect(weatherKind(73)).toBe("snow");
    expect(weatherKind(95)).toBe("storm");
  });

  it("깨진 응답은 null", () => {
    expect(parseForecast({}, "서울")).toBeNull();
  });
});

describe("visitDays (빠른 보기 날씨에 쓸 날)", () => {
  const TUE = "2026-10-20";
  it("고른 날이 기간 안이면 그날 (토요일이면 일요일까지)", () => {
    expect(visitDays({ start_date: "2026-10-01", end_date: "2026-11-30" }, false, TUE, "2026-10-28")).toEqual([
      "2026-10-28",
    ]);
    expect(visitDays({ start_date: "2026-10-01", end_date: "2026-11-30" }, false, TUE, "2026-10-31")).toEqual([
      "2026-10-31",
      "2026-11-01",
    ]);
    expect(visitDays({ start_date: "2026-10-01", end_date: "2026-10-31" }, false, TUE, "2026-10-31")).toEqual([
      "2026-10-31",
    ]);
  });
  it("아니면 기간 안의 이번 주말", () => {
    expect(visitDays({ start_date: "2026-10-01", end_date: "2026-10-24" }, false, TUE)).toEqual(["2026-10-24"]);
  });
  it("주말 전에 끝나면 오늘, 아직 안 했으면 첫날", () => {
    expect(visitDays({ start_date: "2026-10-01", end_date: "2026-10-22" }, false, TUE)).toEqual([TUE]);
    expect(visitDays({ start_date: "2026-11-07", end_date: "2026-11-08" }, false, TUE)).toEqual(["2026-11-07"]);
  });
  it("상시 장소는 이번 주말", () => {
    expect(visitDays({ start_date: "2020-01-01", end_date: "2030-12-31" }, true, TUE)).toEqual([
      "2026-10-24",
      "2026-10-25",
    ]);
  });
});

describe("isIndoor", () => {
  const base = { tags: [], place_types: [], location_name: "" };
  it("전시·팝업·미술관은 실내, 공원·야외는 실외", () => {
    expect(isIndoor({ ...base, category: "exhibition" })).toBe(true);
    expect(isIndoor({ ...base, category: "festival", location_name: "국립중앙과학관" })).toBe(true);
    expect(isIndoor({ ...base, category: "festival", location_name: "올림픽공원" })).toBe(false);
    expect(isIndoor({ ...base, category: "exhibition", tags: ["#야외"] })).toBe(false);
    expect(
      isIndoor({ ...base, category: "kids_experience", place_types: ["park_playground"] }),
    ).toBe(false);
    expect(isIndoor({ ...base, category: "festival", tags: ["#실내"] })).toBe(true);
  });
});
