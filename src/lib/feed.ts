import { computeStatus, dateWindow, dayOfWeek, daysBetween, todayKst } from "@/lib/dates";
import {
  DEFAULT_EXPLORER_FILTERS,
  filterEvents,
  getScheduleType,
  rankAttractions,
  isApproxDates,
  isIndoor,
  sortEvents,
  toListItem,
  whenRangeText,
  whenTitle,
  type ExplorerFilters,
} from "@/lib/events";
import { isHttpUrl } from "@/lib/images";
import { preferKidAge, type KidAge } from "@/lib/kid-age";
import type { DayWeather } from "@/lib/weather";
import type { Event, EventListItem } from "@/types/event";

export type ShelfKey =
  | "weekend"
  | "ending"
  | "next_weekend"
  | "kids"
  | "exhibition"
  | "next_month"
  | "festival"
  | "attraction"
  | "permanent";

export interface FeedShelf {
  key: ShelfKey;
  title: string;
  hint: string;
  items: EventListItem[];
  /** '전체 보기'를 누르면 적용할 필터 */
  seeAll: Partial<ExplorerFilters>;
}

const SHELF_SIZE = 10;
const CAPITAL_AREA = new Set<string>(["서울특별시", "경기도", "인천광역시"]);

/** 사진이 있는 행사를 앞으로 (순서는 그 안에서 유지) — 첫 화면이 그림으로 보이게 */
function imagesFirst(events: Event[]): Event[] {
  return [
    ...events.filter((e) => isHttpUrl(e.thumbnail_url)),
    ...events.filter((e) => !isHttpUrl(e.thumbnail_url)),
  ];
}

/** 아이 동반 추천을 앞으로 */
function familyFirst(events: Event[]): Event[] {
  return [...events.filter((e) => e.is_family_friendly), ...events.filter((e) => !e.is_family_friendly)];
}

/**
 * 첫 화면 선반: 필터를 고르지 않은 사람에게 "지금 뭐가 있지?"를 바로 보여준다.
 * 같은 행사가 여러 선반에 반복되지 않게 앞 선반에 나온 것은 뒤에서 뺀다.
 */
/** 실내 행사를 앞으로 (비 오는 주말) */
function indoorFirst(events: Event[]): Event[] {
  return [...events.filter((e) => isIndoor(e)), ...events.filter((e) => !isIndoor(e))];
}

/** "토요일 비 예보", "토·일 비 예보" */
function wetHint(days: DayWeather[]): string {
  const names = days.map((d) => "일월화수목금토"[dayOfWeek(d.date)]);
  const label = names.length === 1 ? `${names[0]}요일` : names.join("·");
  const snow = days.every((d) => d.kind === "snow");
  return `${label} ${snow ? "눈" : "비"} 예보 — 실내 위주로 골랐어요`;
}

export interface FeedOptions {
  /** 이번 주말 중 비·눈 예보가 있는 날 */
  weekendWet?: DayWeather[];
  nextWeekendWet?: DayWeather[];
  /** 우리 아이 나이 — 다른 연령 대상 행사는 선반에서 뒤로 */
  kidAge?: KidAge | null;
}

