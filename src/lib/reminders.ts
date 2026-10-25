import { computeStatus, dateWindow, daysBetween, overlaps, todayKst } from "@/lib/dates";
import type { EventListItem } from "@/types/event";

export interface Reminder {
  id: string;
  /** "4일 남았어요 · 10.24까지", "내일 시작해요" */
  text: string;
  tone: "urgent" | "soon" | "start";
  /** 정렬용 — 작을수록 급함 */
  rank: number;
}

export interface FavoriteDigest {
  /** 곧 끝나거나 곧 시작하는 찜 (급한 순, 최대 3개) */
  reminders: Reminder[];
  /** 이번 주말에 열리는 찜 수 (상시 장소 포함) */
  weekendCount: number;
  /** 이미 끝난 찜 수 (정리 안내용) */
  endedCount: number;
}

const md = (iso: string) => `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;

/**
 * 찜한 행사 중 '지금 챙겨야 할 것'만 골라낸다:
 * 일주일 안에 끝나는 것, 사흘 안에 시작하는 것. 상시 장소·날짜 미정은 알릴 게 없어 뺀다.
 */
export function favoriteDigest(items: EventListItem[], today: string = todayKst()): FavoriteDigest {
  const reminders: Reminder[] = [];
  let weekendCount = 0;
  let endedCount = 0;
  const weekend = dateWindow("weekend", today);

  for (const e of items) {
    const status = computeStatus(e.start_date, e.end_date, today);
    if (status === "ended") {
      endedCount++;
      continue;
    }
    if (e.when.tone === "approx") continue;
    // 상시 장소도 주말에 열려 있으니 센다 (찜+이번 주말 목록의 숫자와 같게). 알림 대상은 아니다
    if (overlaps(e.start_date, e.end_date, weekend)) weekendCount++;
    if (e.schedule === "permanent") continue;

    if (status === "ongoing") {
      const left = daysBetween(today, e.end_date);
      if (left > 7) continue;
      const text =
        left === 0
          ? "오늘이 마지막 날이에요"
          : left === 1
            ? `내일(${md(e.end_date)})까지예요`
            : `${left}일 남았어요 · ${md(e.end_date)}까지`;
      reminders.push({ id: e.id, text, tone: left <= 2 ? "urgent" : "soon", rank: left });
    } else {
      const until = daysBetween(today, e.start_date);
      if (until > 3) continue;
      const text = until === 1 ? "내일 시작해요" : `${until}일 뒤(${md(e.start_date)}) 시작해요`;
      // 시작 알림은 마감 알림보다 덜 급하다
      reminders.push({ id: e.id, text, tone: "start", rank: 10 + until });
    }
  }
  reminders.sort((a, b) => a.rank - b.rank);
  return { reminders: reminders.slice(0, 3), weekendCount, endedCount };
}

const DISMISS_KEY = "eventnow:reminders-dismissed";

/** 오늘 '그만 보기'를 눌렀는지 (날이 바뀌면 다시 보인다) */
export function remindersDismissedToday(today: string = todayKst()): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === today;
  } catch {
    return false;
  }
}

export function dismissRemindersToday(today: string = todayKst()): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, today);
  } catch {
    // 저장 불가 — 이번 화면에서만 닫힌다
  }
}
