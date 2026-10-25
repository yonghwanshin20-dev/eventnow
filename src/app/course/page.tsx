import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Navigation } from "lucide-react";

import { CourseActions } from "@/components/events/course-actions";
import { EventThumb } from "@/components/events/event-thumb";
import { EventWeather } from "@/components/events/event-weather";
import { SiteHeader } from "@/components/layout/site-header";
import { detectSubregion, regionShortLabel } from "@/data/regions";
import { parseCourse } from "@/lib/course-page";
import { todayKst } from "@/lib/dates";
import {
  CATEGORY_LABELS,
  displayTitle,
  distanceKm,
  scheduleText,
} from "@/lib/events";
import { getEventsSnapshot } from "@/lib/events-data";
import { mapsUrl } from "@/lib/links";
import type { Event } from "@/types/event";

interface CoursePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: CoursePageProps): Promise<Metadata> {
  const [params, { events }] = await Promise.all([searchParams, getEventsSnapshot()]);
  const course = parseCourse(params, events);
  if (!course) return { title: "코스를 찾을 수 없어요" };
  const qs = new URLSearchParams({ ids: course.stops.map((e) => e.id).join(","), day: course.day });
  return {
    title: course.title,
    description: course.description,
    // 공유 링크마다 내용이 달라 검색 색인은 하지 않는다
    robots: { index: false },
    openGraph: {
      type: "website",
      siteName: "EventNow",
      locale: "ko_KR",
      title: course.title,
      description: course.description,
      images: [{ url: `/og/course?${qs}`, width: 1200, height: 630, alt: course.title }],
    },
  };
}

function openOn(e: Event, day: string): boolean {
  return e.start_date.slice(0, 10) <= day && e.end_date.slice(0, 10) >= day;
}

function hop(a: Event, b: Event): number | null {
  if (a.latitude == null || a.longitude == null || b.latitude == null || b.longitude == null) {
    return null;
  }
  return distanceKm({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
}

/**
 * 공유된 하루 코스: 그날 들를 곳을 순서대로, 곳마다 길찾기, 곳 사이 거리.
 * 받은 사람이 앱 설치 없이 열어 보고 '코스 전체 찜하기'로 담아 갈 수 있다.
 */
export default async function CoursePage({ searchParams }: CoursePageProps) {
  const [params, { events }] = await Promise.all([searchParams, getEventsSnapshot()]);
  const today = todayKst();
  const course = parseCourse(params, events, today);
  if (!course) notFound();
  const { day, stops } = course;
  const [, m, d] = day.split("-").map(Number);
  const first = stops[0];
  const where = [
    regionShortLabel(first.region),
    detectSubregion(first.region, first.address ?? "", first.district),
  ]
    .filter(Boolean)
    .join(" ");
  const past = day < today;

  return (
    <div className="flex min-h-full flex-col bg-[#f6f3ee]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-5 px-3 pt-4 pb-16 sm:px-4 sm:py-10">
        <section className="space-y-1.5">
          <p className="inline-flex items-center gap-1 rounded-full bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white">
            <CalendarDays className="size-3.5" aria-hidden />
            하루 코스
          </p>
          <h1 className="text-[24px] font-bold tracking-tight text-stone-900 sm:text-3xl">
            {m}월 {d}일, {where}에서 {stops.length}곳
          </h1>
          {past ? (
            <p className="text-sm text-amber-700">이미 지난 날짜의 코스예요.</p>
          ) : (
            <EventWeather
              region={first.region}
              start_date={day}
              end_date={day}
              permanent={false}
              planDay={day}
            />
          )}
        </section>

        <ol className="relative space-y-3">
          {stops.map((e, i) => {
            const next = stops[i + 1];
            const km = next ? hop(e, next) : null;
            const closed = !openOn(e, day);
            return (
              <li key={e.id} className="space-y-3">
                <div className="flex gap-3 rounded-2xl bg-white p-3 ring-1 ring-stone-200">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-900 text-sm font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Link href={`/events/${e.id}`} className="flex gap-3">
                      <EventThumb
                        src={e.thumbnail_url}
                        category={e.category}
                        sizes="72px"
                        className="size-[72px] shrink-0 rounded-xl"
                      />
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-[15px] leading-snug font-semibold text-stone-900">
                          {displayTitle(e.title)}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] text-stone-500">
                          {CATEGORY_LABELS[e.category]} · {scheduleText(e)}
                        </span>
                        <span className="block truncate text-[12.5px] text-stone-500">
                          {e.location_name}
                        </span>
                      </span>
                    </Link>
                    {closed && (
                      <p className="text-[12.5px] font-semibold text-amber-700">
                        이날은 열지 않아요 · 일정을 확인하세요
                      </p>
                    )}
                    <a
                      href={mapsUrl(e)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-stone-50 px-3 text-[12.5px] font-medium text-teal-800 ring-1 ring-stone-200"
                    >
                      <Navigation className="size-3.5" aria-hidden />
                      길찾기
                    </a>
                  </div>
                </div>
                {next && (
                  <p className="pl-5 text-[12.5px] text-stone-500" aria-label="다음 장소까지">
                    ↓ {km != null ? `약 ${km < 1 ? "1km 안" : `${Math.round(km * 10) / 10}km`}` : "다음 장소"}
                  </p>
                )}
              </li>
            );
          })}
        </ol>

        <CourseActions
          ids={stops.map((e) => e.id)}
          title={course.title}
          description={course.description}
          imageUrl={stops.find((e) => /^https?:\/\//.test(e.thumbnail_url ?? ""))?.thumbnail_url ?? null}
        />

        <Link
          href={`/?date=${day}`}
          className="flex h-12 items-center justify-center rounded-2xl bg-white text-sm font-medium text-stone-800 ring-1 ring-stone-200"
        >
          {m}월 {d}일에 열리는 다른 행사 보기
        </Link>
      </main>
    </div>
  );
}
