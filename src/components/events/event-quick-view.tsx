"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Baby,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Flag,
  MapPin,
  Navigation,
  Ticket,
  UtensilsCrossed,
  Wallet,
  X,
} from "lucide-react";

import { placeLabel, WHEN_TONE } from "@/components/events/event-card";
import { CourseSuggestions } from "@/components/events/course-suggestions";
import { EventActions } from "@/components/events/event-actions";
import { EventWeather } from "@/components/events/event-weather";
import { EventThumb } from "@/components/events/event-thumb";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AGE_GROUP_LABELS,
  CATEGORY_LABELS,
  displayTitle,
  formatAgeRange,
  formatLongRange,
  isOfficialSource,
  placeLines,
  scheduleHint,
} from "@/lib/events";
import { feedbackHref } from "@/lib/feedback";
import { ageFit, kidAgeLabel } from "@/lib/kid-age";
import { useKidAge } from "@/lib/use-kid-age";
import { mapsUrl, resolveInfoUrl } from "@/lib/links";
import { cn } from "@/lib/utils";
import type { EventListItem } from "@/types/event";

interface EventQuickViewProps {
  event: EventListItem | null;
  /** 같은 목록의 id 순서 (이전/다음) */
  siblings: string[];
  onClose: () => void;
  onNavigate: (id: string) => void;
  /** 목록에서 고른 날(달력의 날짜·주말 첫날) — 캘린더 '가는 날' 기본값 */
  planDay?: string | null;
}

const SWIPE_PX = 50;

/**
 * 빠른 보기: 목록에서 카드를 누르면 아래에서 올라오는 시트.
 * 핵심 정보와 바로 할 일(길찾기·공식 정보·찜·공유·캘린더)을 한 화면에 모으고,
 * 좌우로 넘겨 같은 목록의 다음 행사를 본다. 뒤로가기로 닫힌다.
 */
