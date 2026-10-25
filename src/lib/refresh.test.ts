import { describe, expect, it } from "vitest";

import {
  COOLDOWN_MS,
  getRefreshConfig,
  getRefreshStatus,
  requestRefresh,
  type RefreshConfig,
} from "@/lib/refresh";

const CFG: RefreshConfig = { token: "t", repo: "me/eventnow", ref: "main" };
const NOW = new Date("2026-10-19T09:00:00Z");

function fakeGitHub(run: { status: string; conclusion: string | null; created_at: string } | null) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    if (url.includes("/dispatches")) return new Response(null, { status: 204 });
    return Response.json({ workflow_runs: run ? [run] : [] });
  };
  return { calls, fetchImpl };
}

describe("getRefreshConfig", () => {
  it("토큰·저장소가 없으면 비활성", () => {
    expect(getRefreshConfig({})).toBeNull();
    expect(getRefreshConfig({ GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPOSITORY: "bad repo" })).toBeNull();
    expect(getRefreshConfig({ GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPOSITORY: "me/eventnow" })).toEqual(CFG);
  });
  it("저장소를 비워 두면 Vercel에 연결된 저장소를 쓴다", () => {
    expect(
      getRefreshConfig({
        GITHUB_DISPATCH_TOKEN: "t",
        VERCEL_GIT_REPO_OWNER: "me",
        VERCEL_GIT_REPO_SLUG: "eventnow",
      }),
    ).toEqual(CFG);
  });
});

describe("requestRefresh", () => {
  it("최근 실행이 없으면 빠른 수집을 실행", async () => {
    const gh = fakeGitHub(null);
    expect(await requestRefresh(CFG, gh.fetchImpl, NOW)).toEqual({ kind: "started" });
    const dispatch = gh.calls.find((c) => c.url.endsWith("/dispatches"));
    expect(dispatch?.method).toBe("POST");
    expect(JSON.parse(dispatch!.body!)).toEqual({
      ref: "main",
      inputs: { sources: "kfes,culture,seoulportal,mcst,city,public,venue", quick: "true" },
    });
  });

  it("이미 실행 중이면 또 실행하지 않는다", async () => {
    const gh = fakeGitHub({ status: "in_progress", conclusion: null, created_at: "2026-10-19T08:58:00Z" });
    const result = await requestRefresh(CFG, gh.fetchImpl, NOW);
    expect(result.kind).toBe("already_running");
    expect(gh.calls.some((c) => c.url.endsWith("/dispatches"))).toBe(false);
  });

  it("끝난 지 30분이 안 됐으면 쿨다운", async () => {
    const created = new Date(NOW.getTime() - COOLDOWN_MS + 60_000).toISOString();
    const gh = fakeGitHub({ status: "completed", conclusion: "success", created_at: created });
    const result = await requestRefresh(CFG, gh.fetchImpl, NOW);
    expect(result.kind).toBe("cooldown");
    if (result.kind === "cooldown") expect(result.status.nextAllowedAt).not.toBeNull();
  });

  it("30분이 지났으면 다시 실행", async () => {
    const created = new Date(NOW.getTime() - COOLDOWN_MS - 1).toISOString();
    const gh = fakeGitHub({ status: "completed", conclusion: "failure", created_at: created });
    expect((await requestRefresh(CFG, gh.fetchImpl, NOW)).kind).toBe("started");
  });

  it("토큰이 없으면 아무것도 하지 않는다", async () => {
    expect(await requestRefresh(null)).toEqual({ kind: "disabled" });
    expect((await getRefreshStatus(null)).enabled).toBe(false);
  });
});
