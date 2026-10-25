/**
 * 피드백(오류 신고·행사 제보·건의) → GitHub 저장소 '이슈'로 남긴다.
 *
 * 로그인이나 별도 서버 없이, 저장소 주인이 만든 GitHub 토큰(이슈 쓰기 권한) 하나로 동작한다.
 * 이슈로 모아 두면 저장소에서 하나씩 확인·답변·반영 표시(닫기)를 할 수 있다.
 * 토큰은 서버(Vercel 환경변수)에만 있고 브라우저로 가지 않는다.
 */

export type FeedbackType = "bug" | "event" | "idea";

export const FEEDBACK_TYPES: { value: FeedbackType; label: string; hint: string }[] = [
  { value: "bug", label: "오류 신고", hint: "날짜·장소가 틀렸거나 화면이 이상해요" },
  { value: "event", label: "행사 제보", hint: "여기 없는 축제·행사를 알려 주세요" },
  { value: "idea", label: "건의하기", hint: "있었으면 하는 기능이나 바라는 점" },
];

export interface FeedbackInput {
  type: FeedbackType;
  message: string;
  /** 답을 받을 연락처 (선택) */
  contact?: string;
  /** 오류 신고한 행사 */
  eventId?: string;
  eventTitle?: string;
  /** 행사 제보 */
  reportTitle?: string;
  reportDate?: string;
  reportPlace?: string;
  reportLink?: string;
  /** 보낸 화면 주소 */
  page?: string;
}

/** 행사 화면의 [정보가 틀렸어요] → 그 행사를 붙여 오류 신고 화면으로 */
export function feedbackHref(event: { id: string; title: string }): string {
  const q = new URLSearchParams({ type: "bug", event: event.id, title: event.title.slice(0, 120) });
  return `/feedback?${q.toString()}`;
}

export interface FeedbackConfig {
  token: string;
  repo: string;
}

const LIMITS = {
  message: 2000,
  contact: 100,
  short: 120,
  link: 300,
};

export function getFeedbackConfig(
  env: Record<string, string | undefined> = process.env,
): FeedbackConfig | null {
  // 피드백 전용 토큰이 없으면 '최신 정보 가져오기' 토큰을 같이 쓴다 (권한에 이슈 쓰기가 있을 때)
  const token = (env.FEEDBACK_GITHUB_TOKEN || env.GITHUB_DISPATCH_TOKEN)?.trim();
  const vercelRepo =
    env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
      ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`
      : undefined;
  const repo = (env.GITHUB_REPOSITORY || vercelRepo)?.trim();
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { token, repo };
}

const clip = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\r/g, "").trim().slice(0, max) : "";

/** 받은 값을 정리·검사한다. 문제가 있으면 사용자에게 보여줄 문구를 돌려준다. */
export function validateFeedback(raw: unknown): { ok: true; value: FeedbackInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "내용을 다시 확인해 주세요." };
  const r = raw as Record<string, unknown>;
  const type = r.type === "bug" || r.type === "event" || r.type === "idea" ? r.type : null;
  if (!type) return { ok: false, error: "종류를 골라 주세요." };
  const value: FeedbackInput = {
    type,
    message: clip(r.message, LIMITS.message),
    contact: clip(r.contact, LIMITS.contact) || undefined,
    eventId: clip(r.eventId, 64).replace(/[^\w-]/g, "") || undefined,
    eventTitle: clip(r.eventTitle, LIMITS.short) || undefined,
    reportTitle: clip(r.reportTitle, LIMITS.short) || undefined,
    reportDate: clip(r.reportDate, 60) || undefined,
    reportPlace: clip(r.reportPlace, LIMITS.short) || undefined,
    reportLink: clip(r.reportLink, LIMITS.link) || undefined,
    page: clip(r.page, LIMITS.link) || undefined,
  };
  if (type === "event") {
    if (!value.reportTitle) return { ok: false, error: "행사 이름을 적어 주세요." };
    if (!value.reportDate && !value.reportPlace) {
      return { ok: false, error: "날짜나 장소 중 하나는 적어 주세요." };
    }
  } else if (value.message.length < 5) {
    return { ok: false, error: "내용을 조금 더 자세히 적어 주세요 (5자 이상)." };
  }
  if (value.reportLink && !/^https?:\/\//i.test(value.reportLink)) {
    return { ok: false, error: "링크는 http로 시작하는 주소로 적어 주세요." };
  }
  return { ok: true, value };
}

/** 이슈 제목·본문 (마크다운). 사용자가 쓴 글은 인용 블록으로 넣어 서식이 섞이지 않게 한다. */
export function buildIssue(input: FeedbackInput, siteUrl: string): { title: string; body: string; labels: string[] } {
  const kind = FEEDBACK_TYPES.find((t) => t.value === input.type)!.label;
  const quote = (s: string) =>
    s
      .split("\n")
      .map((l) => `> ${l.replace(/@/g, "@​")}`) // @멘션으로 남을 부르지 않게
      .join("\n");
  const lines: string[] = [];
  if (input.type === "event") {
    lines.push(
      "### 제보한 행사",
      `- 이름: ${input.reportTitle}`,
      `- 날짜: ${input.reportDate || "(안 적음)"}`,
      `- 장소: ${input.reportPlace || "(안 적음)"}`,
      `- 링크: ${input.reportLink || "(없음)"}`,
    );
  }
  if (input.eventId) {
    lines.push("", "### 신고한 행사", `- ${input.eventTitle || input.eventId}: ${siteUrl}/events/${input.eventId}`);
  }
  if (input.message) lines.push("", "### 내용", quote(input.message));
  if (input.contact) lines.push("", `연락처: ${input.contact}`);
  if (input.page) lines.push("", `보낸 화면: ${input.page}`);
  lines.push("", "---", "앱의 [피드백]에서 보냈어요. 확인·반영하면 이슈를 닫아 주세요.");
  const subject =
    input.type === "event"
      ? input.reportTitle!
      : input.eventTitle || input.message.split("\n")[0].slice(0, 50);
  return {
    title: `[${kind}] ${subject}`.slice(0, 120),
    body: lines.join("\n"),
    labels: ["feedback", input.type === "bug" ? "bug" : input.type === "event" ? "event-report" : "idea"],
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function createIssue(
  config: FeedbackConfig,
  issue: { title: string; body: string; labels: string[] },
  fetchImpl: FetchLike = fetch,
): Promise<{ number: number }> {
  const post = (payload: object) =>
    fetchImpl(`https://api.github.com/repos/${config.repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  let res = await post(issue);
  // 라벨을 만들 권한이 없는 토큰이면(422·403) 라벨 없이 다시 — 내용은 그대로 남는다
  if (res.status === 422 || res.status === 403) {
    res = await post({ title: issue.title, body: issue.body });
  }
  if (!res.ok) throw new Error(`github ${res.status}`);
  const data = (await res.json()) as { number: number };
  return { number: data.number };
}
