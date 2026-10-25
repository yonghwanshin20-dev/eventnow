"use client";

import { useState } from "react";
import { CalendarPlus, Heart, Link2, MessageCircle } from "lucide-react";

import { todayKst } from "@/lib/dates";
import { pickVisitDay } from "@/lib/visit-day";
import { formatShortRange } from "@/lib/events";
import { useFavorites } from "@/lib/favorites";
import { buildIcs, googleCalendarUrl } from "@/lib/ics";
import { shareNative, shareToKakao, type SharePayload } from "@/lib/share";
import { cn } from "@/lib/utils";
import type { Event } from "@/types/event";

interface EventActionsProps {
  event: Pick<
    Event,
    | "id"
    | "title"
    | "start_date"
    | "end_date"
    | "location_name"
    | "address"
    | "description"
    | "thumbnail_url"
  >;
  url: string;
  /** 사용자가 고른 날(달력·주말 목록) — 행사 기간 안이면 '가는 날' 기본값으로 */
  planDay?: string | null;
}

const buttonClass =
  "flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium text-stone-700 ring-1 ring-stone-200 transition-colors active:bg-stone-100";

/** 찜 · 카카오톡 · 공유(공유 시트 → 링크 복사) · 캘린더(구글 / .ics) */
export function EventActions({ event, url, planDay }: EventActionsProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const { has, toggle } = useFavorites();
  const saved = has(event.id);
  const today = todayKst();
  const multiDay = event.start_date !== event.end_date;
  const [day, setDay] = useState(() =>
    pickVisitDay(event.start_date, event.end_date, today, planDay),
  );

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 2500);
  };

  const payload: SharePayload = {
    title: event.title,
    description: `${formatShortRange(event.start_date, event.end_date)} · ${event.location_name}`,
    // 사진이 없는 행사는 제목·일정을 그린 미리보기 그림(opengraph-image)으로
    imageUrl: event.thumbnail_url || `${url}/opengraph-image`,
    url,
    buttonTitle: "행사 보기",
  };

  const onKakao = async () => {
    const result = await shareToKakao(payload);
    if (result === "copied") flash("링크를 복사했어요 — 카카오톡 대화방에 붙여넣으세요");
  };
  const onShare = async () => {
    const result = await shareNative(payload);
    if (result === "copied") flash("링크를 복사했어요");
  };

  // 기간이 긴 행사는 통째로 넣으면 달력이 몇 주씩 막히므로 '가는 날' 하루로 넣는다
  const calendarDay = multiDay ? day : undefined;
  const downloadIcs = () => {
    const blob = new Blob([buildIcs(event, url, new Date(), calendarDay)], {
      type: "text/calendar;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${event.title.replace(/[\\/:*?"<>|]/g, "").slice(0, 60) || "event"}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  };

  const minDay = event.start_date > today ? event.start_date : today;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          aria-pressed={saved}
          onClick={() => toggle(event.id)}
          className={cn(buttonClass, saved && "bg-rose-50 text-rose-700 ring-rose-200")}
        >
          <Heart className={cn("size-5", saved && "fill-current")} />
          {saved ? "찜함" : "찜하기"}
        </button>
        <button
          type="button"
          onClick={onKakao}
          className={cn(buttonClass, "bg-[#FEE500] text-[#191919] ring-[#FEE500] active:bg-[#f5dc00]")}
        >
          <MessageCircle className="size-5 fill-current" />
          카카오톡
        </button>
        <button type="button" onClick={onShare} className={buttonClass}>
          <Link2 className="size-5" />
          공유·복사
        </button>
        <button
          type="button"
          aria-expanded={calendarOpen}
          onClick={() => setCalendarOpen((v) => !v)}
          className={cn(buttonClass, calendarOpen && "bg-stone-100")}
        >
          <CalendarPlus className="size-5" />
          캘린더
        </button>
      </div>

      {notice && (
        <p role="status" className="rounded-xl bg-teal-50 px-3 py-2 text-center text-[13px] text-teal-900">
          {notice}
        </p>
      )}

      {calendarOpen && (
        <div className="space-y-2.5 rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
          {multiDay && (
            <label className="flex items-center justify-between gap-3 text-sm text-stone-700">
              <span>
                가는 날
                <span className="block text-[11.5px] text-stone-500">
                  기간 {formatShortRange(event.start_date, event.end_date)} 중 하루
                </span>
              </span>
              <input
                type="date"
                value={day}
                min={minDay <= event.end_date ? minDay : event.start_date}
                max={event.end_date}
                onChange={(e) => e.target.value && setDay(e.target.value)}
                className="h-10 rounded-lg bg-white px-2 text-[15px] ring-1 ring-stone-200"
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <a
              href={googleCalendarUrl(event, url, calendarDay)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-11 items-center justify-center rounded-xl bg-white text-[13.5px] font-semibold text-stone-800 ring-1 ring-stone-200 active:bg-stone-100"
            >
              구글 캘린더
            </a>
            <button
              type="button"
              onClick={downloadIcs}
              className="h-11 rounded-xl bg-white text-[13.5px] font-semibold text-stone-800 ring-1 ring-stone-200 active:bg-stone-100"
            >
              아이폰·기타 (.ics)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
