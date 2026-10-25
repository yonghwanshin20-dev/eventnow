import type { Event } from "@/types/event";
import eventsJson from "@/data/events.json";
import eventsMeta from "@/data/events-meta.json";

/**
 * 저장소에 커밋된 이벤트 데이터. 무료 모드에서는 GitHub Actions가 매일 갱신·커밋하고
 * Supabase 모드에서는 DB 장애 시 보여주는 보관본이 된다.
 */
export const FALLBACK_EVENTS = eventsJson as Event[];

/** 파이프라인이 마지막으로 이 파일을 쓴 시각 (한 번도 안 돌았으면 null) */
export const FALLBACK_GENERATED_AT: string | null =
  (eventsMeta as { generated_at: string | null }).generated_at;
