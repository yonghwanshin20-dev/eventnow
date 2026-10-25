import { shortDayLabel } from "@/lib/course";
import { isIsoDate, todayKst } from "@/lib/dates";
import { displayTitle } from "@/lib/events";
import { pickVisitDay } from "@/lib/visit-day";
import type { Event } from "@/types/event";

const MAX_STOPS = 5;

export interface ParsedCourse {
  day: string;
  stops: Event[];
  title: string;
  description: string;
}

function first(v: string | string[] | undefined | null): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** /course?ids=a,b,c&day=YYYY-MM-DD → 코스 (페이지·미리보기 그림이 같이 쓴다). 행사가 하나도 없으면 null */
export function parseCourse(
  params: Record<string, string | string[] | undefined> | URLSearchParams,
  all: Event[],
  today: string = todayKst(),
): ParsedCourse | null {
  const get = (k: string) =>
    params instanceof URLSearchParams ? params.get(k) : first(params[k]);
  const ids = (get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[\w-]{1,64}$/.test(s))
    .slice(0, MAX_STOPS);
  const byId = new Map(all.map((e) => [e.id, e]));
  const stops = [...new Set(ids)].map((id) => byId.get(id)).filter((e): e is Event => e != null);
  if (stops.length === 0) return null;
  const asked = get("day");
  const day = isIsoDate(asked)
    ? asked
    : pickVisitDay(stops[0].start_date.slice(0, 10), stops[0].end_date.slice(0, 10), today);
  return {
    day,
    stops,
    title: `${shortDayLabel(day)} 하루 코스 · ${stops.length}곳`,
    description: stops.map((e) => displayTitle(e.title)).join(" → "),
  };
}
