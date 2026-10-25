/**
 * '최신 정보 가져오기' — GitHub Actions의 Daily Crawler를 지금 바로 실행시킨다.
 *
 * 데이터 수집 자체에는 API 키가 필요 없다. 다만 웹사이트가 GitHub에 "실행해 줘"라고
 * 요청하려면 저장소 주인이 만든 GitHub 토큰(Actions 실행 권한만) 하나가 필요하다.
 * 토큰이 없으면 버튼이 숨겨지고 매일 새벽 자동 갱신만 동작한다.
 */

export const WORKFLOW_FILE = "daily-crawler.yml";
/** 같은 요청을 너무 자주 받지 않도록 마지막 실행 후 이 시간 동안은 다시 실행하지 않는다 */
export const COOLDOWN_MS = 30 * 60 * 1000;
/** 버튼으로 실행할 때는 빠른 소스만 (팝업 스크래퍼는 브라우저 설치가 필요해 느림) */
export const QUICK_SOURCES = "kfes,culture,seoulportal,mcst,city,public,venue";

export interface RefreshConfig {
  token: string;
  repo: string;
  ref: string;
}

export type RunState = "idle" | "queued" | "running" | "succeeded" | "failed";

export interface RefreshStatus {
  enabled: boolean;
  state: RunState;
  /** 마지막 실행 시작 시각 (ISO) */
  startedAt: string | null;
  /** 다시 요청할 수 있는 시각 (ISO) — 쿨다운 중일 때만 */
  nextAllowedAt: string | null;
}

export function getRefreshConfig(
  env: Record<string, string | undefined> = process.env,
): RefreshConfig | null {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  // 저장소·브랜치는 직접 넣지 않으면 Vercel이 알려주는 연결된 GitHub 저장소를 쓴다 (토큰만 넣으면 됨)
  const vercelRepo =
    env.VERCEL_GIT_REPO_OWNER && env.VERCEL_GIT_REPO_SLUG
      ? `${env.VERCEL_GIT_REPO_OWNER}/${env.VERCEL_GIT_REPO_SLUG}`
      : undefined;
  const repo = (env.GITHUB_REPOSITORY || vercelRepo)?.trim();
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { token, repo, ref: env.GITHUB_REF_NAME?.trim() || "main" };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface WorkflowRun {
  status: string;
  conclusion: string | null;
  created_at: string;
}

function headers(cfg: RefreshConfig): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${cfg.token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "eventnow-refresh",
  };
}

async function latestRun(cfg: RefreshConfig, fetchImpl: FetchLike): Promise<WorkflowRun | null> {
  const res = await fetchImpl(
    `https://api.github.com/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=1`,
    { headers: headers(cfg), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`GitHub runs ${res.status}`);
  const body = (await res.json()) as { workflow_runs?: WorkflowRun[] };
  return body.workflow_runs?.[0] ?? null;
}

function toState(run: WorkflowRun | null): RunState {
  if (!run) return "idle";
  if (run.status === "queued" || run.status === "waiting" || run.status === "pending") {
    return "queued";
  }
  if (run.status !== "completed") return "running";
  return run.conclusion === "success" ? "succeeded" : "failed";
}

function cooldownUntil(run: WorkflowRun | null, now: Date): string | null {
  if (!run) return null;
  const until = Date.parse(run.created_at) + COOLDOWN_MS;
  return until > now.getTime() ? new Date(until).toISOString() : null;
}

export async function getRefreshStatus(
  cfg: RefreshConfig | null,
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<RefreshStatus> {
  if (!cfg) return { enabled: false, state: "idle", startedAt: null, nextAllowedAt: null };
  const run = await latestRun(cfg, fetchImpl);
  return {
    enabled: true,
    state: toState(run),
    startedAt: run?.created_at ?? null,
    nextAllowedAt: cooldownUntil(run, now),
  };
}

export type RefreshRequestResult =
  | { kind: "started" }
  | { kind: "already_running"; status: RefreshStatus }
  | { kind: "cooldown"; status: RefreshStatus }
  | { kind: "disabled" };

/** 실행 중이거나 쿨다운이면 새로 실행하지 않는다 */
export async function requestRefresh(
  cfg: RefreshConfig | null,
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<RefreshRequestResult> {
  if (!cfg) return { kind: "disabled" };
  const status = await getRefreshStatus(cfg, fetchImpl, now);
  if (status.state === "queued" || status.state === "running") {
    return { kind: "already_running", status };
  }
  if (status.nextAllowedAt) return { kind: "cooldown", status };

  const res = await fetchImpl(
    `https://api.github.com/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: "POST",
      headers: { ...headers(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ ref: cfg.ref, inputs: { sources: QUICK_SOURCES, quick: "true" } }),
      cache: "no-store",
    },
  );
  if (!res.ok && res.status !== 204) throw new Error(`GitHub dispatch ${res.status}`);
  return { kind: "started" };
}
