"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpDown,
  CalendarDays,
  Heart,
  Infinity as InfinityIcon,
  Timer,
  List,
  Map as MapIcon,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { ActiveFilterChips } from "@/components/events/active-filter-chips";
import { BottomTabBar } from "@/components/events/bottom-tab-bar";
import { CategoryFilterBar } from "@/components/events/category-filter-bar";
import { EventGrid } from "@/components/events/event-grid";
import { EventQuickView } from "@/components/events/event-quick-view";
import { EventShelf } from "@/components/events/event-shelf";
import { QuickViewContext, type QuickViewApi } from "@/components/events/quick-view-context";
import {
  POPULAR_KEYWORDS,
  SearchSuggestions,
  loadRecentSearches,
  saveRecentSearch,
} from "@/components/events/search-suggestions";
import { FamilyFilter } from "@/components/events/family-filter";
import { RegionFilter } from "@/components/events/region-filter";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EventCalendar } from "@/components/events/event-calendar";
import { FavoriteReminders } from "@/components/events/favorite-reminders";
import { ShareListButton } from "@/components/events/share-list-button";
import { WEATHER_ICON, WeatherMini, weatherSpeech } from "@/components/events/weather-mini";
import type { DayWeather } from "@/lib/weather";
import type { CalendarCounts } from "@/lib/calendar";
import { dateWindow, dayOfWeek, type WhenFilter } from "@/lib/dates";
import {
  DEFAULT_EXPLORER_FILTERS,
  PAGE_SIZE,
  PLAN_WHENS,
  SCHEDULE_TYPE_OPTIONS,
  SORT_OPTIONS,
  WHEN_OPTIONS,
  countActiveFilters,
  filtersToQueryString,
  whenRangeText,
  whenTitle,
  type ExplorerFilters,
  type ScheduleTypeFilter,
  type SortOption,
} from "@/lib/events";
import { useFavorites } from "@/lib/favorites";
import type { FeedShelf } from "@/lib/feed";
import { cn } from "@/lib/utils";
import type { EventListItem } from "@/types/event";

const EventMap = dynamic(() => import("@/components/events/event-map"), {
  ssr: false,
  loading: () => (
    <div className="h-[calc(100dvh-14rem)] min-h-80 animate-pulse rounded-2xl bg-stone-200/50" />
  ),
});

interface EventExplorerProps {
  /** 서버에서 필터·정렬·페이지 적용한 결과 */
  items: EventListItem[];
  /** 필터 적용 후 전체 건수 */
  matched: number;
  /** "더 보기" 기준 건수 (묶어 보기에서는 기간 한정만) */
  pageTotal: number;
  /** 기간 한정 / 상시 운영 구간으로 나눠 보여주는지 */
  grouped: boolean;
  /** 묶어 보기일 때 상시 운영 장소 미리보기 */
  permanentPreview: EventListItem[] | null;
  /** 지도 보기일 때만 (좌표 있는 결과 전체) */
  mapItems: EventListItem[] | null;
  /** 위치 정보가 있는 행사 수 (0이면 가까운 순 숨김) */
  locatable: number;
  /** 상단 탭 건수 (일정 유형만 바꿨을 때) */
  scheduleCounts: Record<ScheduleTypeFilter, number>;
  /** 카테고리 칩 건수 (카테고리만 바꿨을 때, 'all' 포함) */
  categoryCounts: Record<string, number>;
  /** "언제 갈까" 타일 건수 (기간만 바꿨을 때, 기간 한정 행사) */
  planCounts: Partial<Record<WhenFilter, number>>;
  /** 기간 타일 날씨 (예보를 못 받으면 빈 배열) */
  planWeather: PlanWeather;
  /** 고른 날에 비 소식이 있을 때 실내 추천 */
  rainAdvice: { days: DayWeather[]; place: string; indoorCount: number } | null;
  /** 달력 보기일 때 날짜별 건수 */
  calendar: CalendarCounts | null;
  /** 서버 기준 오늘 (KST) */
  today: string;
  /** 목록 구간 제목 옆 건수 */
  groupCounts: { limited: number; permanent: number; ended: number };
  /** 필터 없는 첫 화면의 선반들 */
  feed: FeedShelf[] | null;
  /** 링크로 바로 열린 빠른 보기 행사 (현재 목록에 없을 수 있음) */
  linkedItem: EventListItem | null;
  filters: ExplorerFilters;
}

const SCHEDULE_TAB_STYLE: Record<ScheduleTypeFilter, { active: string; icon: typeof Timer | null }> = {
  all: { active: "bg-stone-900 text-white", icon: null },
  limited: { active: "bg-teal-700 text-white", icon: Timer },
  permanent: { active: "bg-indigo-700 text-white", icon: InfinityIcon },
};

type PlanWeather = Record<"today" | "weekend" | "next_weekend", DayWeather[]>;

