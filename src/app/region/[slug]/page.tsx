import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EventGrid } from "@/components/events/event-grid";
import { QuickViewHost } from "@/components/events/quick-view-host";
import { DataFreshness } from "@/components/layout/data-freshness";
import { RefreshControl } from "@/components/layout/refresh-control";
import { FALLBACK_GENERATED_AT } from "@/data/fallback-events";
import { getRefreshConfig } from "@/lib/refresh";
import { SiteHeader } from "@/components/layout/site-header";
import { REGION_SLUGS, regionShortLabel } from "@/data/regions";
import { todayKst } from "@/lib/dates";
import {
  DEFAULT_EXPLORER_FILTERS,
  filterEvents,
  filtersToQueryString,
  getScheduleType,
  sortEvents,
  toListItem,
} from "@/lib/events";
import { getEventsSnapshot } from "@/lib/events-data";
import { siteUrl } from "@/lib/links";

export const revalidate = 3600;
export const dynamicParams = false;

const LIMITED_SHOWN = 30;
const PERMANENT_SHOWN = 18;

interface RegionPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return Object.keys(REGION_SLUGS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: RegionPageProps): Promise<Metadata> {
  const { slug } = await params;
  const region = REGION_SLUGS[slug];
  if (!region) return {};
  const short = regionShortLabel(region);
  const title = `${short} 아이와 가볼 만한 곳 · 축제·전시·체험`;
  return {
    title,
    description: `지금 ${short}에서 열리는 축제·전시·팝업·키즈 체험을 날짜순으로 모았어요.`,
    alternates: { canonical: `${siteUrl()}/region/${slug}` },
  };
}

export default async function RegionPage({ params }: RegionPageProps) {
  const { slug } = await params;
  const region = REGION_SLUGS[slug];
  if (!region) notFound();

  const snapshot = await getEventsSnapshot();
  const today = todayKst();
  const short = regionShortLabel(region);
  const filters = { ...DEFAULT_EXPLORER_FILTERS, region };
  const matched = sortEvents(filterEvents(snapshot.events, filters, today), "recommended", today);
  const family = matched.filter((e) => e.is_family_friendly).length;
  // 기간 한정과 상시 운영을 각각 보여줘 어느 한쪽이 묻히지 않게
  const limited = matched.filter((e) => getScheduleType(e) === "limited");
  const permanent = matched.filter((e) => getScheduleType(e) === "permanent");
  const shown = [...limited.slice(0, LIMITED_SHOWN), ...permanent.slice(0, PERMANENT_SHOWN)].map(
    (e) => toListItem(e, null, today),
  );

  return (
    <div className="flex min-h-full flex-col bg-[#f6f3ee]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 px-3 pt-4 pb-10 sm:space-y-6 sm:px-4 sm:py-10">
        <section className="max-w-2xl space-y-1 sm:space-y-2">
          <h1 className="text-[22px] font-bold tracking-tight text-stone-900 sm:text-4xl">
            {short} 아이와 가볼 만한 곳
          </h1>
          <p className="text-sm text-stone-600 sm:text-base">
            열려 있거나 곧 열리는 행사 {matched.length}건 · 아이 동반 {family}건
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <DataFreshness snapshot={snapshot} />
            {snapshot.source === "json" && getRefreshConfig() && (
              <RefreshControl initialDataUpdatedAt={FALLBACK_GENERATED_AT} />
            )}
          </div>
        </section>

        <QuickViewHost items={shown}>
          <EventGrid
            events={shown}
            grouped
            groupCounts={{ limited: limited.length, permanent: permanent.length }}
          />
        </QuickViewHost>
        {permanent.length > PERMANENT_SHOWN && (
          <Link
            href={`/${filtersToQueryString({ ...filters, scheduleType: "permanent" })}`}
            className="flex h-12 items-center justify-center rounded-2xl bg-indigo-50 text-sm font-semibold text-indigo-800 ring-1 ring-indigo-100 sm:mx-auto sm:w-80"
          >
            {short} 언제든 가는 곳 {permanent.length}곳 모두 보기
          </Link>
        )}

        <div className="flex flex-wrap gap-3">
          <Link
            href={`/${filtersToQueryString(filters)}`}
            className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            {short} 전체 보기·필터
          </Link>
          <Link
            href={`/${filtersToQueryString({ ...filters, when: "weekend" })}`}
            className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-stone-800 ring-1 ring-stone-200 hover:bg-stone-50"
          >
            이번 주말 {short}
          </Link>
        </div>

        <nav aria-label="다른 지역" className="border-t border-stone-200 pt-5">
          <p className="mb-2 text-xs font-medium text-stone-500">다른 지역</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(REGION_SLUGS)
              .filter(([s]) => s !== slug)
              .map(([s, r]) => (
                <Link
                  key={s}
                  href={`/region/${s}`}
                  className="rounded-full bg-stone-100 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-200"
                >
                  {regionShortLabel(r)}
                </Link>
              ))}
          </div>
        </nav>
      </main>
    </div>
  );
}