export function EventQuickView({
  event,
  siblings,
  onClose,
  onNavigate,
  planDay = null,
}: EventQuickViewProps) {
  const index = event ? siblings.indexOf(event.id) : -1;
  const prevId = index > 0 ? siblings[index - 1] : null;
  const nextId = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const touch = useRef<{ x: number; y: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);

  // 다른 행사로 넘어가면 맨 위·접힌 설명으로 (렌더 중 상태 보정)
  if (event && shownId !== event.id) {
    setShownId(event.id);
    setExpanded(false);
  }
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [shownId]);

  useEffect(() => {
    if (!event) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && prevId) onNavigate(prevId);
      if (e.key === "ArrowRight" && nextId) onNavigate(nextId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [event, prevId, nextId, onNavigate]);

  const info = event ? resolveInfoUrl(event) : null;
  const place = event ? placeLines(event) : { main: "", sub: null };
  const hint = event
    ? scheduleHint(event, {
        permanent: event.schedule === "permanent",
        approx: event.when.tone === "approx",
      })
    : null;
  const poster = event?.source === "culture_portal";
  const { kid } = useKidAge();
  const fit = event ? ageFit(event, kid) : null;
  const ageText = event ? formatAgeRange(event.age_min, event.age_max) : null;

  return (
    <Sheet open={event != null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto max-h-[92dvh] w-full max-w-xl gap-0 overflow-hidden rounded-t-3xl border-0 bg-white p-0 sm:bottom-4 sm:rounded-3xl"
      >
        {event && info && (
          <div className="flex max-h-[92dvh] flex-col">
            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div
                className="relative"
                onTouchStart={(e) => {
                  touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                }}
                onTouchEnd={(e) => {
                  const start = touch.current;
                  touch.current = null;
                  if (!start) return;
                  const dx = e.changedTouches[0].clientX - start.x;
                  const dy = e.changedTouches[0].clientY - start.y;
                  if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return;
                  if (dx < 0 && nextId) onNavigate(nextId);
                  if (dx > 0 && prevId) onNavigate(prevId);
                }}
              >
                <EventThumb
                  key={event.id}
                  src={event.thumbnail_url}
                  category={event.category}
                  sizes="(max-width: 640px) 100vw, 576px"
                  className={cn("w-full", poster ? "aspect-[4/3]" : "aspect-[16/10]")}
                  fallbackClassName="h-36 w-full"
                  fit={poster ? "contain" : "cover"}
                  priority
                  showLabel
                />
                <span
                  aria-hidden
                  className="absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/80 shadow"
                />
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="닫기"
                  className="absolute top-3 right-3 flex size-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm"
                >
                  <X className="size-5" />
                </button>
                {prevId && (
                  <NavButton side="left" label="이전 행사" onClick={() => onNavigate(prevId)}>
                    <ChevronLeft className="size-5" />
                  </NavButton>
                )}
                {nextId && (
                  <NavButton side="right" label="다음 행사" onClick={() => onNavigate(nextId)}>
                    <ChevronRight className="size-5" />
                  </NavButton>
                )}
                {siblings.length > 1 && index >= 0 && (
                  <span className="absolute right-3 bottom-3 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
                    {index + 1} / {siblings.length}
                  </span>
                )}
              </div>

              <div className="space-y-4 px-4 pt-4 pb-5">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 leading-none ring-1 ring-black/5",
                        WHEN_TONE[event.when.tone],
                      )}
                    >
                      {event.when.text}
                    </span>
                    <span className="rounded-full bg-stone-100 px-2.5 py-1 leading-none text-stone-700">
                      {CATEGORY_LABELS[event.category]}
                    </span>
                    {event.is_family_friendly && (
                      <span className="rounded-full bg-teal-50 px-2.5 py-1 leading-none text-teal-800">
                        아이 동반
                      </span>
                    )}
                    {event.is_free && (
                      <span className="rounded-full bg-emerald-50 px-2.5 py-1 leading-none text-emerald-800">
                        무료
                      </span>
                    )}
                  </div>
                  <SheetTitle className="text-xl leading-snug font-bold tracking-tight text-stone-900">
                    {displayTitle(event.title)}
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    {placeLabel(event)} · {event.date_text}
                  </SheetDescription>
                </div>

                <dl className="divide-y divide-stone-100 rounded-2xl bg-stone-50 px-3.5 text-[14px]">
                  <Row icon={<CalendarDays className="size-4" />} label="일정">
                    {event.schedule === "permanent"
                      ? "상시 운영 · 언제든 방문"
                      : event.when.tone === "approx"
                        ? `${event.date_text} · 정확한 날짜 확인 필요`
                        : formatLongRange(event.start_date, event.end_date)}
                    {hint && (
                      <span className="mt-0.5 block text-[12.5px] font-semibold text-teal-700">
                        {hint}
                      </span>
                    )}
                    {/* 공식 목록과 매일 맞춰 보지 못하는 일정 (직접 모은 행사) */}
                    {event.schedule === "limited" &&
                      event.when.tone !== "approx" &&
                      !isOfficialSource(event.source) && (
                        <span className="mt-0.5 block text-[12px] text-stone-500">
                          자동 확인되지 않은 일정이에요 · 방문 전 공식 안내를 확인하세요
                        </span>
                      )}
                    {/* 날짜가 대략적인 행사는 어느 날 날씨인지 말할 수 없어 뺀다 */}
                    {event.when.tone !== "ended" && event.when.tone !== "approx" && (
                      <EventWeather
                        region={event.region}
                        start_date={event.start_date}
                        end_date={event.end_date}
                        permanent={event.schedule === "permanent"}
                        planDay={planDay}
                      />
                    )}
                  </Row>
                  <Row
                    icon={<MapPin className="size-4" />}
                    label="장소"
                    action={
                      <a
                        href={mapsUrl(event)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-teal-800 ring-1 ring-stone-200"
                      >
                        <Navigation className="size-3.5" />
                        길찾기
                      </a>
                    }
                  >
                    <span className="line-clamp-2 font-medium break-keep">{place.main}</span>
                    {place.sub && (
                      <span className="block truncate text-[12.5px] text-stone-500">{place.sub}</span>
                    )}
                  </Row>
                  <Row icon={<Wallet className="size-4" />} label="요금">
                    {event.price_info ?? <span className="text-stone-500">공식 정보 확인</span>}
                  </Row>
                  <Row icon={<Ticket className="size-4" />} label="예약">
                    {event.booking_required ? "사전 예약 필요" : "현장 방문 가능"}
                  </Row>
                  {(ageText || event.target_age_group) && (
                    <Row icon={<Baby className="size-4" />} label="대상">
                      {ageText ?? AGE_GROUP_LABELS[event.target_age_group!]}
                      {fit && kid && (
                        <span
                          className={cn(
                            "mt-0.5 block text-[12.5px] font-semibold",
                            fit === "fit" ? "text-teal-700" : "text-amber-700",
                          )}
                        >
                          {fit === "fit"
                            ? `우리 아이(${kidAgeLabel(kid)})에게 딱 맞아요`
                            : `우리 아이(${kidAgeLabel(kid)})와는 대상 연령이 달라요`}
                        </span>
                      )}
                    </Row>
                  )}
                </dl>

                {event.description && (
                  <div>
                    <p
                      className={cn(
                        "text-[14.5px] leading-6 whitespace-pre-line text-stone-700",
                        !expanded && "line-clamp-4",
                      )}
                    >
                      {event.description}
                    </p>
                    {!expanded && event.description.length > 120 && (
                      <button
                        type="button"
                        onClick={() => setExpanded(true)}
                        className="mt-1 text-[13px] font-medium text-teal-800"
                      >
                        더 보기
                      </button>
                    )}
                  </div>
                )}

                <EventActions
                  key={event.id}
                  event={event}
                  planDay={planDay}
                  url={
                    typeof window === "undefined"
                      ? `/events/${event.id}`
                      : `${window.location.origin}/events/${event.id}`
                  }
                />

                {/* 날짜가 정해진(또는 상시) 행사만 — 끝났거나 날짜 미정이면 '같은 날'을 정할 수 없다 */}
                {event.when.tone !== "ended" && event.when.tone !== "approx" && (
                  <CourseSuggestions key={event.id} event={event} planDay={planDay} />
                )}

                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <Link
                    href={`/food?event=${encodeURIComponent(event.id)}`}
                    className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1.5 font-semibold text-orange-800 ring-1 ring-orange-100"
                  >
                    <UtensilsCrossed className="size-3.5" aria-hidden />
                    주변 맛집 보기
                  </Link>
                  <Link
                    href={feedbackHref(event)}
                    className="inline-flex items-center gap-1 font-medium text-stone-500 underline-offset-2 hover:underline"
                  >
                    <Flag className="size-3.5" aria-hidden />
                    정보가 틀렸어요
                  </Link>
                </div>
              </div>
            </div>

            <div className="flex gap-2 border-t border-stone-100 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Link
                href={`/events/${event.id}`}
                className="inline-flex h-12 flex-1 items-center justify-center rounded-xl text-[15px] font-semibold text-stone-800 ring-1 ring-stone-200 active:bg-stone-50"
              >
                자세히 보기
              </Link>
              <a
                href={info.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-xl bg-teal-700 text-[15px] font-semibold text-white active:bg-teal-800"
              >
                {info.kind === "official" ? info.label : "정보 검색"}
                <ExternalLink className="size-4" />
              </a>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function NavButton({
  side,
  label,
  onClick,
  children,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "absolute top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-stone-800 shadow backdrop-blur-sm",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      {children}
    </button>
  );
}

function Row({
  icon,
  label,
  children,
  action,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <dt className="flex w-14 shrink-0 items-center gap-1.5 text-[12.5px] text-stone-500">
        <span className="text-teal-700">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-stone-800">{children}</dd>
      {action}
    </div>
  );
}
