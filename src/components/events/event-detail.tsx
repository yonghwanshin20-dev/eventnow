import type { ReactNode } from "react";
import Link from "next/link";
import {
  Baby,
  CalendarDays,
  ExternalLink,
  Flag,
  MapPin,
  Navigation,
  Ticket,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";

import { AmenityIcons } from "@/components/events/amenity-icons";
import { CourseSuggestions } from "@/components/events/course-suggestions";
import { EventActions } from "@/components/events/event-actions";
import { EventThumb } from "@/components/events/event-thumb";
import { EventWeather } from "@/components/events/event-weather";
import { BackToListButton } from "@/components/events/back-to-list-button";
import {
  AGE_GROUP_LABELS,
  formatAgeRange,
  CATEGORY_LABELS,
  PLACE_TYPE_OPTIONS,
  formatLongRange,
  getScheduleType,
  isOfficialSource,
  placeLines,
  isApproxDates,
  whenLabel,
} from "@/lib/events";
import { feedbackHref } from "@/lib/feedback";
import { hostLabel, mapsUrl, resolveInfoUrl } from "@/lib/links";
import { venueTypeLabel } from "@/lib/thumbnails";
import { cn } from "@/lib/utils";
import type { Event } from "@/types/event";

/** 공공 데이터 출처 표기 */
const SOURCE_CREDITS: Record<string, string> = {
  kfes: "한국관광공사 대한민국 구석구석",
  culture_portal: "문화포털(한국문화정보원)",
  tour_api: "한국관광공사 TourAPI",
  seoul_api: "서울 열린데이터광장",
  popply: "팝플리 (popply.co.kr)",
  seoul_portal: "서울문화포털 (서울특별시)",
  mcst_festival: "문화체육관광부 지역축제",
  city_calendar: "시·군청 연간 행사 일정표",
  public_data: "공공데이터포털 (지자체·문화재단 등록 정보)",
  venue_fair: "전시장 행사 일정 (코엑스·킨텍스·세텍·수원메쎄)",
  attraction: "공공데이터포털 관광지·박물관 정보, 국가유산청",
};

const WHEN_TONE: Record<ReturnType<typeof whenLabel>["tone"], string> = {
  urgent: "bg-rose-600 text-white",
  soon: "bg-amber-100 text-amber-900",
  live: "bg-teal-700 text-white",
  upcoming: "bg-sky-700 text-white",
  always: "bg-indigo-700 text-white",
  approx: "bg-white text-amber-800 ring-1 ring-amber-300",
  ended: "bg-stone-400 text-white",
};

interface EventDetailProps {
  event: Event;
  /** 공유·캘린더용 정식 URL */
  url: string;
}

export function EventDetail({ event, url }: EventDetailProps) {
  const venueLabel = venueTypeLabel(event);
  const placeLabels = PLACE_TYPE_OPTIONS.filter((o) =>
    (event.place_types ?? []).includes(o.value),
  ).map((o) => o.label);
  const info = resolveInfoUrl(event);
  const mapHref = mapsUrl(event);
  const when = whenLabel(event);
  const schedule = getScheduleType(event);
  const approx = schedule === "limited" && isApproxDates(event);
  const hasAmenity = Object.values(event.amenities ?? {}).some(Boolean);
  const credit = SOURCE_CREDITS[event.source ?? ""];
  const place = placeLines(event);

  return (
    <article className="mx-auto w-full max-w-3xl pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-4 sm:py-8">
      <div className="overflow-hidden bg-white sm:rounded-3xl sm:ring-1 sm:ring-stone-200">
        {/* 사진이 화면 맨 위부터 꽉 차게, 뒤로가기는 사진 위에 띄운다 */}
        <div className="relative">
          <BackToListButton floating />
          <EventThumb
            src={event.thumbnail_url}
            category={event.category}
            sizes="(max-width: 768px) 100vw, 768px"
            priority
            className={
              event.source === "culture_portal"
                ? "aspect-[4/5] max-h-[32rem] w-full sm:aspect-[4/3]"
                : "aspect-[4/3] max-h-[28rem] w-full sm:aspect-[16/9]"
            }
            fallbackClassName="h-40 w-full sm:h-48"
            fit={event.source === "culture_portal" ? "contain" : "cover"}
            showLabel
          />
        </div>

        <div className="relative -mt-5 space-y-5 rounded-t-3xl bg-white px-4 pt-5 pb-6 sm:mt-0 sm:rounded-none sm:px-8 sm:pt-6">
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
              <span className={cn("rounded-md px-2 py-1 leading-none", WHEN_TONE[when.tone])}>
                {when.text}
              </span>
              <span className="rounded-md bg-stone-100 px-2 py-1 leading-none text-stone-700">
                {CATEGORY_LABELS[event.category]}
              </span>
              {venueLabel && (
                <span className="rounded-md bg-stone-100 px-2 py-1 leading-none text-stone-700">
                  {venueLabel}
                </span>
              )}
              {event.is_family_friendly && (
                <span className="rounded-md bg-teal-50 px-2 py-1 leading-none text-teal-800">
                  아이 동반 추천
                </span>
              )}
            </div>
            <h1 className="text-[22px] font-bold leading-tight tracking-tight text-stone-900 sm:text-3xl">
              {event.title}
            </h1>
          </header>

          <dl className="divide-y divide-stone-100 rounded-2xl bg-stone-50 px-4 ring-1 ring-stone-100">
            <Fact icon={<CalendarDays className="size-[18px]" />} label="일정">
              {schedule === "permanent" ? (
                <>
                  <span className="font-medium text-indigo-800">상시 운영 · 언제든 방문</span>
                  <span className="mt-0.5 block text-[13px] text-stone-500">
                    운영 시간·휴관일은 공식 정보를 확인하세요
                  </span>
                </>
              ) : approx ? (
                <>
                  <span className="font-medium">{Number(event.start_date.slice(5, 7))}월 중</span>
                  <span className="mt-0.5 block text-[13px] text-amber-700">
                    정확한 날짜가 아직 확인되지 않았어요 · 공식 정보를 꼭 확인하세요
                  </span>
                </>
              ) : (
                <>
                  {formatLongRange(event.start_date, event.end_date)}
                  {!isOfficialSource(event.source) && (
                    <span className="mt-0.5 block text-[13px] text-stone-500">
                      자동 확인되지 않은 일정이에요 · 방문 전 공식 안내를 확인하세요
                    </span>
                  )}
                </>
              )}
              {/* 공유 링크로 바로 들어온 사람도 '그날 날씨'를 볼 수 있게 (16일 안쪽, 브라우저에서 불러옴) */}
              {!approx && whenLabel(event).tone !== "ended" && (
                <EventWeather
                  region={event.region}
                  start_date={event.start_date}
                  end_date={event.end_date}
                  permanent={schedule === "permanent"}
                />
              )}
            </Fact>
            <Fact
              icon={<MapPin className="size-[18px]" />}
              label="장소"
              action={
                <a
                  href={mapHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-teal-800 ring-1 ring-stone-200"
                >
                  지도
                </a>
              }
            >
              <span className="font-medium break-keep text-stone-900">{place.main}</span>
              {place.sub && (
                <span className="mt-0.5 block text-[13px] break-keep text-stone-500">
                  {place.sub}
                </span>
              )}
            </Fact>
            <Fact icon={<Wallet className="size-[18px]" />} label="요금">
              {event.price_info ?? <span className="text-stone-500">공식 정보 확인</span>}
            </Fact>
            <Fact icon={<Ticket className="size-[18px]" />} label="예약">
              {event.booking_required
                ? (event.place_types ?? []).some((t) => t === "cultural_space" || t === "library")
                  ? "프로그램별 신청 확인"
                  : "사전 예약 필요"
                : "현장 방문 가능"}
            </Fact>
            {(formatAgeRange(event.age_min, event.age_max) ||
              (event.target_age_group && event.target_age_group !== "all")) && (
              <Fact icon={<Baby className="size-[18px]" />} label="대상 나이">
                {formatAgeRange(event.age_min, event.age_max) ??
                  AGE_GROUP_LABELS[event.target_age_group!]}
              </Fact>
            )}
          </dl>

          <EventActions event={event} url={url} />

          {!approx && whenLabel(event).tone !== "ended" && <CourseSuggestions event={event} />}

          {event.description && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-stone-900">소개</h2>
              <p className="text-[15px] leading-7 whitespace-pre-line text-stone-700">
                {event.description}
              </p>
            </section>
          )}

          {hasAmenity && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-stone-900">편의시설</h2>
              <AmenityIcons amenities={event.amenities} showLabel size="md" />
            </section>
          )}

          {(placeLabels.length > 0 || (event.tags && event.tags.length > 0)) && (
            <section className="flex flex-wrap gap-1.5">
              {placeLabels.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700"
                >
                  {label}
                </span>
              ))}
              {(event.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-600"
                >
                  {tag}
                </span>
              ))}
            </section>
          )}

          <div className="hidden gap-2 sm:flex">
            <a
              href={info.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-teal-700 text-[15px] font-semibold text-white hover:bg-teal-800"
            >
              {info.label}
              <ExternalLink className="size-4" />
            </a>
            <a
              href={mapHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl px-5 text-sm font-medium text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"
            >
              <Navigation className="size-4" />
              네이버 지도
            </a>
          </div>

          <p className="text-xs leading-5 text-stone-400">
            {credit ? `정보 출처: ${credit} · ` : ""}
            {info.kind === "official" ? `공식 사이트 ${hostLabel(info.href)} · ` : ""}
            일정·요금은 바뀔 수 있으니 방문 전 확인하세요.
          </p>
          <div className="flex items-center justify-between gap-2 text-[13px]">
            <Link
              href={`/food?event=${encodeURIComponent(event.id)}`}
              className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1.5 font-semibold text-orange-800 ring-1 ring-orange-100"
            >
              <UtensilsCrossed className="size-3.5" aria-hidden />
              주변 맛집 보기
            </Link>
            <Link
              href={feedbackHref(event)}
              className="inline-flex items-center gap-1 font-medium text-stone-500 underline-offset-2 hover:underline"
            >
              <Flag className="size-3.5" aria-hidden />
              정보가 틀렸어요
            </Link>
          </div>
        </div>
      </div>

      {/* 모바일 하단 고정 CTA */}
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-200/90 bg-white/95 px-3 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden">
        <div className="mx-auto flex max-w-4xl gap-2">
          <a
            href={mapHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-stone-800 ring-1 ring-stone-200 active:bg-stone-50"
          >
            <Navigation className="size-4" />
            길찾기
          </a>
          <a
            href={info.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 flex-[1.6] items-center justify-center gap-1.5 rounded-xl bg-teal-700 text-[15px] font-semibold text-white active:bg-teal-800"
          >
            {info.label}
            <ExternalLink className="size-4" />
          </a>
        </div>
      </div>
    </article>
  );
}

function Fact({
  icon,
  label,
  children,
  action,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <dt className="flex w-16 shrink-0 items-center gap-1.5 pt-px text-[13px] text-stone-500">
        <span className="text-teal-700">{icon}</span>
        {label}
      </dt>
      <dd className="min-w-0 flex-1 text-[15px] leading-snug text-stone-800">{children}</dd>
      {action}
    </div>
  );
}
