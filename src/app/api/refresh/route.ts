import { NextResponse } from "next/server";

import { FALLBACK_GENERATED_AT } from "@/data/fallback-events";
import { getRefreshConfig, getRefreshStatus, requestRefresh } from "@/lib/refresh";

/** 항상 최신 상태를 돌려준다 (캐시 금지) */
export const dynamic = "force-dynamic";

/**
 * GET: 업데이트 진행 상태 + 지금 배포된 데이터의 생성 시각
 * (수집이 끝나고 새 배포가 올라가면 dataUpdatedAt이 바뀌어 화면이 '반영됨'을 안다)
 */
export async function GET() {
  try {
    const status = await getRefreshStatus(getRefreshConfig());
    return NextResponse.json({ ...status, dataUpdatedAt: FALLBACK_GENERATED_AT });
  } catch (err) {
    console.error("[refresh] status failed:", err);
    return NextResponse.json(
      { enabled: true, state: "idle", error: "status_unavailable", dataUpdatedAt: FALLBACK_GENERATED_AT },
      { status: 502 },
    );
  }
}

/** POST: 지금 바로 수집 실행 요청 (실행 중·30분 쿨다운이면 거절) */
export async function POST() {
  try {
    const result = await requestRefresh(getRefreshConfig());
    switch (result.kind) {
      case "disabled":
        return NextResponse.json({ ok: false, reason: "disabled" }, { status: 404 });
      case "already_running":
        return NextResponse.json({ ok: true, reason: "already_running", ...result.status }, { status: 202 });
      case "cooldown":
        return NextResponse.json({ ok: false, reason: "cooldown", ...result.status }, { status: 429 });
      case "started":
        return NextResponse.json({ ok: true, reason: "started" }, { status: 202 });
    }
  } catch (err) {
    console.error("[refresh] dispatch failed:", err);
    return NextResponse.json({ ok: false, reason: "error" }, { status: 502 });
  }
}
