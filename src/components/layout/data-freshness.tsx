import { daysBetween, todayKst } from "@/lib/dates";
import type { EventsSnapshot } from "@/lib/events-data";
import { cn } from "@/lib/utils";

/** 자동 수집이 이 일수 넘게 멈추면 경고 */
const STALE_AFTER_DAYS = 3;

function shortDate(iso: string): string {
  return `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;
}

/** 데이터 출처·마지막 갱신일을 짧고 사실대로 표시 */
export function DataFreshness({
  snapshot,
  count,
}: {
  snapshot: Pick<EventsSnapshot, "lastUpdatedAt" | "autoCollected" | "degraded">;
  /** 함께 보여줄 행사 수 */
  count?: number;
}) {
  const updatedDay = snapshot.lastUpdatedAt
    ? todayKst(new Date(snapshot.lastUpdatedAt))
    : null;
  const ageDays = updatedDay ? daysBetween(updatedDay, todayKst()) : null;
  const fresh =
    !snapshot.degraded &&
    snapshot.autoCollected &&
    ageDays != null &&
    ageDays <= STALE_AFTER_DAYS;

  let text: string;
  if (fresh) {
    // 매일 새벽 자동 + 버튼으로 수시 갱신되므로 실제 시각을 보여준다
    const time = new Date(snapshot.lastUpdatedAt!).toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Seoul",
    });
    text = ageDays === 0 ? `오늘 ${time} 업데이트` : `${shortDate(updatedDay!)} ${time} 업데이트`;
  } else if (snapshot.degraded) {
    text = "실시간 연결 오류 · 보관 데이터 표시 중";
  } else if (snapshot.autoCollected) {
    text = `${ageDays}일째 업데이트 없음 · 방문 전 공식 정보 확인`;
  } else {
    text = `${updatedDay ? `${shortDate(updatedDay)} 기준 ` : ""}보관 데이터 · 방문 전 공식 정보 확인`;
  }

  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 text-xs",
        fresh ? "text-stone-500" : "text-amber-800",
      )}
    >
      {count != null && (
        <span className="font-medium text-stone-700 sm:hidden">행사 {count}건</span>
      )}
      {count != null && (
        <span aria-hidden className="text-stone-300 sm:hidden">
          ·
        </span>
      )}
      <span className="inline-flex items-center gap-1">
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", fresh ? "bg-teal-600" : "bg-amber-500")}
        />
        {text}
      </span>
    </p>
  );
}
