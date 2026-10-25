import type { Event } from "@/types/event";

export function venueTypeLabel(event: Event): string | null {
  const blob = `${event.title} ${event.location_name} ${(event.tags ?? []).join(" ")}`;
  if (blob.includes("박물관") || (event.tags ?? []).includes("#박물관")) {
    return "박물관";
  }
  if (blob.includes("미술관") || (event.tags ?? []).includes("#미술관")) {
    return "미술관";
  }
  if ((event.tags ?? []).includes("#상설전시")) {
    return "상설전시";
  }
  if (event.category === "festival" && event.region === "서울특별시" && event.district) {
    return `${event.district} 행사`;
  }
  return null;
}
