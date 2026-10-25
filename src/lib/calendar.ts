import { addDays, daysBetween, monthEnd } from "@/lib/dates";
import {
  filterEvents,
  getScheduleType,
  isApproxDates,
  type ExplorerFilters,
} from "@/lib/events";
import type { Event } from "@/types/event";

/** 달력에 보여줄 달 수 (이번 달 포함) */
export const CALENDAR_MONTHS = 6;

export interface CalendarCounts {
  /** 이번 달 1일 */
  from: string;
  /** 마지막 달의 말일 */
  to: string;
  /** from부터 날짜별: 그날 열리는 기간 한정 행사 수 (오늘 이전은 0) */
  open: number[];
  /** from부터 날짜별: 그날 새로 시작하는 행사 수 */
  starts: number[];
}

/**
 * 달력 칸 숫자: 다른 조건(지역·카테고리·검색…)은 그대로 두고 날짜별로 센다.
 * 언제나 여는 곳(상시)과 날짜가 대략적인 행사('11월 중')는 날짜 판단을 흐리므로 빼고 센다.
 */
export function buildCalendarCounts(
  events: Event[],
  filters: ExplorerFilters,
  today: string,
): CalendarCounts {
  const from = `${today.slice(0, 7)}-01`;
  let to = monthEnd(from);
  for (let i = 1; i < CALENDAR_MONTHS; i++) to = monthEnd(addDays(to, 1));
  const size = daysBetween(from, to) + 1;
  const diff = new Array<number>(size + 1).fill(0);
  const starts = new Array<number>(size).fill(0);

  const pool = filterEvents(events, { ...filters, when: null, date: null }, today).filter(
    (e) => getScheduleType(e) === "limited" && !isApproxDates(e),
  );
  for (const e of pool) {
    const s = e.start_date.slice(0, 10);
    const en = e.end_date.slice(0, 10);
    // 지난 날은 세지 않는다 (이미 끝난 행사는 목록에서 빠져 있어 숫자가 틀려 보인다)
    const lo = Math.max(daysBetween(from, s), daysBetween(from, today), 0);
    const hi = Math.min(daysBetween(from, en), size - 1);
    if (lo > hi) continue;
    diff[lo] += 1;
    diff[hi + 1] -= 1;
    const startIdx = daysBetween(from, s);
    if (startIdx >= 0 && startIdx < size && s >= today) starts[startIdx] += 1;
  }
  const open: number[] = [];
  let run = 0;
  for (let i = 0; i < size; i++) {
    run += diff[i];
    open.push(run);
  }
  return { from, to, open, starts };
}
