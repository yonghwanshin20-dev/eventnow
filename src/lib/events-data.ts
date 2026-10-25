import { cache } from "react";

import { FALLBACK_EVENTS, FALLBACK_GENERATED_AT } from "@/data/fallback-events";
import { computeStatus, todayKst } from "@/lib/dates";
import { createServerClient } from "@/lib/supabase/server";
import type { Event } from "@/types/event";

/** supabase: DB 조회 / json: 저장소에 커밋된 events.json (무료 모드 또는 DB 장애 시) */
export type EventsSource = "supabase" | "json";

export interface EventsSnapshot {
  events: Event[];
  source: EventsSource;
  /** 마지막 데이터 갱신 시각 (ISO 타임스탬프) */
  lastUpdatedAt: string | null;
  /** 자동 수집 파이프라인이 만든 데이터인지 (json 모드에서 meta.generated_at 존재) */
  autoCollected: boolean;
  /** Supabase가 설정돼 있는데 실패해 보관 데이터를 보여주는 중 */
  degraded: boolean;
}

/** PostgREST 기본 max-rows(1000) 때문에 페이지 단위로 끝까지 읽는다 */
const PAGE = 1000;
const MAX_ROWS = 20_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

function normalizeEvent(row: Record<string, unknown>, today: string): Event {
  const event = row as unknown as Event;
  // 위도·경도 중 하나만 있는 좌표(7월 데이터)는 쓸 수 없으니 둘 다 비운다
  const hasCoords = row.latitude != null && row.longitude != null;
  return {
    ...event,
    place_types: (row.place_types as Event["place_types"]) ?? [],
    tags: (row.tags as Event["tags"]) ?? [],
    amenities: (row.amenities as Event["amenities"]) ?? {
      parking: false,
      stroller: false,
      nursing_room: false,
    },
    latitude: hasCoords ? Number(row.latitude) : null,
    longitude: hasCoords ? Number(row.longitude) : null,
    // 저장된 status는 하루 이상 늦을 수 있어 항상 날짜로 다시 계산
    status: computeStatus(event.start_date, event.end_date, today),
  };
}

function latestUpdatedAt(events: Event[]): string | null {
  let latest: string | null = null;
  for (const e of events) {
    if (e.updated_at && (!latest || e.updated_at > latest)) latest = e.updated_at;
  }
  return latest;
}

function fallbackSnapshot(degraded: boolean): EventsSnapshot {
  const today = todayKst();
  const events = FALLBACK_EVENTS.map((e) =>
    normalizeEvent(e as unknown as Record<string, unknown>, today),
  );
  return {
    events,
    source: "json",
    lastUpdatedAt: FALLBACK_GENERATED_AT ?? latestUpdatedAt(events),
    autoCollected: Boolean(FALLBACK_GENERATED_AT),
    degraded,
  };
}

async function fetchAllRows(): Promise<Record<string, unknown>[]> {
  const supabase = createServerClient();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .order("start_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * 운영: Supabase `events` 전체 조회 (태그 캐시).
 * 미설정/장애: events.json 보관 데이터 + degraded 표시.
 */
export const getEventsSnapshot = cache(async (): Promise<EventsSnapshot> => {
  if (!hasSupabaseEnv()) return fallbackSnapshot(false);

  try {
    const rows = await fetchAllRows();
    if (rows.length === 0) {
      console.error("[getEventsSnapshot] Supabase returned 0 rows — using fallback");
      return fallbackSnapshot(true);
    }
    const today = todayKst();
    const events = rows.map((row) => normalizeEvent(row, today));
    return {
      events,
      source: "supabase",
      lastUpdatedAt: latestUpdatedAt(events),
      autoCollected: true,
      degraded: false,
    };
  } catch (err) {
    console.error("[getEventsSnapshot] Supabase error — using fallback:", err);
    return fallbackSnapshot(true);
  }
});

export async function getAllEvents(): Promise<Event[]> {
  return (await getEventsSnapshot()).events;
}

export interface EventLookup {
  event: Event;
  /** 요청한 id와 다르면 이 id로 영구 리다이렉트 (옛 evt-xxxx 링크) */
  canonicalId: string;
}

export const getEventById = cache(
  async (id: string): Promise<EventLookup | undefined> => {
    const today = todayKst();
    const fromFallback = () => {
      const row = FALLBACK_EVENTS.find((e) => e.id === id);
      return row
        ? {
            event: normalizeEvent(row as unknown as Record<string, unknown>, today),
            canonicalId: row.id,
          }
        : undefined;
    };

    if (!hasSupabaseEnv()) return fromFallback();

    try {
      const supabase = createServerClient();
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq(UUID_RE.test(id) ? "id" : "legacy_id", id)
        .maybeSingle();

      if (error) throw new Error(error.message);
      if (!data) return fromFallback();

      const event = normalizeEvent(data as Record<string, unknown>, today);
      return { event, canonicalId: event.id };
    } catch (err) {
      console.error("[getEventById] Supabase error — using fallback:", err);
      return fromFallback();
    }
  },
);
