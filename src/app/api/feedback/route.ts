import { NextResponse } from "next/server";

import { buildIssue, createIssue, getFeedbackConfig, validateFeedback } from "@/lib/feedback";
import { siteUrl } from "@/lib/links";

/** 같은 사람(IP)이 짧은 시간에 너무 많이 보내지 않게 — 서버 한 대 기준 간단한 제한 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > MAX_PER_WINDOW;
}

/** GET: 지금 보낼 수 있는지 (토큰 설정 여부) — 화면이 안내 문구를 고른다 */
export async function GET() {
  return NextResponse.json({ enabled: getFeedbackConfig() != null });
}

/** POST: 피드백 한 건 → GitHub 이슈 */
export async function POST(request: Request) {
  const config = getFeedbackConfig();
  if (!config) {
    return NextResponse.json({ error: "아직 피드백을 받을 준비가 안 됐어요." }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "내용을 다시 확인해 주세요." }, { status: 400 });
  }
  // 사람 눈에는 안 보이는 칸 — 자동으로 채우는 스팸 봇만 여기에 글을 넣는다
  if (body && typeof body === "object" && (body as Record<string, unknown>).website) {
    return NextResponse.json({ ok: true });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "잠시 후 다시 보내 주세요." }, { status: 429 });
  }
  const checked = validateFeedback(body);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  try {
    const issue = await createIssue(config, buildIssue(checked.value, siteUrl()));
    return NextResponse.json({ ok: true, number: issue.number });
  } catch (err) {
    console.error("[feedback] github failed:", err);
    return NextResponse.json({ error: "보내지 못했어요. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
