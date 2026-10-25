"use client";

import Link from "next/link";
import { Infinity as InfinityIcon, Timer } from "lucide-react";

import { EventThumb } from "@/components/events/event-thumb";
import { FavoriteButton } from "@/components/events/favorite-button";
import { useQuickView } from "@/components/events/quick-view-context";
import { detectSubregion, regionShortLabel } from "@/data/regions";
import { CATEGORY_LABELS, displayTitle } from "@/lib/events";
import { ageFit } from "@/lib/kid-age";
import { useKidAge } from "@/lib/use-kid-age";
import { cn } from "@/lib/utils";
import type { EventListItem } from "@/types/event";

export const WHEN_TONE: Record<EventListItem["when"]["tone"], string> = {
  urgent: "bg-rose-600 text-white",
  soon: "bg-amber-400 text-amber-950",
  live: "bg-white/95 text-teal-800",
  upcoming: "bg-sky-600 text-white",
  always: "bg-indigo-600 text-white",
  approx: "bg-white/95 text-amber-800",
  ended: "bg-stone-500 text-white",
};

export function placeLabel(event: Pick<EventListItem, "region" | "address" | "district">): string {
  const sub = detectSubregion(event.region, event.address ?? "", event.district);
  return [regionShortLabel(event.region), sub].filter(Boolean).join(" ");
}

interface EventCardProps {
  event: EventListItem;
  className?: string;
  /** 큰 이미지 로딩 우선 (첫 화면 카드) */
  priority?: boolean;
}

/**
 * 사진 중심 카드: 이미지 위에 남은 기간·찜, 아래에 제목과 '지역 · 일정'.
 * 탭하면 빠른 보기 시트가 열리고(제공자가 있을 때), 새 탭 열기 등은 상세 페이지로 간다.
 */
export function EventCard({ event, className, priority }: EventCardProps) {
  const { api, siblings } = useQuickView();
  const { kid } = useKidAge();
  const fit = ageFit(event, kid);
  const distance =
    event.distance_km != null
      ? `${event.distance_km < 10 ? event.distance_km.toFixed(1) : Math.round(event.distance_km)}km`
      : null;
  const WhenIcon = event.schedule === "permanent" ? InfinityIcon : Timer;

  return (
    <article className={cn("group relative min-w-0", event.status === "ended" && "opacity-60", className)}>
      <Link
        href={`/events/${event.id}`}
        onClick={(e) => {
          if (!api || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          api.open(event.id, siblings.length ? siblings : [event.id]);
        }}
        className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl ring-1 ring-black/5">
          <EventThumb
            src={event.thumbnail_url}
            category={event.category}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]"
            priority={priority}
            showLabel
            align={event.source === "culture_portal" ? "top" : "center"}
          />
          <span
            className={cn(
              "absolute top-2 left-2 inline-flex items-center gap-0.5 rounded-full px-2 py-1 text-[11px] leading-none font-bold shadow-sm",
              WHEN_TONE[event.when.tone],
            )}
          >
            {event.when.tone !== "ended" && <WhenIcon className="size-3" aria-hidden />}
            {event.when.text}
          </span>
          <span className="absolute bottom-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {CATEGORY_LABELS[event.category]}
          </span>
        </div>

        <div className="space-y-0.5 px-0.5 pt-2">
          <h3 className="line-clamp-2 text-[14px] leading-snug font-semibold tracking-tight text-stone-900 group-hover:text-teal-800">
            {displayTitle(event.title)}
          </h3>
          <p className="truncate text-[12px] text-stone-500">
            {placeLabel(event)}
            {distance ? ` · ${distance}` : ""}
          </p>
          <p
            className={cn(
              "text-[12px] tabular-nums",
              event.when.tone === "approx" ? "text-amber-700" : "text-stone-500",
            )}
          >
            {event.date_text}
          </p>
          {(event.is_family_friendly || event.is_free || fit === "fit") && (
            <p className="flex gap-1 pt-0.5 text-[10.5px] font-semibold">
              {fit === "fit" ? (
                <span className="rounded bg-teal-600 px-1.5 py-0.5 text-white">
                  우리 아이 딱
                </span>
              ) : (
                event.is_family_friendly && (
                  <span className="rounded bg-teal-50 px-1.5 py-0.5 text-teal-800">아이 동반</span>
                )
              )}
              {event.is_free && (
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">무료</span>
              )}
            </p>
          )}
        </div>
      </Link>

      <FavoriteButton
        eventId={event.id}
        title={event.title}
        className="absolute top-1.5 right-1.5 size-8 bg-white/90 shadow-sm ring-0 backdrop-blur-sm"
      />
    </article>
  );
}
