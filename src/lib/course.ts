import { detectSubregion } from "@/data/regions";
import { computeStatus, dayOfWeek } from "@/lib/dates";
import { eventDistanceKm, isApproxDates, sortEvents, toListItem } from "@/lib/events";
import { preferKidAge, type KidAge } from "@/lib/kid-age";
import type { Event, EventListItem } from "@/types/event";

/** 같이 들르기 좋은 거리 (차로 20~30분) */
export const COURSE_MAX_KM = 15;
/** 코스에 넣을 최대 장소 수 (기준 행사 포함) */
export const COURSE_MAX_STOPS = 4;

export interface CourseStop {
  item: EventListItem;
  /** 기준 행사에서의 거리 (좌표가 없으면 null) */
  km: number | null;
}

/** 연도·회차·기호를 뗀 제목 — 같은 행사의 다른 회차/장소를 코스에 또 넣지 않게 */
function loose(title: string): string {
  return title.toLowerCase().replace(/20\d\d|제?\d+회|[^0-9a-z가-힣]/g, "");
}

function openOn(e: Event, day: string): boolean {
  return e.start_date.slice(0, 10) <= day && e.end_date.slice(0, 10) >= day;
}

/**
 * 이 행사와 같은 날 같이 들르기 좋은 곳: 그날 열려 있고, 가까운 곳(좌표가 있으면 15km 안,
 * 없으면 같은 구·시). 상시 장소(공원·박물관)도 넣는다 — 축제 보고 근처 공원에 가는 식.
 * 종류가 한쪽으로 쏠리지 않게, 기준 행사와 다른 종류를 하나는 넣는다.
 */
export function courseStops(
  base: Event,
  all: Event[],
  day: string,
  today: string,
  kid: KidAge | null = null,
  max = COURSE_MAX_STOPS - 1,
): CourseStop[] {
  const baseSub = detectSubregion(base.region, base.address ?? "", base.district);
  const baseKey = loose(base.title);
  const point =
    base.latitude != null && base.longitude != null
      ? { lat: base.latitude, lng: base.longitude }
      : null;

  const pool = all.filter(
    (e) =>
      e.id !== base.id &&
      e.region === base.region &&
      loose(e.title) !== baseKey &&
      openOn(e, day) &&
      computeStatus(e.start_date, e.end_date, today) !== "ended" &&
      !isApproxDates(e),
  );

  const scored = pool
    .map((e) => ({ e, km: point ? eventDistanceKm(e, point) : null }))
    .filter(({ e, km }) => {
      if (km != null) return km <= COURSE_MAX_KM;
      // 좌표가 없으면 같은 구·시만
      return baseSub != null && detectSubregion(e.region, e.address ?? "", e.district) === baseSub;
    });

  // 가까운 순 (좌표 없는 같은 동네는 그 뒤, 추천순). 다른 연령 대상은 뒤로
  const withKm = scored.filter((s) => s.km != null).sort((a, b) => a.km! - b.km!);
  const noKm = sortEvents(
    scored.filter((s) => s.km == null).map((s) => s.e),
    "recommended",
    today,
  ).map((e) => ({ e, km: null as number | null }));
  const ordered = preferKidAge(
    [...withKm, ...noKm].map((s) => ({
      ...s,
      target_age_group: s.e.target_age_group,
      age_min: s.e.age_min,
      age_max: s.e.age_max,
    })),
    kid,
  );

  const picked = ordered.slice(0, max);
  // 다 같은 종류면 다른 종류 하나로 마지막 자리를 바꾼다
  if (picked.length === max && picked.every((s) => s.e.category === base.category)) {
    const other = ordered.slice(max).find((s) => s.e.category !== base.category);
    if (other) picked[max - 1] = other;
  }
  return picked.map(({ e, km }) => ({
    item: toListItem(e, null, today),
    km: km == null ? null : Math.round(km * 10) / 10,
  }));
}

/** "10.24(토)" */
export function shortDayLabel(day: string): string {
  return `${Number(day.slice(5, 7))}.${Number(day.slice(8, 10))}(${"일월화수목금토"[dayOfWeek(day)]})`;
}

/** 코스 공유 주소 */
export function courseHref(ids: string[], day: string): string {
  return `/course?ids=${ids.map(encodeURIComponent).join(",")}&day=${day}`;
}
