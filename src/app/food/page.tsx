import type { Metadata } from "next";

import { NearbyFood } from "@/components/food/nearby-food";
import { SiteHeader } from "@/components/layout/site-header";
import { getEventById } from "@/lib/events-data";

export const metadata: Metadata = {
  title: "주변 맛집",
  description: "행사장 근처에서 후기 많고 요즘도 인기 있는 맛집·카페를 골라 드려요.",
};

interface FoodPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** 주변 맛집 — ?event=<id> 이면 그 행사장 동네, 아니면 내 위치 동네 */
export default async function FoodPage({ searchParams }: FoodPageProps) {
  const params = await searchParams;
  const event = params.event ? (await getEventById(one(params.event)))?.event : undefined;
  const where = event ? [event.district, event.dong].filter(Boolean).join(" ") || event.location_name : "";

  return (
    <div className="flex min-h-full flex-col bg-[#f6f3ee]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-4 px-4 pt-5 pb-28 sm:pb-12">
        <section className="space-y-1.5">
          <h1 className="text-[22px] font-bold tracking-tight text-stone-900">주변 맛집</h1>
          <p className="text-sm leading-6 text-stone-600">
            {event
              ? `${event.title} 다녀오는 길에 들르기 좋은, 블로그 글이 많은 식당이에요.`
              : "내 위치 동네에서 블로그 글이 많은 식당 10곳을 골라 드려요."}
          </p>
        </section>
        <NearbyFood eventId={event?.id ?? null} fallbackQuery={where ? `${where} 맛집` : "맛집"} />
      </main>
    </div>
  );
}
