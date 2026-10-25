import { describe, expect, it } from "vitest";

import { addDays, computeStatus, dateWindow, isIsoDate, overlaps, todayKst } from "@/lib/dates";

describe("todayKst", () => {
  it("UTC 19:00은 KST 다음 날 04:00", () => {
    expect(todayKst(new Date("2026-10-18T19:00:00Z"))).toBe("2026-10-19");
  });
  it("UTC 14:59는 KST 23:59 같은 날", () => {
    expect(todayKst(new Date("2026-10-19T14:59:00Z"))).toBe("2026-10-19");
  });
});

describe("computeStatus", () => {
  const today = "2026-10-19";
  it("종료일이 어제면 ended", () => {
    expect(computeStatus("2026-10-01", "2026-10-18", today)).toBe("ended");
  });
  it("종료일이 오늘이면 ongoing", () => {
    expect(computeStatus("2026-10-01", "2026-10-19", today)).toBe("ongoing");
  });
  it("시작일이 내일이면 upcoming", () => {
    expect(computeStatus("2026-10-20", "2026-10-25", today)).toBe("upcoming");
  });
});

describe("dateWindow", () => {
  // 2026-10-19 = 월요일
  it("평일의 이번 주말은 다가오는 토·일", () => {
    expect(dateWindow("weekend", "2026-10-19")).toEqual(["2026-10-24", "2026-10-25"]);
  });
  it("토요일의 이번 주말은 오늘·내일", () => {
    expect(dateWindow("weekend", "2026-10-24")).toEqual(["2026-10-24", "2026-10-25"]);
  });
  it("일요일의 이번 주말은 오늘만", () => {
    expect(dateWindow("weekend", "2026-10-25")).toEqual(["2026-10-25", "2026-10-25"]);
  });
  it("이번 주는 일요일까지", () => {
    expect(dateWindow("week", "2026-10-19")).toEqual(["2026-10-19", "2026-10-25"]);
  });
  it("월말·연말 경계를 넘는다", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("없는 날짜는 날짜로 보지 않는다", () => {
    expect(isIsoDate("2026-02-31")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });
});

describe("overlaps", () => {
  it("기간이 창과 겹치면 true", () => {
    expect(overlaps("2026-10-01", "2026-10-24", ["2026-10-24", "2026-10-25"])).toBe(true);
  });
  it("창 전에 끝나면 false", () => {
    expect(overlaps("2026-10-01", "2026-10-23", ["2026-10-24", "2026-10-25"])).toBe(false);
  });
});
