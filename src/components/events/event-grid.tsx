"use client";

import { Fragment } from "react";
import { History, Infinity as InfinityIcon, Timer } from "lucide-react";

import { EventCard } from "@/components/events/event-card";
import { QuickViewListContext } from "@/components/events/quick-view-context";
import { cn } from "@/lib/utils";
import type { EventListItem } from "@/types/event";

type GroupKey = "limited" | "permanent" | "ended";

const GROUPS: Record<
  GroupKey,
  { title: string; hint: string; icon: typeof Timer; className: string }
> = {
  limited: {
    title: "기간 한정 행사",
    hint: "날짜가 정해진 축제·전시·체험 — 놓치기 전에",
    icon: Timer,
    className: "text-teal-800",
  },
  permanent: {
    title: "언제든 가는 곳",
    hint: "상시 운영하는 공원·박물관·상설전시",
    icon: InfinityIcon,
    className: "text-indigo-800",
  },
  ended: {
    title: "종료된 행사",
    hint: "기록용 — 다음 회차를 기다려요",
    icon: History,
    className: "text-stone-500",
  },
};

function groupOf(event: EventListItem): GroupKey {
  return event.when.tone === "ended" ? "ended" : event.schedule;
}

interface EventGridProps {
  events: EventListItem[];
  emptyHint?: string;
  /** 기간 한정 / 상시 운영 / 종료 구간마다 제목을 넣는다 (추천순 전체 보기) */
  grouped?: boolean;
  /** 구간별 전체 건수 (페이지에 일부만 보여도 정확한 수를 표시) */
  groupCounts?: Partial<Record<GroupKey, number>>;
  /** 맨 앞 구간 제목 생략 — 위 결과 줄("이번 주말 · 241건")이 이미 같은 말을 할 때 */
  hideFirstHeader?: boolean;
}

export function EventGrid({
  events,
  emptyHint,
  grouped = false,
  groupCounts,
  hideFirstHeader = false,
}: EventGridProps) {
  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white/50 px-6 py-16 text-center">
        <p className="text-base font-medium text-stone-800">
          조건에 맞는 이벤트가 없어요
        </p>
        <p className="mt-1 text-sm text-stone-500">
          {emptyHint ?? "필터를 조금 느슨하게 조정해 보세요."}
        </p>
      </div>
    );
  }

  return (
    <QuickViewListContext.Provider value={events.map((e) => e.id)}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 sm:gap-x-4 xl:grid-cols-4">
        {events.map((event, i) => {
          const key = groupOf(event);
          const header =
            grouped && (i === 0 ? !hideFirstHeader : groupOf(events[i - 1]) !== key);
          const group = GROUPS[key];
          const Icon = group.icon;
          const count = groupCounts?.[key];
          return (
            <Fragment key={event.id}>
              {header && (
                <div className={cn("col-span-full px-0.5", i > 0 && "pt-5")}>
                  <h3
                    className={cn(
                      "flex items-center gap-1.5 text-base font-bold tracking-tight",
                      group.className,
                    )}
                  >
                    <Icon className="size-[18px]" aria-hidden />
                    {group.title}
                    {count != null && (
                      <span className="text-sm font-medium text-stone-400">{count}</span>
                    )}
                  </h3>
                  <p className="mt-0.5 text-[13px] text-stone-500">{group.hint}</p>
                </div>
              )}
              <EventCard event={event} priority={i < 4} />
            </Fragment>
          );
        })}
      </div>
    </QuickViewListContext.Provider>
  );
}
