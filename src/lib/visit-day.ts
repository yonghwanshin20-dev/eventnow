import { dateWindow } from "@/lib/dates";

/**
 * 여러 날 하는 행사에 '가는 날' 하나 고르기: 고른 날 → 이번 주말(토 먼저) → 오늘 → 시작일.
 * 캘린더 저장 기본값과 '같은 날 같이 들르기' 코스의 기준 날짜로 쓴다.
 */
export function pickVisitDay(
  start: string,
  end: string,
  today: string,
  planDay?: string | null,
): string {
  if (planDay && planDay >= start && planDay <= end && planDay >= today) return planDay;
  const [sat, sun] = dateWindow("weekend", today);
  for (const d of [sat, sun]) if (d >= start && d <= end && d >= today) return d;
  if (today >= start && today <= end) return today;
  return start;
}
