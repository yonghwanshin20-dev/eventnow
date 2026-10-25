import { addDays } from "@/lib/dates";
import type { Event } from "@/types/event";

function escapeIcs(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** RFC 5545 줄 접기 (75 octets) */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    if (size + len > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += len;
  }
  out.push(current);
  return out.join("\r\n ");
}

type CalendarFields = Pick<
  Event,
  "id" | "title" | "start_date" | "end_date" | "location_name" | "address" | "description"
>;

/**
 * 구글 캘린더 '일정 추가' 화면 링크 (로그인만 돼 있으면 안드로이드·PC에서 바로 저장).
 * 기간이 긴 행사는 통째로 넣으면 달력이 막히므로 `day`(가려는 날)를 주면 그날 하루로 넣는다.
 */
export function googleCalendarUrl(event: CalendarFields, url: string, day?: string): string {
  const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
  const start = day ?? event.start_date;
  const end = addDays(day ?? event.end_date, 1);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${ymd(start)}/${ymd(end)}`,
    location: [event.location_name, event.address].filter(Boolean).join(", "),
    details: [event.description?.slice(0, 300), url].filter(Boolean).join("\n\n"),
    ctz: "Asia/Seoul",
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** 종일 일정 .ics (DTEND는 종료일 다음 날 — 종일 일정 규칙). `day`를 주면 그날 하루만 */
export function buildIcs(
  event: CalendarFields,
  url: string,
  now: Date = new Date(),
  day?: string,
): string {
  const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, "");
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const location = [event.location_name, event.address].filter(Boolean).join(", ");
  const description = [event.description?.slice(0, 500), url].filter(Boolean).join("\n\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EventNow//KO",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${event.id}${day ? `-${ymd(day)}` : ""}@eventnow`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(day ?? event.start_date)}`,
    `DTEND;VALUE=DATE:${ymd(addDays(day ?? event.end_date, 1))}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `LOCATION:${escapeIcs(location)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `URL:${url}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .map(fold)
    .join("\r\n");
}
