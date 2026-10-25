import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { EventDetail } from "@/components/events/event-detail";
import { EventShelf } from "@/components/events/event-shelf";
import { QuickViewHost } from "@/components/events/quick-view-host";
import { relatedShelves } from "@/lib/related";
import { SiteHeader } from "@/components/layout/site-header";
import { getAllEvents, getEventById } from "@/lib/events-data";
import { formatShortRange, getScheduleType } from "@/lib/events";
import { isHttpUrl } from "@/lib/images";
import { siteUrl } from "@/lib/links";
import type { Event } from "@/types/event";

export const revalidate = 3600;

interface EventPageProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  const events = await getAllEvents();
  // 관광지(전국 수천 곳)는 미리 만들지 않고 처음 열 때 만든다 — 배포 시간이 너무 길어지지 않게
  return events.filter((e) => e.category !== "attraction").map((e) => ({ id: e.id }));
}

export async function generateMetadata({
  params,
}: EventPageProps): Promise<Metadata> {
  const { id } = await params;
  const found = await getEventById(id);
  if (!found) return { title: "이벤트 없음" };
  const { event, canonicalId } = found;
  // 미리보기 첫 줄은 '언제·어디' — 소개글이 "문의 033-…"뿐인 행사도 쓸모 있는 설명이 되게
  const when =
    getScheduleType(event) === "permanent"
      ? "상시 운영"
      : formatShortRange(event.start_date, event.end_date);
  const description = [`${when} · ${event.location_name}`, event.description?.slice(0, 120)]
    .filter(Boolean)
    .join(" — ");
  const url = `${siteUrl()}/events/${canonicalId}`;
  return {
    title: event.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      title: event.title,
      description,
      siteName: "EventNow",
      locale: "ko_KR",
      // 미리보기 이미지는 같은 폴더의 opengraph-image.tsx (제목·일정·장소 카드)
    },
  };
}

const EVENT_STATUS_SCHEMA = "https://schema.org/EventScheduled";

function eventJsonLd(event: Event, url: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: event.description ?? undefined,
    startDate: event.start_date,
    endDate: event.end_date,
    eventStatus: EVENT_STATUS_SCHEMA,
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    image: isHttpUrl(event.thumbnail_url) ? [event.thumbnail_url] : undefined,
    url,
    location: {
      "@type": "Place",
      name: event.location_name,
      address: {
        "@type": "PostalAddress",
        streetAddress: event.address,
        addressRegion: event.region,
        addressCountry: "KR",
      },
      geo:
        event.latitude != null && event.longitude != null
          ? {
              "@type": "GeoCoordinates",
              latitude: event.latitude,
              longitude: event.longitude,
            }
          : undefined,
    },
    isAccessibleForFree: event.price_info ? /무료/.test(event.price_info) : undefined,
  };
}

export default async function EventPage({ params }: EventPageProps) {
  const { id } = await params;
  const found = await getEventById(id);
  if (!found) notFound();
  // 옛 events.json 링크(evt-xxxx) → DB UUID 주소로 영구 이동
  if (found.canonicalId !== id) permanentRedirect(`/events/${found.canonicalId}`);

  const { event } = found;
  const url = `${siteUrl()}/events/${event.id}`;
  const related = relatedShelves(event, await getAllEvents());

  return (
    <div className="flex min-h-full flex-col bg-[#f6f3ee]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(eventJsonLd(event, url)).replace(/</g, "\\u003c"),
        }}
      />
      <SiteHeader />
      <main className="flex-1">
        <EventDetail event={event} url={url} />
        {related.length > 0 && (
          <QuickViewHost items={related.flatMap((s) => s.items)}>
            <div className="mx-auto w-full max-w-3xl space-y-7 px-3 pt-2 pb-28 sm:px-4 sm:pb-12">
              {related.map((shelf) => (
                <EventShelf
                  key={shelf.title}
                  title={shelf.title}
                  hint={shelf.hint}
                  items={shelf.items}
                  seeAllHref={shelf.seeAllHref}
                  deferUntilVisible
                />
              ))}
            </div>
          </QuickViewHost>
        )}
      </main>
    </div>
  );
}
