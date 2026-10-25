"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { EventCard } from "@/components/events/event-card";
import { QuickViewListContext } from "@/components/events/quick-view-context";
import type { EventListItem } from "@/types/event";

interface EventShelfProps {
  title: string;
  hint: string;
  items: EventListItem[];
  /** 같은 화면에서 필터를 바꿀 때 */
  onSeeAll?: () => void;
  /** 다른 화면(상세 페이지 등)에서 목록으로 이동할 때 */
  seeAllHref?: string;
  /** 첫 선반은 이미지를 먼저 불러온다 */
  priority?: boolean;
  /** 화면 가까이 올 때까지 카드(사진)를 그리지 않는다 — 첫 화면에 사진 수십 장이 한꺼번에 받아지지 않게 */
  deferUntilVisible?: boolean;
}

/** 가로로 넘겨 보는 선반 — 첫 화면에서 '지금 뭐가 있지?'를 그림으로 훑게 한다 */
export function EventShelf({
  title,
  hint,
  items,
  onSeeAll,
  seeAllHref,
  priority,
  deferUntilVisible = false,
}: EventShelfProps) {
  const rail = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(!deferUntilVisible);
  useEffect(() => {
    if (visible || !section.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisible(true);
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(section.current);
    return () => io.disconnect();
  }, [visible]);
  // 마우스 사용자는 가로 스크롤이 불편해 큰 화면에서만 좌우 버튼을 둔다
  const scrollBy = (dir: 1 | -1) =>
    rail.current?.scrollBy({ left: dir * rail.current.clientWidth * 0.8, behavior: "smooth" });

  return (
    <section ref={section} className="space-y-2.5" aria-label={title}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold tracking-tight text-stone-900">{title}</h2>
          <p className="truncate text-[12.5px] text-stone-500">{hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {seeAllHref ? (
            <Link
              href={seeAllHref}
              className="inline-flex items-center text-[13px] font-medium text-teal-800"
            >
              전체 보기
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : onSeeAll ? (
            <button
              type="button"
              onClick={onSeeAll}
              className="inline-flex items-center text-[13px] font-medium text-teal-800"
            >
              전체 보기
              <ChevronRight className="size-4" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => scrollBy(-1)}
            aria-label={`${title} 이전`}
            className="ml-2 hidden size-8 items-center justify-center rounded-full bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50 sm:inline-flex"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollBy(1)}
            aria-label={`${title} 다음`}
            className="hidden size-8 items-center justify-center rounded-full bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50 sm:inline-flex"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <QuickViewListContext.Provider value={items.map((e) => e.id)}>
        <div ref={rail} className="-mx-3 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-3 px-3 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-4 sm:scroll-px-4 sm:px-4 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
          {visible
            ? items.map((event, i) => (
                <EventCard
                  key={event.id}
                  event={event}
                  priority={priority && i < 3}
                  className="w-[42vw] max-w-[13rem] shrink-0 snap-start sm:w-48"
                />
              ))
            : items.slice(0, 3).map((event) => (
                // 자리만 잡아 두는 빈 카드 (높이가 같아 화면이 튀지 않게)
                <div
                  key={event.id}
                  aria-hidden
                  className="w-[42vw] max-w-[13rem] shrink-0 sm:w-48"
                >
                  <div className="aspect-[4/5] animate-pulse rounded-2xl bg-stone-200/60" />
                  <div className="mt-2 h-4 w-3/4 rounded bg-stone-200/60" />
                  <div className="mt-1.5 h-3 w-1/2 rounded bg-stone-200/40" />
                </div>
              ))}
        </div>
      </QuickViewListContext.Provider>
    </section>
  );
}
