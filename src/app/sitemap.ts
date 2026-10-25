import type { MetadataRoute } from "next";

import { REGION_SLUGS } from "@/data/regions";
import { todayKst } from "@/lib/dates";
import { getAllEvents } from "@/lib/events-data";
import { siteUrl } from "@/lib/links";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const today = todayKst();
  const events = await getAllEvents();

  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    ...Object.keys(REGION_SLUGS).map((slug) => ({
      url: `${base}/region/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
    // 끝난 행사는 검색 노출 가치가 낮아 제외
    ...events
      .filter((e) => e.end_date >= today)
      .map((e) => ({
        url: `${base}/events/${e.id}`,
        lastModified: e.updated_at ? new Date(e.updated_at) : undefined,
        changeFrequency: "weekly" as const,
        priority: 0.6,
      })),
  ];
}
