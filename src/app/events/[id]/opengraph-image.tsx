import { regionShortLabel } from "@/data/regions";
import { CATEGORY_LABELS, formatLongRange } from "@/lib/events";
import { getEventById } from "@/lib/events-data";
import { OG_SIZE, renderOgCard } from "@/lib/og";
import type { EventCategory } from "@/types/event";

export const alt = "EventNow 행사 정보";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

const ACCENT: Record<EventCategory, string> = {
  festival: "#0f766e",
  exhibition: "#6d28d9",
  popup: "#b45309",
  kids_experience: "#0369a1",
};

/** 카카오톡 등에 링크를 공유할 때 보이는 미리보기: 제목 · 일정 · 장소 */
export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await getEventById(id);
  if (!found) {
    return renderOgCard({ eyebrow: "EventNow", title: "행사 정보", lines: [] });
  }
  const { event } = found;
  return renderOgCard({
    eyebrow: CATEGORY_LABELS[event.category],
    title: event.title.length > 40 ? `${event.title.slice(0, 39)}…` : event.title,
    lines: [
      formatLongRange(event.start_date, event.end_date),
      `${regionShortLabel(event.region)} · ${event.location_name}`.slice(0, 40),
    ],
    accent: ACCENT[event.category],
  });
}
