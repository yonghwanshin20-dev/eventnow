import { createHash, timingSafeEqual } from "node:crypto";

import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { EVENTS_CACHE_TAG } from "@/lib/supabase/server";

/**
 * 매일 UTC 19:00 (KST 04:00) — Vercel Cron(GET) + 크롤러 완료 후 호출(POST) 겸용.
 * 인증: `Authorization: Bearer <CRON_SECRET | REVALIDATE_SECRET>`
 * (Vercel Cron은 CRON_SECRET 환경변수가 있으면 이 헤더를 자동으로 붙인다)
 * - Supabase 상태 갱신 RPC (service role 있을 때)
 * - 이벤트 캐시 태그 + 페이지 재검증
 */

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function isAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return false;
  const secrets = [process.env.CRON_SECRET, process.env.REVALIDATE_SECRET].filter(
    (s): s is string => Boolean(s),
  );
  // 길이 차이로 새지 않게 해시끼리 상수 시간 비교
  return secrets.some((secret) => timingSafeEqual(digest(token), digest(secret)));
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let statusRefresh: "ok" | "skipped" | "error" = "skipped";
  let statusDetail: string | null = null;

  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey) {
    try {
      const supabase = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await supabase.rpc("refresh_event_statuses");
      if (error) {
        statusRefresh = "error";
        statusDetail = error.message;
      } else {
        statusRefresh = "ok";
        statusDetail = data == null ? null : String(data);
      }
    } catch (err) {
      statusRefresh = "error";
      statusDetail = err instanceof Error ? err.message : String(err);
    }
  }

  revalidateTag(EVENTS_CACHE_TAG, "max");
  revalidatePath("/", "layout");

  return NextResponse.json(
    {
      ok: statusRefresh !== "error",
      at: new Date().toISOString(),
      statusRefresh,
      statusDetail,
      revalidated: true,
    },
    { status: statusRefresh === "error" ? 500 : 200 },
  );
}

export const GET = handle;
export const POST = handle;
