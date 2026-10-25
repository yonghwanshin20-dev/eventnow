"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { CalendarCounts } from "@/lib/calendar";
import { addDays, dayOfWeek, daysBetween, monthEnd } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface EventCalendarProps {
  calendar: CalendarCounts;
  today: string;
  /** 고른 날 (없으면 null) */
  selected: string | null;
  onSelect: (day: string | null) => void;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 달 목록: 이번 달 1일부터 calendar.to까지 */
function monthStarts(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addDays(monthEnd(m), 1)) out.push(m);
  return out;
}

/**
 * 그달 안에서 상대적으로 많이 열리는 날일수록 진하게 (최솟값~최댓값 사이 3단계).
 * 매일 200곳 안팎이 열리면 '최댓값 대비'로는 모든 칸이 같은 색이 돼 의미가 없다.
 */
function heat(count: number, min: number, max: number): string {
  if (count === 0) return "bg-white";
  if (max === min) return "bg-teal-50/70";
  const r = (count - min) / (max - min);
  if (r > 0.66) return "bg-teal-100";
  if (r > 0.33) return "bg-teal-50";
  return "bg-white";
}

/**
 * 한 달 달력: 칸마다 그날 열리는 행사 수, 새로 시작하는 날엔 점.
 * 날짜를 누르면 아래 목록이 그날 열리는 행사로 바뀐다.
 */
export function EventCalendar({ calendar, today, selected, onSelect }: EventCalendarProps) {
  const months = monthStarts(calendar.from, calendar.to);
  const initial = Math.max(
    0,
    months.findIndex((m) => m.slice(0, 7) === (selected ?? today).slice(0, 7)),
  );
  const [index, setIndex] = useState(initial);
  const month = months[index] ?? months[0];
  const last = monthEnd(month);
  const lead = dayOfWeek(month);
  const days = daysBetween(month, last) + 1;
  const offset = daysBetween(calendar.from, month);
  const counts = calendar.open.slice(offset, offset + days);
  const future = counts.filter((_, i) => addDays(month, i) >= today && counts[i] > 0);
  const max = Math.max(0, ...future);
  const min = Math.min(max, ...future);
  const [y, m] = month.split("-").map(Number);
  // 이번 달은 이미 다 지나간 주를 접는다 (달 초에 빈 줄이 3~4줄씩 생기지 않게)
  const todayIdx = daysBetween(month, today);
  const skipWeeks = todayIdx > 0 && todayIdx < days ? Math.floor((lead + todayIdx) / 7) : 0;
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i),
  ].slice(skipWeeks * 7);

  return (
    <section aria-label="행사 달력" className="rounded-2xl bg-white p-3 ring-1 ring-stone-200 sm:p-4">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="이전 달"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="flex size-10 items-center justify-center rounded-full text-stone-600 active:bg-stone-100 disabled:opacity-30"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h2 className="text-[17px] font-bold tracking-tight text-stone-900" aria-live="polite">
          {y}년 {m}월
        </h2>
        <button
          type="button"
          aria-label="다음 달"
          disabled={index >= months.length - 1}
          onClick={() => setIndex((i) => Math.min(months.length - 1, i + 1))}
          className="flex size-10 items-center justify-center rounded-full text-stone-600 active:bg-stone-100 disabled:opacity-30"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w, i) => (
          <div
            key={w}
            aria-hidden
            className={cn(
              "pb-1 text-[11.5px] font-semibold",
              i === 0 ? "text-rose-600" : i === 6 ? "text-sky-700" : "text-stone-500",
            )}
          >
            {w}
          </div>
        ))}
        {cells.map((i, cell) => {
          if (i === null) return <div key={`lead-${cell}`} aria-hidden />;
          const day = addDays(month, i);
          const count = counts[i] ?? 0;
          const startsHere = calendar.starts[offset + i] ?? 0;
          const past = day < today;
          const isSelected = day === selected;
          const dow = (lead + i) % 7;
          return (
            <button
              key={day}
              type="button"
              disabled={past}
              aria-pressed={isSelected}
              aria-label={`${m}월 ${i + 1}일 ${WEEKDAYS[dow]}요일${past ? " (지남)" : ` · 행사 ${count}곳${startsHere ? ` · 새로 시작 ${startsHere}곳` : ""}`}`}
              onClick={() => onSelect(isSelected ? null : day)}
              className={cn(
                "relative flex h-14 flex-col items-center justify-start rounded-xl pt-1.5 ring-1 ring-transparent transition-colors sm:h-16",
                past
                  ? "text-stone-300"
                  : isSelected
                    ? "bg-teal-700 text-white"
                    : cn(heat(count, min, max), "ring-stone-100 active:bg-stone-100"),
                day === today && !isSelected && "ring-stone-900",
              )}
            >
              <span
                className={cn(
                  "text-[14px] leading-none font-semibold tabular-nums",
                  !past && !isSelected && dow === 0 && "text-rose-600",
                  !past && !isSelected && dow === 6 && "text-sky-700",
                )}
              >
                {i + 1}
              </span>
              {!past && count > 0 && (
                <span
                  className={cn(
                    "mt-1 text-[11px] leading-none tabular-nums",
                    isSelected ? "text-white/85" : "text-stone-600",
                  )}
                >
                  {count}
                </span>
              )}
              {!past && startsHere > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-1.5 size-1.5 rounded-full",
                    isSelected ? "bg-white" : "bg-amber-500",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-stone-500">
        <span>숫자: 그날 열리는 기간 한정 행사</span>
        <span className="inline-flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-amber-500" aria-hidden />새로 시작하는 날
        </span>
      </p>
    </section>
  );
}