/** 고른 날에 비·눈 예보가 있으면: "토요일 비 60% 예보 · 실내에서 즐길 곳 87곳 [실내만 보기]" */
function RainAdvice({
  advice,
  onIndoor,
}: {
  advice: NonNullable<EventExplorerProps["rainAdvice"]>;
  onIndoor: () => void;
}) {
  const worst = advice.days.reduce((a, b) => (b.pop > a.pop ? b : a));
  const Icon = WEATHER_ICON[worst.kind];
  const names = advice.days.map((d) => "일월화수목금토"[dayOfWeek(d.date)]);
  const when = names.length === 1 ? `${names[0]}요일` : names.join("·");
  const what = worst.kind === "snow" ? "눈" : "비";
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-sky-50 px-3.5 py-3 ring-1 ring-sky-100">
      <Icon className="size-6 shrink-0 text-sky-700" aria-hidden />
      <p className="min-w-0 flex-1 text-[13.5px] leading-5 text-sky-950">
        <span className="font-semibold">
          {when} {what}
          {worst.pop > 0 ? ` ${worst.pop}%` : ""} 예보
        </span>
        {advice.place ? ` (${advice.place})` : ""}
        <span className="block text-[12.5px] text-sky-800">
          실내에서 즐길 곳 {advice.indoorCount}곳이 있어요
        </span>
      </p>
      {advice.indoorCount > 0 && (
        <button
          type="button"
          onClick={onIndoor}
          className="h-9 shrink-0 rounded-full bg-sky-700 px-3.5 text-[13px] font-semibold text-white active:bg-sky-800"
        >
          실내만 보기
        </button>
      )}
    </div>
  );
}

const QUICK_STATE = "eventnowQuick";
/** 지금 기록의 빠른 보기 표시만 옮긴다. Next 내부 키(__NA)를 넘기면 라우터가 주소 변경을 못 알아챈다 */
const quickMark = () =>
  window.history.state?.[QUICK_STATE] ? { [QUICK_STATE]: true } : null;

const chipClass = (selected: boolean) =>
  cn(
    "inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3.5 text-sm font-medium transition-colors",
    selected
      ? "bg-teal-700 text-white"
      : "bg-white text-stone-700 ring-1 ring-stone-200 active:bg-stone-100",
  );

const planTileClass = (selected: boolean) =>
  cn(
    "flex w-[6.4rem] shrink-0 flex-col items-start gap-0.5 rounded-2xl px-3 py-2.5 text-left transition-colors sm:w-28",
    selected
      ? "bg-stone-900 text-white shadow-sm"
      : "bg-white text-stone-900 ring-1 ring-stone-200 active:bg-stone-100",
  );

const scrollRow =
  "-mx-3 flex gap-1.5 overflow-x-auto px-3 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden";

