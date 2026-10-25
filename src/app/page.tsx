import type { Metadata } from "next";
import { cookies } from "next/headers";

import { InstallBanner } from "@/components/layout/install-app";
import { KidAgePicker } from "@/components/layout/kid-age-picker";
import { KID_AGE_COOKIE, parseKidAge, preferKidAge } from "@/lib/kid-age";

import { EventExplorer } from "@/components/events/event-explorer";
import { describeList } from "@/lib/list-meta";
import { SiteHeader } from "@/components/layout/site-header";
import { DataFreshness } from "@/components/layout/data-freshness";
import { RefreshControl } from "@/components/layout/refresh-control";
import { FALLBACK_GENERATED_AT } from "@/data/fallback-events";
import { getRefreshConfig } from "@/lib/refresh";
import { computeStatus, dateWindow, daysBetween, todayKst } from "@/lib/dates";
import { buildCalendarCounts } from "@/lib/calendar";
import type { WhenFilter } from "@/lib/dates";
import { getForecast, isWetDay, weatherFor } from "@/lib/weather";
import {
  DEFAULT_EXPLORER_FILTERS,
  PAGE_SIZE,
  PLAN_SORT_WHENS,
  formatShortRange,
  rankByQuery,
  PLAN_WHENS,
  filterEvents,
  sortForPlan,
  filtersToQueryString,
  getScheduleType,
  searchParamsToFilters,
  sortEvents,
  toListItem,
  whenTitle,
  type ExplorerFilters,
} from "@/lib/events";
import { getEventsSnapshot } from "@/lib/events-data";
import { buildFeed } from "@/lib/feed";

const PERMANENT_PREVIEW = 4;

