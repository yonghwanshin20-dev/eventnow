"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, MessageCircle, Route } from "lucide-react";

import { EventThumb } from "@/components/events/event-thumb";
import { courseHref, shortDayLabel, type CourseStop } from "@/lib/course";
import { CATEGORY_LABELS, displayTitle } from "@/lib/events";
import { shareToKakao } from "@/lib/share";

interface CourseSuggestionsProps {
  /** 기준 행사 */
  event: { id: string; title: string; thumbnail_url: string | null };
  /** 목록에서 고른 날 (없으면 서버가 이번 주말 등으로 정한다) */
  planDay?: string | null;
}

interface CourseData {
  day: string;
  stops: CourseStop[];
}

/**
 * "10.24(토) 같이 들르기 좋은 곳" — 같은 날 열려 있는 가까운 행사·장소 2~3곳.
 * 이 행사 + 고른 곳을 하루 코스 링크로 묶어 카톡으로 보낼 수 있다.
 */
export function CourseSuggestions({ event, planDay }: CourseSuggestionsProps) {
  const [data, setData] = useState<CourseData | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    const q = new URLSearchParams({ id: event.id });
    if (planDay) q.set("day", planDay);
    fetch(`/api/course?${q}`)
      .then((r) => (r.ok ? (r.json() as Promise<CourseData>) : null))
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [event.id, planDay]);

  if (!data || data.stops.length === 0) return null;
  const ids = [event.id, ...data.stops.map((s) => s.item.id)];
  const href = courseHref(ids, data.day);
  const dayLabel = shortDayLabel(data.day);

  const share = async () => {
    const result = await shareToKakao({
      title: `${dayLabel} 하루 코스 · ${ids.length}곳`,
      description: [event.title, ...data.stops.map((s) => s.item.title)]
        .map(displayTitle)
        .join(" → "),
      imageUrl: event.thumbnail_url,
      url: `${window.location.origin}${href}`,
      buttonTitle: "코스 보기",
    });
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <section aria-label="같은 날 같이 들르기 좋은 곳" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h3 className="flex items-center gap-1.5 text-[15px] font-bold text-stone-900">
          <Route className="size-4 text-teal-700" aria-hidden />
          {dayLabel} 같이 들르기 좋은 곳
        </h3>
        <Link href={href} className="shrink-0 text-[12.5px] font-semibold text-teal-800">
          코스로 보기
        </Link>
      </div>
      <ul className="space-y-1.5">
        {data.stops.map(({ item, km }) => (
          <li key={item.id}>
            <Link
              href={`/events/${item.id}`}
              className="flex items-center gap-2.5 rounded-xl bg-stone-50 p-1.5 pr-2 ring-1 ring-stone-100 active:bg-stone-100"
            >
              <EventThumb
                src={item.thumbnail_url}
                category={item.category}
                sizes="48px"
                className="size-12 shrink-0 rounded-lg"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold text-stone-900">
                  {displayTitle(item.title)}
                </span>
                <span className="block truncate text-[12px] text-stone-500">
                  {km != null ? `${km < 1 ? "1km 안" : `${km}km`} · ` : ""}
                  {item.schedule === "permanent" ? "언제든 방문" : CATEGORY_LABELS[item.category]}
                  {item.location_name ? ` · ${item.location_name}` : ""}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-stone-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={share}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[#FEE500] text-[14px] font-semibold text-[#191919] active:bg-[#f5dc00]"
      >
        <MessageCircle className="size-4 fill-current" aria-hidden />
        {copied ? "코스 링크를 복사했어요" : `이 하루 코스 보내기 (${ids.length}곳)`}
      </button>
    </section>
  );
}
