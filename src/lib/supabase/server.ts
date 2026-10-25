import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/** 이벤트 조회 캐시 태그 — 크론에서 revalidateTag(EVENTS_CACHE_TAG, "max") */
export const EVENTS_CACHE_TAG = "events";

export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      // 요청마다 DB를 치지 않도록 Next 데이터 캐시에 태그와 함께 저장
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          next: { revalidate: 3600, tags: [EVENTS_CACHE_TAG] },
        }),
    },
  });
}
