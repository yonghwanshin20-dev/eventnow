"use client";

import { useEffect, useState } from "react";

import { WEATHER_ICON } from "@/components/events/weather-mini";
import { regionShortLabel } from "@/data/regions";
import { addDays, dateWindow, dayOfWeek, todayKst } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { WEATHER_LABEL, isWetDay, type DayWeather, type Forecast } from "@/lib/weather";

/** 지역별 예보는 한 번만 받아 여러 행사에서 같이 쓴다 (넘겨 보기마다 다시 받지 않게) */
const cache = new Map<string, Promise<Forecast | null>>();

function loadForecast(region: string): Promise<Forecast | null> {
  let hit = cache.get(region);
  if (!hit) {
    hit = fetch(`/api/weather?region=${encodeURIComponent(region)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Forecast>) : null))
      .catch(() => null)
      .then((f) => {
        // 실패는 기억하지 않는다 — 잠깐의 오류로 그 지역 날씨가 계속 안 보이지 않게
        if (!f) cache.delete(region);
        return f;
      });
    cache.set(region, hit);
  }
  return hit;
}

/**
 * 이 행사에 갈 만한 날: 고른 날 → 이번 주말(행사 기간 안) → 오늘(진행 중) → 첫날(곧 시작).
 * 상시 장소는 이번 주말.
 */
export function visitDays(
  event: { start_date: string; end_date: string },
  permanent: boolean,
  today: string,
  planDay?: string | null,
): string[] {
  const inRange = (d: string) => permanent || (d >= event.start_date && d <= event.end_date);
  if (planDay && planDay >= today && inRange(planDay)) {
    // 토요일을 골랐으면 일요일 날씨도 (주말 나들이는 이틀 중 고르니까)
    const sunday = addDays(planDay, 1);
    return dayOfWeek(planDay) === 6 && inRange(sunday) ? [planDay, sunday] : [planDay];
  }
  const [sat, sun] = dateWindow("weekend", today);
  const weekend = [...new Set([sat, sun])].filter((d) => d >= today && inRange(d));
  if (weekend.length) return weekend;
  if (inRange(today)) return [today];
  return event.start_date > today ? [event.start_date] : [];
}

interface EventWeatherProps {
  region: string;
  start_date: string;
  end_date: string;
  permanent: boolean;
  planDay?: string | null;
}

/** 빠른 보기 일정 줄 아래: "부산 날씨 · 토 🌦 19° 비 76% · 일 🌦 24°" (16일 안쪽만) */
export function EventWeather({ region, start_date, end_date, permanent, planDay }: EventWeatherProps) {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  useEffect(() => {
    let alive = true;
    loadForecast(region).then((f) => {
      if (alive) setForecast(f);
    });
    return () => {
      alive = false;
    };
  }, [region]);

  const days = visitDays({ start_date, end_date }, permanent, todayKst(), planDay);
  const shown: DayWeather[] = forecast
    ? days.flatMap((d) => forecast.days.filter((w) => w.date === d))
    : [];
  if (shown.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-stone-600">
      <span className="text-stone-500">{regionShortLabel(region)} 날씨</span>
      {shown.map((d) => {
        const Icon = WEATHER_ICON[d.kind];
        const wet = isWetDay(d);
        const dow = "일월화수목금토"[dayOfWeek(d.date)];
        return (
          <span
            key={d.date}
            className={cn("inline-flex items-center gap-1 tabular-nums", wet && "font-semibold text-sky-700")}
          >
            {dow}
            <Icon className="size-3.5" aria-label={WEATHER_LABEL[d.kind]} />
            {d.tmax}°{d.pop >= 30 ? ` · 비 ${d.pop}%` : ""}
          </span>
        );
      })}
    </span>
  );
}
