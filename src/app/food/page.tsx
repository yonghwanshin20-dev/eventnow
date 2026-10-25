import type { Metadata } from "next";

import { NearbyFood } from "@/components/food/nearby-food";
import { SiteHeader } from "@/components/layout/site-header";
import { getEventById } from "@/lib/events-data";

export const metadata: Metadata = {
  title: "주변 맛집",
  description: "행사장이나 내 위치 근처 식당·카페를 가까운 순으로 보여줘요.",
};

interface FoodPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** 주변 맛집 — ?event=<id> 이면 그 행사장 근처, 아니면 내 위치로 찾는다 */
export default async function FoodPage({ searchParams }: FoodPageProps) {
  const params = await searchParams;
  const found = params.event ? await getEventById(one(params.event)) : undefined;
  const event = found?.event;
  const base =
    event && event.latitude != null && event.longitude != null
      ? {
          lat: event.latitude,
          lng: event.longitude,
          name: event.location_name || event.title,
          area: event.district ?? null,
          eventId: event.id,
          eventTitle: event.title,
        }
      : null;

  return (
    <div className="flex min-h-full flex-col bg-[#f6f3ee]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-4 px-4 pt-5 pb-28 sm:pb-12">
        <section className="space-y-1.5">
          <h1 className="text-[22px] font-bold tracking-tight text-stone-900">주변 맛집</h1>
          <p className="text-sm leading-6 text-stone-600">
            {base
              ? `${base.name} 근처 식당·카페를 가까운 순으로 모았어요.`
              : event
                ? `${event.title}은(는) 정확한 위치가 없어 내 위치로 찾아볼게요.`
                : "내 위치 근처 식당·카페를 가까운 순으로 보여줘요."}
          </p>
        </section>
        <NearbyFood base={base} fallbackQuery={event ? (event.location_name || event.address || event.title) : null} />
      </main>
    </div>
  );
}
