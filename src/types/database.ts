import type {
  Event,
  EventInsert,
  EventUpdate,
} from "@/types/event";

export type { Event, EventInsert, EventUpdate } from "@/types/event";

/** Supabase generated-style Database typing for the `events` table */
export interface Database {
  public: {
    Tables: {
      events: {
        Row: Event;
        Insert: EventInsert;
        Update: EventUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