export function EventExplorer({
  items,
  matched,
  pageTotal,
  grouped,
  permanentPreview,
  mapItems,
  locatable,
  scheduleCounts,
  categoryCounts,
  planCounts,
  planWeather,
  rainAdvice,
  calendar,
  today,
  groupCounts,
  feed,
  linkedItem,
  filters,
}: EventExplorerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [navHint, setNavHint] = useState<string | null>(null);
  useEffect(() => {
    if (!navHint) return;
    const t = setTimeout(() => setNavHint(null), 2500);
    return () => clearTimeout(t);
  }, [navHint]);
  const [query, setQuery] = useState(filters.q);
  const favorites = useFavorites();
  const favoritesOnly = filters.favorites.length > 0;

  // 뒤로가기 등으로 URL이 바뀌면 입력값도 따라감 (렌더 중 상태 보정)
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (syncedQ !== filters.q) {
    setSyncedQ(filters.q);
    setQuery(filters.q);
  }

  // --- 빠른 보기: ?e=<id> 로 열려 있어 뒤로가기로 닫히고 링크로 공유된다 ---
  const searchParams = useSearchParams();
  const openId = searchParams.get("e");
  const [siblings, setSiblings] = useState<string[]>([]);
  const pushedRef = useRef(false);

  // --- 찜 알림: 찜은 브라우저에만 있어 그 행사들만 서버에서 받아 온다 ---
  const [favoriteItems, setFavoriteItems] = useState<EventListItem[]>([]);
  const favoriteIdsKey = favorites.ids.join(",");
  useEffect(() => {
    if (!favoriteIdsKey) return;
    let alive = true;
    fetch(`/api/favorites?ids=${encodeURIComponent(favoriteIdsKey)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ items: EventListItem[] }>) : null))
      .then((data) => {
        // 바꿔 끼우지 않고 합친다 — 알림에서 연 행사를 그 안에서 찜 해제해도 열린 화면이 사라지지 않게
        // (알림 목록은 아래에서 지금 찜한 것만 골라 보여준다)
        if (alive && data) {
          setFavoriteItems((prev) => {
            const map = new Map(prev.map((e) => [e.id, e]));
            for (const e of data.items) map.set(e.id, e);
            return [...map.values()];
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [favoriteIdsKey]);
  // 찜을 해제하면 다시 받기 전에도 바로 빠지게
  const currentFavoriteItems = favoriteItems.filter((e) => favorites.ids.includes(e.id));
  const isHomeView = filtersToQueryString(filters) === "";
  const resultsRef = useRef<HTMLDivElement>(null);

  const byId = useMemo(() => {
    const map = new Map<string, EventListItem>();
    for (const list of [
      items,
      permanentPreview ?? [],
      mapItems ?? [],
      ...(feed ?? []).map((s) => s.items),
    ]) {
      for (const e of list) map.set(e.id, e);
    }
    if (linkedItem) map.set(linkedItem.id, linkedItem);
    // 찜 알림에서 여는 행사는 지금 목록에 없을 수 있다
    for (const e of favoriteItems) if (!map.has(e.id)) map.set(e.id, e);
    return map;
  }, [items, permanentPreview, mapItems, feed, linkedItem, favoriteItems]);
  const mapPoints = useMemo(
    () =>
      (mapItems ?? []).flatMap((e) =>
        e.coords
          ? [
              {
                id: e.id,
                title: e.title,
                category: e.category,
                start_date: e.start_date,
                end_date: e.end_date,
                latitude: e.coords[0],
                longitude: e.coords[1],
              },
            ]
          : [],
      ),
    [mapItems],
  );
  const quickEvent = openId ? (byId.get(openId) ?? null) : null;

  const withQuickId = (id: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if (id) params.set("e", id);
    else params.delete("e");
    const qs = params.toString();
    return `${pathname}${qs ? `?${qs}` : ""}`;
  };

  const quickApi = useMemo<QuickViewApi>(
    () => ({
      open: (id, list) => {
        setSiblings(list);
        // 이미 열려 있으면(시트 안의 관련 카드 등) 기록을 또 쌓지 않고 바꿔 끼운다 — 닫기 한 번에 목록으로
        if (new URLSearchParams(window.location.search).has("e")) {
          window.history.replaceState(quickMark(), "", withQuickId(id));
          return;
        }
        // 우리가 쌓은 기록임을 history.state에 표시 — 새로고침해도 남아 닫을 때 뒤로가기로 정리된다
        window.history.pushState({ [QUICK_STATE]: true }, "", withQuickId(id));
        pushedRef.current = true;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname],
  );

  const closeQuick = useCallback(() => {
    if (pushedRef.current || window.history.state?.[QUICK_STATE]) {
      pushedRef.current = false;
      window.history.back();
    } else {
      // 공유 링크로 바로 들어온 경우: 돌아갈 목록 기록이 없으니 주소에서 ?e 만 지운다
      window.history.replaceState(null, "", withQuickId(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const navigateQuick = useCallback(
    // 옆 행사로 넘길 때 표시(QUICK_STATE)를 잃지 않게 지금 state를 그대로 넘긴다
    (id: string) => window.history.replaceState(quickMark(), "", withQuickId(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pathname],
  );

  // 뒤로가기로 시트가 닫히면 우리가 쌓은 기록도 소비된 것으로 본다
  useEffect(() => {
    if (!openId) pushedRef.current = false;
  }, [openId]);

  // 주소에 ?e=가 있는데 보여줄 행사가 없으면(정리된 행사 링크 등) 주소·기록을 정리한다 —
  // 안 그러면 보이지 않는 빠른 보기가 '열린' 상태로 남아 뒤로가기·찜 동기화가 멈춘다
  useEffect(() => {
    if (openId && !quickEvent) closeQuick();
  }, [openId, quickEvent, closeQuick]);

  // 이동이 끝나기 전에 또 바꿔도 앞의 변경이 사라지지 않게, 마지막으로 요청한 필터를 기억한다
  const latestFilters = useRef(filters);
  useEffect(() => {
    latestFilters.current = filters;
  }, [filters]);

  const writeFilters = (next: ExplorerFilters) => {
    latestFilters.current = next;
    const qs = filtersToQueryString(next);
    startTransition(() => {
      router.replace(`${pathname}${qs}`, { scroll: false });
    });
  };

  /** 결과가 바뀌는 변경은 페이지 수를 처음으로 되돌린다 */
  const updateFilters = (
    updater: Partial<ExplorerFilters> | ((prev: ExplorerFilters) => ExplorerFilters),
  ) => {
    const base = latestFilters.current;
    const next = typeof updater === "function" ? updater(base) : { ...base, ...updater };
    writeFilters({ ...next, limit: PAGE_SIZE });
  };

  // 찜만 보기 중 찜을 추가/해제하면 목록도 갱신.
  // 단, 보고 있는 목록이 '내 찜'일 때만 — 친구가 보낸 찜 목록(?fav=…)을 열었을 때
  // 내 찜으로 바꿔 버리지 않게, 바뀌기 직전의 내 찜과 같은 목록이었는지 본다.
  // 빠른 보기가 열려 있는 동안은 닫힌 뒤에 맞춘다.
  const favKey = favorites.ids.join(",");
  const syncedFavKey = useRef<string | null>(null);
  useEffect(() => {
    if (!favorites.ready || openId) return;
    const prev = syncedFavKey.current;
    syncedFavKey.current = favKey;
    if (prev === null || !favoritesOnly) return;
    const shown = latestFilters.current.favorites.join(",");
    if (shown === favKey || shown !== prev) return;
    updateFilters({ favorites: favorites.ids });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favKey, openId, favorites.ready]);

  const [searchFocused, setSearchFocused] = useState(false);
  const skipBlurSubmit = useRef(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const submitQuery = (value: string) => {
    const term = value.trim();
    if (term) {
      saveRecentSearch(term);
      setRecentSearches(loadRecentSearches());
    }
    if (term === latestFilters.current.q) return;
    updateFilters({ q: term });
  };

  const setSort = (sort: SortOption) => {
    setGeoError(null);
    if (sort !== "near") {
      updateFilters({ sort });
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeoError("이 브라우저는 위치 정보를 지원하지 않아요.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        updateFilters({
          sort: "near",
          near: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        }),
      () => setGeoError("위치 권한이 없어 가까운 순으로 정렬할 수 없어요."),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    );
  };

  const resetAll = () => {
    setQuery("");
    writeFilters(DEFAULT_EXPLORER_FILTERS);
  };

  // 상단 칩(날짜·카테고리·찜)과 검색어는 따로 보이므로 시트 안 필터만 센다
  const sheetCount =
    countActiveFilters({
      ...filters,
      category: "all",
      scheduleType: "all",
      when: null,
      date: null,
    });
  const anyActive =
    sheetCount > 0 ||
    filters.category !== "all" ||
    filters.scheduleType !== "all" ||
    Boolean(filters.when || filters.date || filters.q || favoritesOnly);

  const activeCountWithoutQuery = countActiveFilters({ ...filters, q: "" }) + (favoritesOnly ? 1 : 0);

  const moreRef = useRef<HTMLDivElement>(null);
  const canLoadMore = filters.view !== "map" && items.length < pageTotal;
  const loadMoreRef = useRef<() => void>(() => {});
  // 관찰자 콜백이 항상 최신 필터로 다음 묶음을 부르게 렌더 후에 갱신
  useEffect(() => {
    loadMoreRef.current = () => {
      if (!isPending) writeFilters({ ...filters, limit: filters.limit + PAGE_SIZE });
    };
  });
  useEffect(() => {
    const el = moreRef.current;
    if (!el || !canLoadMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current();
      },
      { rootMargin: "800px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [canLoadMore, items.length]);

  // 고른 기간 타일이 화면 밖(오른쪽)에 있으면 가로로만 당겨 보여준다 (공유 링크로 들어온 경우 등)
  const planRowRef = useRef<HTMLDivElement>(null);
  const planKey = `${filters.when ?? ""}|${filters.view}`;
  useEffect(() => {
    const row = planRowRef.current;
    const tile = row?.querySelector<HTMLElement>("[aria-pressed='true']");
    if (!row || !tile) return;
    const left = tile.offsetLeft - row.offsetLeft;
    if (left < row.scrollLeft || left + tile.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left - 12), behavior: "smooth" });
    }
  }, [planKey]);

  // 결과 제목: "이번 주말", "11월", "10월 24일(토)" — 공유할 때 제목으로도 쓴다
  const resultTitle = filters.date
    ? `${Number(filters.date.slice(5, 7))}월 ${Number(filters.date.slice(8, 10))}일(${"일월화수목금토"[dayOfWeek(filters.date)]})`
    : filters.when
      ? whenTitle(filters.when, today)
      : null;
  // 친구가 보낸 찜 목록(?fav=…) 중 내 찜에 없는 것 — "내 찜에 담기" 안내
  const sharedMissing =
    favoritesOnly && favorites.ready && !openId
      ? // 지금 목록에 실제로 있는 행사만 (정리돼 사라진 id는 담지 않는다)
        filters.favorites.filter((id) => !favorites.ids.includes(id) && byId.has(id))
      : [];

  // 위 타일·탭·카테고리 줄에서 이미 '선택됨'으로 보이는 조건은 아래 조건 칩에서 반복하지 않는다
  const visibleOnTop = new Set<string>(["schedule", "category"]);
  if (filters.when && (filters.when === "today" || (PLAN_WHENS as readonly string[]).includes(filters.when))) {
    visibleOnTop.add("when");
  }
  if (filters.view === "calendar") visibleOnTop.add("date");

  // 기간을 고른 목록·달력은 기간 한정 행사 수를 보여준다 (위 타일 숫자와 같게, 상시 장소는 아래 따로)
  const shownTotal =
    filters.view === "calendar" || (grouped && resultTitle) ? pageTotal : matched;

  const detailFilters = (
    <>
      <RegionFilter
        regions={filters.regions}
        subregions={filters.subregions}
        onChange={(next) => updateFilters(next)}
      />
      <FamilyFilter filters={filters} onChange={(next) => updateFilters(() => next)} />
      <label className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-4 py-3 text-sm text-stone-700 ring-1 ring-stone-200/80">
        이미 끝난 행사도 보기
        <input
          type="checkbox"
          checked={filters.includeEnded}
          onChange={(e) => updateFilters({ includeEnded: e.target.checked })}
          className="size-5 accent-teal-700"
        />
      </label>
    </>
  );

  return (
    <QuickViewContext.Provider value={quickApi}>
      <div className="pb-20 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start lg:gap-8 lg:pb-0">
        {/* 데스크톱: 상세 필터는 왼쪽 사이드바 */}
        <aside className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] space-y-3 overflow-y-auto pr-1 pb-6 lg:block" aria-label="상세 필터">
          {detailFilters}
        </aside>

        <div className="min-w-0 space-y-3 sm:space-y-4">
          {/* 검색창만 스크롤해도 상단에 고정 (나머지는 가볍게 지나가게) */}
          <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-30 -mx-3 bg-[#f6f3ee]/95 px-3 pt-2 pb-2 backdrop-blur-md sm:top-14 sm:-mx-4 sm:px-4 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:pt-0 lg:backdrop-blur-none">
            <form
              role="search"
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                (document.activeElement as HTMLElement | null)?.blur();
                submitQuery(query);
              }}
            >
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-stone-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => {
                  setRecentSearches(loadRecentSearches());
                  setSearchFocused(true);
                }}
                onBlur={() => {
                  setSearchFocused(false);
                  // 제안을 눌러 검색한 직후의 blur는 이전 입력값을 다시 제출하지 않는다
                  if (skipBlurSubmit.current) {
                    skipBlurSubmit.current = false;
                    return;
                  }
                  submitQuery(query);
                }}
                placeholder="축제·전시·장소 검색"
                aria-label="이벤트 검색"
                enterKeyHint="search"
                className="h-11 w-full rounded-xl bg-white pr-10 pl-10 text-base text-stone-900 ring-1 ring-stone-200 outline-none placeholder:text-stone-400 focus:ring-2 focus:ring-teal-600 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  aria-label="검색어 지우기"
                  onClick={() => {
                    setQuery("");
                    updateFilters({ q: "" });
                  }}
                  className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-stone-400 active:bg-stone-100"
                >
                  <X className="size-4" />
                </button>
              )}
              {searchFocused && !query && (
                <SearchSuggestions
                  recent={recentSearches}
                  onRecentChange={setRecentSearches}
                  onPick={(term) => {
                    setQuery(term);
                    submitQuery(term);
                    skipBlurSubmit.current = true;
                    (document.activeElement as HTMLElement | null)?.blur();
                  }}
                />
              )}
            </form>
          </div>

          {/* 찜 알림 — 조건 없는 첫 화면에서만 (검색·필터 중에는 방해하지 않게) */}
          {isHomeView && currentFavoriteItems.length > 0 && (
            <FavoriteReminders
              items={currentFavoriteItems}
              today={today}
              onOpen={(id, ids) => quickApi.open(id, ids)}
              onWeekend={() =>
                updateFilters({ favorites: favorites.ids, when: "weekend", date: null })
              }
            />
          )}

          <div ref={planRowRef} role="group" aria-label="날짜·찜" className={scrollRow}>
            <button
              type="button"
              aria-pressed={favoritesOnly}
              onClick={() => updateFilters({ favorites: favoritesOnly ? [] : favorites.ids })}
              disabled={!favoritesOnly && favorites.ids.length === 0}
              title={favorites.ids.length === 0 ? "하트를 눌러 찜해 보세요" : undefined}
              className={cn(
                chipClass(favoritesOnly),
                favoritesOnly && "bg-rose-600",
                "hidden self-center disabled:opacity-45 lg:inline-flex",
              )}
            >
              <Heart className={cn("size-3.5", favoritesOnly && "fill-current")} />
              찜{favorites.ids.length > 0 ? ` ${favorites.ids.length}` : ""}
            </button>
            <span className="my-2 hidden w-px shrink-0 bg-stone-300 lg:block" aria-hidden />
            {/* 언제 갈까: 이번 주말 / 다음 주말 / 이번 달 / 다음 달 — 기간과 열리는 곳 수를 한눈에 */}
            {(["today", ...PLAN_WHENS] as const).map((when) => {
              const selected = !filters.date && filters.when === when;
              const count = planCounts[when] ?? 0;
              return (
                <button
                  key={when}
                  type="button"
                  aria-pressed={selected}
                  aria-label={[
                    `${whenTitle(when, today)} ${whenRangeText(when, today)} 행사 ${count}곳`,
                    when in planWeather ? weatherSpeech(planWeather[when as keyof PlanWeather]) : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  onClick={() => updateFilters({ when: selected ? null : when, date: null })}
                  className={cn(
                    planTileClass(selected),
                    count === 0 && !selected && "opacity-50",
                  )}
                >
                  <span className="text-[14px] leading-tight font-bold">
                    {when === "next_month" ? `다음 달` : WHEN_OPTIONS.find((o) => o.value === when)?.label}
                  </span>
                  <span className={cn("text-[11.5px] tabular-nums", selected ? "text-white/70" : "text-stone-500")}>
                    {when === "today" ? `${Number(today.slice(5, 7))}.${Number(today.slice(8, 10))}` : whenRangeText(when, today)}
                  </span>
                  <span className={cn("text-[12px] font-semibold tabular-nums", selected ? "text-teal-200" : "text-teal-700")}>
                    {count}곳
                  </span>
                  {when in planWeather && (
                    <WeatherMini
                      days={planWeather[when as keyof PlanWeather]}
                      inverted={selected}
                    />
                  )}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={filters.view === "calendar"}
              onClick={() =>
                writeFilters({
                  ...filters,
                  view: filters.view === "calendar" ? "list" : "calendar",
                  limit: PAGE_SIZE,
                })
              }
              className={planTileClass(filters.view === "calendar")}
            >
              <span className="inline-flex items-center gap-1 text-[14px] leading-tight font-bold">
                <CalendarDays className="size-4" aria-hidden />
                달력
              </span>
              <span className={cn("text-[11.5px]", filters.view === "calendar" ? "text-white/70" : "text-stone-500")}>
                {filters.date ? `${Number(filters.date.slice(5, 7))}.${Number(filters.date.slice(8, 10))} 선택됨` : "날짜 고르기"}
              </span>
              <span className={cn("text-[12px] font-semibold", filters.view === "calendar" ? "text-teal-200" : "text-teal-700")}>
                한눈에 보기
              </span>
            </button>
          </div>

          {/* 기간 한정 행사 vs 언제든 가는 곳 — 가장 먼저 고르는 축 */}
          <div
            role="group"
            aria-label="일정 유형"
            className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 ring-1 ring-stone-200"
          >
            {SCHEDULE_TYPE_OPTIONS.map((option) => {
              const selected = filters.scheduleType === option.value;
              const style = SCHEDULE_TAB_STYLE[option.value];
              const Icon = style.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  title={option.description}
                  onClick={() => updateFilters({ scheduleType: option.value })}
                  className={cn(
                    "flex h-9 items-center justify-center gap-1 rounded-xl text-[13px] font-semibold transition-colors sm:gap-1.5 sm:text-sm",
                    selected ? style.active : "text-stone-600 active:bg-stone-100",
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {Icon && <Icon className="size-3.5" aria-hidden />}
                    {option.label}
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-medium tabular-nums sm:text-xs",
                      selected ? "text-white/80" : "text-stone-400",
                    )}
                  >
                    {scheduleCounts[option.value]}
                  </span>
                </button>
              );
            })}
          </div>

          <CategoryFilterBar
            value={filters.category}
            counts={categoryCounts}
            onChange={(category) => updateFilters({ category })}
            className={scrollRow}
            leading={
              <>
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  aria-label={`상세 필터${sheetCount > 0 ? ` ${sheetCount}개 적용됨` : ""}`}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-2 text-sm font-medium lg:hidden",
                    sheetCount > 0
                      ? "bg-stone-900 text-white"
                      : "bg-white text-stone-700 ring-1 ring-stone-200",
                  )}
                >
                  <SlidersHorizontal className="size-4" aria-hidden />
                  {sheetCount > 0 ? sheetCount : "필터"}
                </button>
                <span className="my-2 w-px shrink-0 bg-stone-300 lg:hidden" aria-hidden />
              </>
            }
          />

          {/* 달력 보기: 날짜를 누르면 아래 목록이 그날 열리는 행사로 */}
          {filters.view === "calendar" && calendar && (
            <EventCalendar
              key={calendar.from}
              calendar={calendar}
              today={today}
              selected={filters.date}
              onSelect={(date) => updateFilters({ date, when: null })}
            />
          )}

          {/* 필터 없는 첫 화면: 사진으로 훑는 선반들 */}
          {feed && feed.length > 0 && filters.view === "list" && (
            <div className="space-y-7 pt-2 pb-3">
              {feed.map((shelf, i) => (
                <EventShelf
                  key={shelf.key}
                  title={shelf.title}
                  hint={shelf.hint}
                  items={shelf.items}
                  priority={i === 0}
                  deferUntilVisible={i >= 2}
                  onSeeAll={() => {
                    updateFilters({ ...shelf.seeAll });
                    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                />
              ))}
              <h2 className="border-t border-stone-200 pt-6 text-[17px] font-bold tracking-tight text-stone-900">
                전체 둘러보기
              </h2>
            </div>
          )}

          <div ref={resultsRef} className="scroll-mt-40" aria-hidden />
          {/* 결과 줄: "이번 주말 · 241건" + 정렬 + 공유 (+ 데스크톱 보기 방식) */}
          <div className="space-y-2">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate px-0.5 text-sm text-stone-600" aria-live="polite">
              {resultTitle && (
                <span className="font-semibold text-stone-900">{resultTitle} · </span>
              )}
              <span className="font-semibold text-stone-900">{shownTotal}건</span>
              {isPending ? " · 불러오는 중…" : ""}
            </p>

            <label className="relative inline-flex h-9 shrink-0 items-center rounded-full bg-white ring-1 ring-stone-200">
              <ArrowUpDown className="pointer-events-none absolute left-3 size-3.5 text-stone-500" />
              <span className="sr-only">정렬</span>
              <select
                value={filters.sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                className="h-9 appearance-none rounded-full bg-transparent pr-3 pl-8 text-sm font-medium text-stone-700 outline-none"
              >
                {SORT_OPTIONS.filter((o) => o.value !== "near" || locatable > 0).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {(resultTitle || favoritesOnly) && shownTotal > 0 && (
              <ShareListButton
                title={
                  favoritesOnly
                    ? `찜한 행사 ${shownTotal}곳`
                    : `${resultTitle} 갈 만한 곳 ${shownTotal}곳`
                }
                description={
                  items
                    .slice(0, 3)
                    .map((e) => e.title)
                    .join(" · ") || undefined
                }
                imageUrl={items.find((e) => /^https?:\/\//.test(e.thumbnail_url ?? ""))?.thumbnail_url}
              />
            )}

            <div
              role="group"
              aria-label="보기 방식"
              className="hidden shrink-0 rounded-full bg-white p-0.5 ring-1 ring-stone-200 lg:flex"
            >
              {(
                [
                  ["list", "목록", List],
                  ["calendar", "달력", CalendarDays],
                  ["map", "지도", MapIcon],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filters.view === value}
                  aria-label={label}
                  onClick={() => writeFilters({ ...filters, view: value })}
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-medium",
                    filters.view === value ? "bg-stone-900 text-white" : "text-stone-600",
                  )}
                >
                  <Icon className="size-4" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>
            <ActiveFilterChips
              filters={filters}
              hidden={visibleOnTop}
              onClear={(patch) => {
                if ("q" in patch) setQuery("");
                updateFilters(patch);
              }}
              onReset={resetAll}
            />
          </div>
          {geoError && <p className="text-sm text-amber-700">{geoError}</p>}
          {sharedMissing.length > 0 && (
            <div className="flex items-center gap-3 rounded-2xl bg-rose-50 px-3.5 py-3 ring-1 ring-rose-100">
              <Heart className="size-5 shrink-0 fill-rose-500 text-rose-500" aria-hidden />
              <p className="min-w-0 flex-1 text-[13.5px] leading-5 text-rose-950">
                <span className="font-semibold">함께 보낸 찜 목록이에요</span>
                <span className="block text-[12.5px] text-rose-800">
                  {sharedMissing.length === items.length
                    ? `${sharedMissing.length}곳 모두 내 찜에 없어요`
                    : `이 중 ${sharedMissing.length}곳이 내 찜에 없어요`}
                </span>
              </p>
              <button
                type="button"
                onClick={() => {
                  favorites.addMany(sharedMissing);
                  setNavHint(`${sharedMissing.length}곳을 내 찜에 담았어요`);
                }}
                className="h-9 shrink-0 rounded-full bg-rose-600 px-3.5 text-[13px] font-semibold text-white active:bg-rose-700"
              >
                내 찜에 담기
              </button>
            </div>
          )}
          {rainAdvice && (
            <RainAdvice
              advice={rainAdvice}
              onIndoor={() => updateFilters({ familyTag: "indoor" })}
            />
          )}

          <div className={isPending ? "opacity-60 transition-opacity" : "transition-opacity"}>
            {filters.view === "map" && mapPoints.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-14 text-center">
                <MapIcon className="mx-auto size-8 text-stone-400" />
                <p className="mt-3 text-base font-medium text-stone-800">
                  지도에 표시할 위치 정보가 아직 없어요
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  {locatable > 0
                    ? "조건을 바꾸면 지도에 보이는 행사가 있을 수 있어요."
                    : "다음 자동 수집부터 좌표가 함께 들어옵니다."}
                </p>
                <button
                  type="button"
                  onClick={() => writeFilters({ ...filters, view: "list" })}
                  className="mt-4 h-10 rounded-full bg-stone-900 px-5 text-sm font-medium text-white"
                >
                  목록으로 보기
                </button>
              </div>
            ) : filters.view === "map" ? (
              <div className="space-y-2">
                <div className="h-[calc(100dvh-14rem)] min-h-80">
                  <EventMap
                    points={mapPoints}
                    near={filters.near}
                    onSelect={(id) => quickApi.open(id, mapPoints.map((p) => p.id))}
                  />
                </div>
                <p className="text-xs text-stone-500">
                  위치 정보가 있는 {mapPoints.length}건 · 점을 누르면 바로 볼 수 있어요
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {items.length === 0 && filters.q ? (
                  <div className="rounded-2xl bg-white px-5 py-10 text-center ring-1 ring-stone-200">
                    <p className="text-base font-semibold text-stone-800">
                      ‘{filters.q}’에 맞는 행사가 아직 없어요
                    </p>
                    <p className="mt-1 text-sm text-stone-500">
                      {anyActive && activeCountWithoutQuery > 0
                        ? "다른 조건을 빼거나 다른 말로 찾아보세요."
                        : "이런 말로 찾아보면 어때요?"}
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                      {POPULAR_KEYWORDS.filter((k) => k !== filters.q).slice(0, 8).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            setQuery(k);
                            submitQuery(k);
                          }}
                          className="h-8 rounded-full bg-stone-100 px-3 text-[13px] text-stone-700 active:bg-stone-200"
                        >
                          {k}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EventGrid
                    events={items}
                    grouped={grouped}
                    groupCounts={groupCounts}
                    hideFirstHeader={Boolean(resultTitle)}
                    emptyHint={
                      anyActive
                        ? "조건을 줄이거나 '전체 초기화'를 눌러 보세요."
                        : undefined
                    }
                  />
                )}
                {/* 끝에 가까워지면 자동으로 다음 묶음을 불러온다 (버튼은 예비) */}
                <div ref={moreRef} aria-hidden />
                {items.length < pageTotal && (
                  <button
                    type="button"
                    onClick={() => writeFilters({ ...filters, limit: filters.limit + PAGE_SIZE })}
                    disabled={isPending}
                    className="h-12 w-full rounded-2xl bg-white text-sm font-medium text-stone-800 ring-1 ring-stone-200 active:bg-stone-50 disabled:opacity-60 sm:mx-auto sm:block sm:w-64"
                  >
                    {isPending
                      ? "불러오는 중…"
                      : `${grouped ? "기간 한정 행사 " : ""}더 보기 (${items.length}/${pageTotal})`}
                  </button>
                )}

                {permanentPreview && permanentPreview.length > 0 && (
                  <section className="space-y-3 pt-4" aria-label="상시 운영 장소 미리보기">
                    <EventGrid events={permanentPreview} grouped groupCounts={groupCounts} />
                    <button
                      type="button"
                      onClick={() => updateFilters({ scheduleType: "permanent" })}
                      className="flex h-12 w-full items-center justify-center gap-1.5 rounded-2xl bg-indigo-50 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 active:bg-indigo-100 sm:mx-auto sm:w-80"
                    >
                      <InfinityIcon className="size-4" aria-hidden />
                      언제든 가는 곳 {groupCounts.permanent}곳 모두 보기
                    </button>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 모바일·태블릿: 상세 필터는 아래에서 올라오는 시트로 */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            side="bottom"
            className="mx-auto max-h-[88dvh] max-w-2xl gap-0 rounded-t-3xl bg-[#f6f3ee] p-0 lg:hidden"
          >
            <SheetHeader className="border-b border-stone-200 px-4 pt-3 pb-3">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-stone-300" aria-hidden />
              <SheetTitle className="text-base font-semibold">상세 필터</SheetTitle>
              <SheetDescription className="sr-only">
                지역, 가족 조건, 편의시설로 행사를 좁혀요.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-3 overflow-y-auto px-3 py-3">{detailFilters}</div>
            <SheetFooter className="flex-row gap-2 border-t border-stone-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() =>
                  updateFilters({
                    ...DEFAULT_EXPLORER_FILTERS,
                    q: filters.q,
                    category: filters.category,
                    when: filters.when,
                    date: filters.date,
                    favorites: filters.favorites,
                    sort: filters.sort,
                    near: filters.near,
                    view: filters.view,
                  })
                }
                className="h-12 rounded-xl px-4 text-sm font-medium text-stone-600 ring-1 ring-stone-200"
              >
                초기화
              </button>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="h-12 flex-1 rounded-xl bg-teal-700 text-[15px] font-semibold text-white active:bg-teal-800"
              >
                {isPending ? "불러오는 중…" : `${matched}건 보기`}
              </button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <BottomTabBar
        isHome={filtersToQueryString(filters) === ""}
        weekend={filters.when === "weekend" && !filters.date}
        calendar={filters.view === "calendar"}
        map={filters.view === "map"}
        favoritesOnly={favoritesOnly}
        favoriteCount={favorites.ids.length}
        onHome={() => {
          resetAll();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onWeekend={() =>
          updateFilters({ when: filters.when === "weekend" ? null : "weekend", date: null })
        }
        onCalendar={() => {
          writeFilters({
            ...filters,
            view: filters.view === "calendar" ? "list" : "calendar",
            limit: PAGE_SIZE,
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        onMap={() => writeFilters({ ...filters, view: filters.view === "map" ? "list" : "map" })}
        onFavorites={() => {
          if (!favoritesOnly && favorites.ids.length === 0) {
            setNavHint("하트를 눌러 찜하면 여기 모여요");
            return;
          }
          updateFilters({ favorites: favoritesOnly ? [] : favorites.ids });
        }}
      />
      {navHint && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm rounded-2xl bg-stone-900 px-4 py-3 text-center text-sm text-white shadow-lg lg:hidden"
        >
          {navHint}
        </div>
      )}

      {/* 카드를 누르면 열리는 빠른 보기 (뒤로가기로 닫힘) */}
      <EventQuickView
        event={quickEvent}
        siblings={siblings.length ? siblings : quickEvent ? [quickEvent.id] : []}
        onClose={closeQuick}
        onNavigate={navigateQuick}
        planDay={
          filters.date ??
          // 하루·주말 단위로 고른 경우만 (달 단위는 첫날이 의미가 없다)
          (filters.when === "today" || filters.when === "weekend" || filters.when === "next_weekend"
            ? dateWindow(filters.when, today)[0]
            : null)
        }
      />
    </QuickViewContext.Provider>
  );
}
