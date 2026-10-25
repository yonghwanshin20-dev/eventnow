import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  type LucideIcon,
} from "lucide-react";

import { dayOfWeek } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { WEATHER_LABEL, isWetDay, type DayWeather, type WeatherKind } from "@/lib/weather";

export const WEATHER_ICON: Record<WeatherKind, LucideIcon> = {
  clear: Sun,
  partly: CloudSun,
  cloudy: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning,
};

/** 날씨 한 줄 요약 (스크린리더용): "토 맑음 21도, 일 비 60%" */
export function weatherSpeech(days: DayWeather[]): string {
  return days
    .map((d) => {
      const dow = "일월화수목금토"[dayOfWeek(d.date)];
      const rain = d.pop >= 30 ? ` 강수 ${d.pop}%` : "";
      return `${dow} ${WEATHER_LABEL[d.kind]} ${d.tmax}도${rain}`;
    })
    .join(", ");
}

/** 기간 타일 안의 작은 날씨: [☀ 21°] [🌧 18°] — 비 걱정되는 날은 파랗게 */
export function WeatherMini({ days, inverted = false }: { days: DayWeather[]; inverted?: boolean }) {
  if (days.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5" aria-label={weatherSpeech(days)} role="img">
      {days.map((d) => {
        const Icon = WEATHER_ICON[d.kind];
        const wet = isWetDay(d);
        return (
          <span
            key={d.date}
            className={cn(
              "inline-flex items-center gap-0.5 text-[11px] tabular-nums",
              wet
                ? inverted
                  ? "text-sky-300"
                  : "text-sky-700"
                : inverted
                  ? "text-white/70"
                  : "text-stone-500",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {wet && d.pop >= 30 ? `${d.pop}%` : `${d.tmax}°`}
          </span>
        );
      })}
    </span>
  );
}
