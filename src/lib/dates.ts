import type { EventStatus } from "@/types/event";

/** 모든 날짜 판단은 KST(UTC+9, DST 없음) 기준 `YYYY-MM-DD` 문자열로 한다. */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function isoToUtcMs(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function addDays(iso: string, days: number): string {
  return new Date(isoToUtcMs(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0=일 … 6=토 */
export function dayOfWeek(iso: string): number {
  return new Date(isoToUtcMs(iso)).getUTCDay();
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((isoToUtcMs(toIso) - isoToUtcMs(fromIso)) / DAY_MS);
}

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = isoToUtcMs(value);
  // 2026-02-31처럼 없는 날짜는 JS가 3월 3일로 넘겨 버리므로 되돌려 같은지 확인한다
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** 저장된 status 대신 날짜로 매번 계산 (DB/JSON 상태값이 낡아도 정확) */
export function computeStatus(
  startDate: string,
  endDate: string,
  today: string = todayKst(),
): EventStatus {
  if (endDate.slice(0, 10) < today) return "ended";
  if (startDate.slice(0, 10) > today) return "upcoming";
  return "ongoing";
}

export type WhenFilter =
  | "today"
  | "weekend"
  | "next_weekend"
  | "week"
  | "month"
  | "this_month"
  | "next_month";

/** 이번 주말의 토요일 (일요일이면 어제) */
function thisSaturday(today: string): string {
  const dow = dayOfWeek(today);
  return dow === 0 ? addDays(today, -1) : addDays(today, 6 - dow);
}

/** 그 달의 마지막 날 */
export function monthEnd(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** 다음 달 1일 */
export function nextMonthStart(iso: string): string {
  return addDays(monthEnd(iso), 1);
}

/** 날짜 필터 → [from, to] (양끝 포함) */
export function dateWindow(
  when: WhenFilter,
  today: string = todayKst(),
): [string, string] {
  const dow = dayOfWeek(today);
  switch (when) {
    case "today":
      return [today, today];
    case "weekend":
      if (dow === 0) return [today, today];
      return [dow === 6 ? today : thisSaturday(today), addDays(thisSaturday(today), 1)];
    case "next_weekend": {
      const sat = addDays(thisSaturday(today), 7);
      return [sat, addDays(sat, 1)];
    }
    case "week":
      return [today, addDays(today, dow === 0 ? 0 : 7 - dow)];
    case "month":
      return [today, addDays(today, 29)];
    case "this_month":
      return [today, monthEnd(today)];
    case "next_month": {
      const start = nextMonthStart(today);
      return [start, monthEnd(start)];
    }
  }
}

/** 한 달 단위 기간이면 '○월 중'처럼 날짜가 대략적인 행사도 넣을 수 있다 */
export function isMonthScale(when: WhenFilter | null): boolean {
  return when === "month" || when === "this_month" || when === "next_month";
}

export function overlaps(
  start: string,
  end: string,
  [from, to]: [string, string],
): boolean {
  return start.slice(0, 10) <= to && end.slice(0, 10) >= from;
}

export function formatKstDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${y}.${m}.${d}`;
}