export function buildFeed(
  events: Event[],
  today: string = todayKst(),
  { weekendWet = [], nextWeekendWet = [], kidAge = null }: FeedOptions = {},
): FeedShelf[] {
  const used = new Set<string>();
  const take = (list: Event[]) => {
    const picked = preferKidAge(
      list.filter((e) => !used.has(e.id)),
      kidAge,
    ).slice(0, SHELF_SIZE);
    picked.forEach((e) => used.add(e.id));
    return picked.map((e) => toListItem(e, null, today));
  };
  const base: ExplorerFilters = { ...DEFAULT_EXPLORER_FILTERS };
  const limited = filterEvents(events, { ...base, scheduleType: "limited" }, today);

  const weekend = sortEvents(
    filterEvents(events, { ...base, scheduleType: "limited", when: "weekend" }, today),
    "recommended",
    today,
  );
  const nextWeekend = sortEvents(
    filterEvents(events, { ...base, scheduleType: "limited", when: "next_weekend" }, today),
    "recommended",
    today,
  );
  // 다음 달: 그달에 '새로 시작하는' 행사 (이미 진행 중인 것은 앞 선반에서 충분히 보인다)
  const [monthFrom, monthTo] = dateWindow("next_month", today);
  const nextMonth = limited
    .filter((e) => e.start_date >= monthFrom && e.start_date <= monthTo)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const ending = limited
    .filter((e) => {
      if (computeStatus(e.start_date, e.end_date, today) !== "ongoing") return false;
      // 날짜 미정(한 달 통째 임시 일정)은 '곧 끝나요'에 넣지 않는다
      if (isApproxDates(e)) return false;
      return daysBetween(today, e.end_date) <= 7;
    })
    .sort((a, b) => a.end_date.localeCompare(b.end_date));
  const kids = sortEvents(
    limited.filter((e) => e.category === "kids_experience"),
    "recommended",
    today,
  );
  const exhibitions = sortEvents(
    limited.filter((e) => e.category === "exhibition"),
    "recommended",
    today,
  );
  // 관광지는 전국 수천 곳이라 첫 화면에는 수도권·사진 있는 곳을 먼저
  const attractions = rankAttractions(filterEvents(events, { ...base, category: "attraction" }, today)).sort(
    (a, b) => Number(!CAPITAL_AREA.has(a.region)) - Number(!CAPITAL_AREA.has(b.region)),
  );
  const festivals = limited
    .filter(
      (e) =>
        e.category === "festival" &&
        computeStatus(e.start_date, e.end_date, today) === "upcoming" &&
        daysBetween(today, e.start_date) <= 45,
    )
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  // 관광지는 따로 줄을 두고, '언제든 갈 곳'은 놀이터·공원·상설전시 같은 아이 나들이 장소로
  const permanent = filterEvents(events, { ...base, scheduleType: "permanent" }, today).filter(
    (e) => getScheduleType(e) === "permanent" && e.category !== "attraction",
  );

  const shelves: FeedShelf[] = [
    {
      key: "weekend",
      title: "이번 주말 갈 만한 곳",
      hint: weekendWet.length
        ? `${whenRangeText("weekend", today)} · ${wetHint(weekendWet)}`
        : `${whenRangeText("weekend", today)} 토·일에 열리는 축제·전시·체험`,
      items: take(
        weekendWet.length ? indoorFirst(imagesFirst(familyFirst(weekend))) : imagesFirst(familyFirst(weekend)),
      ),
      seeAll: { when: "weekend", scheduleType: "limited" },
    },
    {
      key: "ending",
      title: "곧 끝나요",
      hint: "일주일 안에 마감 — 놓치기 전에",
      items: take(imagesFirst(ending)),
      seeAll: { scheduleType: "limited", sort: "ending_soon" },
    },
    {
      key: "next_weekend",
      title: "다음 주말엔 여기",
      hint: nextWeekendWet.length
        ? `${whenRangeText("next_weekend", today)} · ${wetHint(nextWeekendWet)}`
        : `${whenRangeText("next_weekend", today)} · 이번 주말과 다른 곳으로 골랐어요`,
      items: take(
        nextWeekendWet.length
          ? indoorFirst(imagesFirst(familyFirst(nextWeekend)))
          : imagesFirst(familyFirst(nextWeekend)),
      ),
      seeAll: { when: "next_weekend", scheduleType: "limited" },
    },
    {
      key: "kids",
      title: "아이랑 체험·공연",
      hint: "어린이·가족 대상 프로그램",
      items: take(imagesFirst(kids)),
      seeAll: { scheduleType: "limited", category: "kids_experience" },
    },
    {
      key: "exhibition",
      title: "지금 볼 만한 전시",
      hint: "미술관·박물관 기획전",
      items: take(imagesFirst(familyFirst(exhibitions))),
      seeAll: { scheduleType: "limited", category: "exhibition" },
    },
    {
      key: "next_month",
      title: `${whenTitle("next_month", today)}에 가 볼 곳`,
      hint: "다음 달에 새로 시작해요 — 미리 계획하기",
      items: take(imagesFirst(familyFirst(nextMonth))),
      seeAll: { when: "next_month", scheduleType: "limited" },
    },
    {
      key: "festival",
      title: "다가오는 축제",
      hint: "한 달 반 안에 시작",
      items: take(imagesFirst(festivals)),
      seeAll: { scheduleType: "limited", category: "festival" },
    },
    {
      key: "attraction",
      title: "가 볼 만한 관광명소",
      hint: "유적지·박물관·자연·도서관 — 언제든 갈 수 있어요",
      items: take(imagesFirst(attractions)),
      seeAll: { category: "attraction" },
    },
    {
      key: "permanent",
      title: "언제든 가는 곳",
      hint: "상시 운영하는 공원·박물관·상설전시",
      items: take(imagesFirst(familyFirst(permanent))),
      seeAll: { scheduleType: "permanent" },
    },
  ];
  return shelves.filter((s) => s.items.length >= 2);
}