/** 고른 기간에 맞춘 첫 줄: "다음 주말, 아이랑 어디 가지?" */
function headline(filters: ExplorerFilters, today: string): string {
  if (filters.favorites.length > 0) return "찜한 곳, 언제 갈까?";
  if (filters.date) {
    const d = filters.date;
    return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일, 아이랑 어디 가지?`;
  }
  switch (filters.when) {
    case "today":
      return "오늘, 아이랑 어디 가지?";
    case "next_weekend":
      return "다음 주말, 아이랑 어디 가지?";
    case "week":
      return "이번 주, 아이랑 어디 가지?";
    case "this_month":
      return "이번 달, 아이랑 어디 가지?";
    case "next_month":
      return `${whenTitle("next_month", today)}엔 아이랑 어디 가지?`;
    case "month":
      return "한 달 안에, 아이랑 어디 가지?";
    default:
      return "이번 주말, 아이랑 어디 가지?";
  }
}

interface HomePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * 공유된 링크의 미리보기 (카톡에 링크만 붙여 넣어도 보이는 제목·설명·그림).
 * ?e=<id>로 행사를 연 링크면 그 행사, 조건이 걸린 목록이면 "이번 주말 갈 만한 곳 241곳".
 */
export async function generateMetadata({ searchParams }: HomePageProps): Promise<Metadata> {
  const params = await searchParams;
  const { events } = await getEventsSnapshot();
  const linkedId = typeof params.e === "string" ? params.e : null;
  const linked = linkedId ? events.find((e) => e.id === linkedId) : undefined;
  if (linked) {
    const url = `/events/${linked.id}`;
    // 루트 page는 layout과 같은 구간이라 제목 템플릿("%s | EventNow")이 붙지 않아 직접 붙인다
    return {
      title: { absolute: `${linked.title} | EventNow` },
      description: linked.description?.slice(0, 160) ?? undefined,
      alternates: { canonical: url },
      openGraph: {
        type: "website",
        siteName: "EventNow",
        locale: "ko_KR",
        url,
        title: linked.title,
        description: `${formatShortRange(linked.start_date, linked.end_date)} · ${linked.location_name}`,
        images: [{ url: `${url}/opengraph-image`, width: 1200, height: 630 }],
      },
    };
  }
  const filters = searchParamsToFilters(params);
  const meta = describeList(filters, events);
  if (!meta) return {};
  const qs = filtersToQueryString({ ...filters, limit: PAGE_SIZE, view: "list", near: null });
  return {
    title: { absolute: `${meta.title} | EventNow` },
    description: meta.description,
    // 같은 목록이 여러 주소로 색인되지 않게 (정렬·페이지 수 등은 빼고)
    alternates: { canonical: `/${qs}` },
    openGraph: {
      type: "website",
      siteName: "EventNow",
      locale: "ko_KR",
      url: `/${qs}`,
      title: meta.title,
      description: meta.description,
      images: [{ url: `/og/list${qs}`, width: 1200, height: 630, alt: meta.title }],
    },
  };
}

/** 필터·정렬·페이지를 서버에서 처리해 HTML에 결과가 바로 담기게 한다 (SEO·전송량) */
export default async function HomePage({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const filters = searchParamsToFilters(params);
  const kidAge = parseKidAge((await cookies()).get(KID_AGE_COOKIE)?.value);
  const [snapshot, forecast] = await Promise.all([
    getEventsSnapshot(),
    getForecast(filters.region),
  ]);
  const today = todayKst();
  // 기간 타일에 붙일 날씨 (오늘·이번 주말·다음 주말)
  const planWeather = {
    today: weatherFor(forecast, dateWindow("today", today)),
    weekend: weatherFor(forecast, dateWindow("weekend", today)),
    next_weekend: weatherFor(forecast, dateWindow("next_weekend", today)),
  };
  // 고른 날·기간에 비 소식이 있으면 실내 행사를 권한다
  const selectedWindow = filters.date
    ? ([filters.date, filters.date] as [string, string])
    : filters.when
      ? dateWindow(filters.when, today)
      : null;
  const wetDays =
    selectedWindow && daysBetween(selectedWindow[0], selectedWindow[1]) <= 2
      ? weatherFor(forecast, selectedWindow).filter(isWetDay)
      : [];

  const filtered = filterEvents(snapshot.events, filters, today);
  // 다음 주말·다음 달을 고르면 '그때 새로 시작하는·그때만 하는' 행사를 앞으로
  const sorted =
    filters.sort === "recommended" && !filters.date && filters.when && PLAN_SORT_WHENS.has(filters.when)
      ? sortForPlan(filtered, filters.when, today)
      : sortEvents(filtered, filters.sort, today, filters.near);
  // 검색어가 있으면 (추천순일 때) 제목·장소에 그 말이 있는 행사를 먼저
  const ranked =
    filters.q && filters.sort === "recommended" ? rankByQuery(sorted, filters.q) : sorted;
  // 우리 아이 나이를 정해 두었으면 다른 연령 대상 행사는 뒤로 (추천순일 때만)
  const matchedEvents = filters.sort === "recommended" ? preferKidAge(ranked, kidAge) : ranked;
  // '전체 + 추천순' 목록은 기간 한정 행사를 페이지로 보여주고, 상시 운영 장소는 미리보기만
  // (상시 200여 곳이 기간 한정 뒤에 묻혀 안 보이는 것을 막는다)
  const calendarView = filters.view === "calendar";
  const grouped =
    filters.view === "list" &&
    filters.scheduleType === "all" &&
    filters.sort === "recommended" &&
    !filters.includeEnded &&
    filters.favorites.length === 0;
  // 달력 보기에서는 '그날 열리는 기간 한정 행사'가 중요하다 — 언제나 여는 곳은 따로 고를 때만
  const limitedOnly = grouped || (calendarView && filters.scheduleType === "all");
  const mainEvents = limitedOnly
    ? matchedEvents.filter((e) => getScheduleType(e) === "limited")
    : matchedEvents;
  const items = mainEvents
    .slice(0, filters.limit)
    .map((e) => toListItem(e, filters.near, today));
  // 아무 조건도 고르지 않은 첫 화면이면 사진 선반(이번 주말·곧 끝나요·…)을 먼저 보여준다
  const isHome = filtersToQueryString(filters) === "";
  const feed = isHome
    ? buildFeed(snapshot.events, today, {
        weekendWet: planWeather.weekend.filter(isWetDay),
        nextWeekendWet: planWeather.next_weekend.filter(isWetDay),
        kidAge,
      })
    : null;
  const rainAdvice =
    wetDays.length > 0 && filters.familyTag !== "indoor" && filters.view !== "map"
      ? {
          days: wetDays,
          place: forecast?.place ?? "",
          indoorCount: filterEvents(
            snapshot.events,
            { ...filters, familyTag: "indoor" },
            today,
          ).filter((e) => getScheduleType(e) === "limited").length,
        }
      : null;
  // 공유된 링크(?e=<id>)로 들어오면 그 행사의 빠른 보기를 연다
  const linkedId = typeof params.e === "string" ? params.e : null;
  const linkedEvent = linkedId ? snapshot.events.find((e) => e.id === linkedId) : undefined;
  const linkedItem = linkedEvent ? toListItem(linkedEvent, filters.near, today) : null;
  const permanentPreview = grouped && !feed
    ? matchedEvents
        .filter((e) => getScheduleType(e) === "permanent")
        .slice(0, PERMANENT_PREVIEW)
        .map((e) => toListItem(e, filters.near, today))
    : null;
  // 지도 보기: 좌표 있는 결과 전체를 카드 데이터로 (마커를 누르면 같은 데이터로 빠른 보기)
  const mapItems =
    filters.view === "map"
      ? matchedEvents
          .filter((e) => e.latitude != null && e.longitude != null)
          .map((e) => toListItem(e, filters.near, today))
      : null;
  const active = filterEvents(
    snapshot.events,
    { ...DEFAULT_EXPLORER_FILTERS, includeEnded: filters.includeEnded },
    today,
  );
  const activeCount = active.length;
  // 상단 탭(전체/기간 한정/상시 운영) 건수 — 다른 조건은 그대로 두고 일정 유형만 바꿔 센다
  const sameButSchedule = filterEvents(
    snapshot.events,
    { ...filters, scheduleType: "all" },
    today,
  );
  const limitedCount = sameButSchedule.filter((e) => getScheduleType(e) === "limited").length;
  const scheduleCounts = {
    all: sameButSchedule.length,
    limited: limitedCount,
    permanent: sameButSchedule.length - limitedCount,
  };
  // 카테고리 칩 건수 — 카테고리만 바꿨을 때 몇 건이 나오는지 (0건 칩은 흐리게)
  const sameButCategory = filterEvents(snapshot.events, { ...filters, category: "all" }, today);
  const categoryCounts: Record<string, number> = { all: sameButCategory.length };
  for (const e of sameButCategory) {
    categoryCounts[e.category] = (categoryCounts[e.category] ?? 0) + 1;
  }
  // "언제 갈까" 타일 건수 — 다른 조건은 그대로, 기간만 바꿔서 (기간 한정 행사만 센다)
  const noWhen = { ...filters, when: null, date: null };
  const planCounts = Object.fromEntries(
    (["today", ...PLAN_WHENS] as const).map((when) => [
      when,
      filterEvents(snapshot.events, { ...noWhen, when }, today).filter(
        (e) => getScheduleType(e) === "limited",
      ).length,
    ]),
  ) as Record<WhenFilter, number>;
  const calendar = calendarView ? buildCalendarCounts(snapshot.events, noWhen, today) : null;
  // 목록 구간 제목 옆 건수
  const groupCounts = { limited: 0, permanent: 0, ended: 0 };
  for (const e of matchedEvents) {
    if (computeStatus(e.start_date, e.end_date, today) === "ended") groupCounts.ended++;
    else groupCounts[getScheduleType(e)]++;
  }
  // 위치가 있는 행사가 하나도 없으면 '가까운 순'·지도는 의미가 없다
  const locatable = active.filter((e) => e.latitude != null && e.longitude != null).length;

  return (
    <div className="flex min-h-full flex-col bg-[#f6f3ee]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pt-4 pb-10 sm:px-4 sm:py-10">
        <section className="mb-1 max-w-2xl space-y-1 sm:mb-6 sm:space-y-2">
          <h1 className="text-[22px] font-bold tracking-tight text-stone-900 sm:text-4xl">
            {headline(filters, today)}
          </h1>
          <p className="hidden text-base leading-6 text-stone-600 sm:block">
            지금 열려 있거나 곧 열리는 축제·전시·팝업·키즈 체험 {activeCount}건을
            지역·날짜·가족 조건으로 골라보세요.
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <DataFreshness snapshot={snapshot} count={activeCount} />
            <KidAgePicker initial={kidAge} />
            {snapshot.source === "json" && getRefreshConfig() && (
              <RefreshControl initialDataUpdatedAt={FALLBACK_GENERATED_AT} />
            )}
          </div>
        </section>

        <EventExplorer
          items={items}
          matched={matchedEvents.length}
          pageTotal={mainEvents.length}
          grouped={grouped}
          permanentPreview={permanentPreview}
          mapItems={mapItems}
          locatable={locatable}
          scheduleCounts={scheduleCounts}
          categoryCounts={categoryCounts}
          planCounts={planCounts}
          planWeather={planWeather}
          rainAdvice={rainAdvice}
          calendar={calendar}
          today={today}
          groupCounts={groupCounts}
          feed={feed}
          linkedItem={linkedItem}
          filters={filters}
        />
      </main>
      <InstallBanner />
    </div>
  );
}
