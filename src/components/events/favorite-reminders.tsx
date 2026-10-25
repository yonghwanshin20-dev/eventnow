"use client";

import { useState } from "react";
import { BellRing, ChevronRight, X } from "lucide-react";

import { EventThumb } from "@/components/events/event-thumb";
import { displayTitle } from "@/lib/events";
import {
  dismissRemindersToday,
  favoriteDigest,
  remindersDismissedToday,
} from "@/lib/reminders";
import { cn } from "@/lib/utils";
import type { EventListItem } from "@/types/event";

interface FavoriteRemindersProps {
  /** 찜한 행사 (서버에서 받아 온 것) */
  items: EventListItem[];
  today: string;
  onOpen: (id: string, ids: string[]) => void;
  /** "찜한 3곳이 이번 주말에 열려요" → 찜 + 이번 주말 목록 */
  onWeekend: () => void;
}

const TONE: Record<"urgent" | "soon" | "start", string> = {
  urgent: "text-rose-700",
  soon: "text-amber-800",
  start: "text-teal-800",
};

/**
 * 첫 화면 위 찜 알림: 곧 끝나는·곧 시작하는 찜을 놓치지 않게.
 * 알릴 게 없으면 아무것도 그리지 않고, '오늘은 그만 보기'를 누르면 내일 다시 보인다.
 */
export function FavoriteReminders({ items, today, onOpen, onWeekend }: FavoriteRemindersProps) {
  const [dismissed, setDismissed] = useState(() =>
    typeof window === "undefined" ? false : remindersDismissedToday(today),
  );
  const { reminders, weekendCount } = favoriteDigest(items, today);
  if (dismissed || (reminders.length === 0 && weekendCount === 0)) return null;

  const byId = new Map(items.map((e) => [e.id, e]));
  const ids = reminders.map((r) => r.id);

  return (
    <section
      aria-label="찜한 행사 알림"
      className="rounded-2xl bg-rose-50/70 p-3 ring-1 ring-rose-100"
    >
      <div className="mb-1.5 flex items-center gap-1.5 px-0.5">
        <BellRing className="size-4 text-rose-600" aria-hidden />
        <h2 className="flex-1 text-[14px] font-bold text-stone-900">찜한 행사 알림</h2>
        <button
          type="button"
          onClick={() => {
            dismissRemindersToday(today);
            setDismissed(true);
          }}
          aria-label="오늘은 찜 알림 그만 보기"
          className="-mr-1 flex size-8 items-center justify-center rounded-full text-stone-400 active:bg-rose-100"
        >
          <X className="size-4" />
        </button>
      </div>

      {reminders.length > 0 && (
        <ul className="space-y-1">
          {reminders.map((r) => {
            const e = byId.get(r.id);
            if (!e) return null;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onOpen(r.id, ids)}
                  className="flex w-full items-center gap-2.5 rounded-xl bg-white p-1.5 pr-2 text-left ring-1 ring-rose-100/70 active:bg-rose-50"
                >
                  <EventThumb
                    src={e.thumbnail_url}
                    category={e.category}
                    sizes="48px"
                    className="size-12 shrink-0 rounded-lg"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-stone-900">
                      {displayTitle(e.title)}
                    </span>
                    <span className={cn("block text-[12.5px] font-semibold", TONE[r.tone])}>
                      {r.text}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-stone-400" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {weekendCount > 0 && (
        <button
          type="button"
          onClick={onWeekend}
          className="mt-1.5 flex w-full items-center justify-between rounded-xl px-1.5 py-1.5 text-[13px] text-stone-700 active:bg-rose-100/60"
        >
          <span>
            찜한 곳 중 <span className="font-semibold text-stone-900">{weekendCount}곳</span>이 이번
            주말에 열려요
          </span>
          <span className="inline-flex items-center font-semibold text-rose-700">
            보기
            <ChevronRight className="size-4" aria-hidden />
          </span>
        </button>
      )}
    </section>
  );
}
