"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RefreshCw, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

type Phase =
  | "idle"
  | "requesting"
  | "collecting" // GitHub Actions가 수집 중
  | "deploying" // 수집 완료, 새 버전 배포 중
  | "ready" // 새 데이터가 배포됨
  | "cooldown"
  | "failed";

interface StatusResponse {
  enabled?: boolean;
  state?: "idle" | "queued" | "running" | "succeeded" | "failed";
  nextAllowedAt?: string | null;
  dataUpdatedAt?: string | null;
}

const POLL_MS = 15_000;
/** 수집이 끝난 뒤 배포를 이만큼 기다려도 안 바뀌면 그만 기다린다 */
const DEPLOY_WAIT_MS = 6 * 60_000;

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  });
}

/**
 * '최신 정보 가져오기': 누르면 수집을 바로 실행하고(약 5분), 새 데이터가 사이트에
 * 올라오면 새로고침을 권한다. 다른 사람이 이미 실행 중이면 그 진행 상황을 보여준다.
 */
export function RefreshControl({ initialDataUpdatedAt }: { initialDataUpdatedAt: string | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [nextAllowedAt, setNextAllowedAt] = useState<string | null>(null);
  const deploySince = useRef<number | null>(null);

  const check = useCallback(async (): Promise<Phase | null> => {
    const res = await fetch("/api/refresh", { cache: "no-store" });
    const body = (await res.json()) as StatusResponse;
    if (body.dataUpdatedAt && body.dataUpdatedAt !== initialDataUpdatedAt) return "ready";
    if (body.state === "queued" || body.state === "running") return "collecting";
    if (body.state === "failed") return "failed";
    if (body.state === "succeeded") return "deploying";
    return null;
  }, [initialDataUpdatedAt]);

  // 처음 열었을 때 누군가 이미 실행 중이면 진행 상황을 이어서 보여준다
  useEffect(() => {
    let alive = true;
    check()
      .then((p) => {
        if (alive && (p === "collecting" || p === "ready")) setPhase(p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [check]);

  useEffect(() => {
    if (phase !== "collecting" && phase !== "deploying") return;
    const timer = setInterval(async () => {
      try {
        const next = await check();
        if (next === "deploying") {
          deploySince.current ??= Date.now();
          if (Date.now() - deploySince.current > DEPLOY_WAIT_MS) {
            setPhase("ready"); // 배포 확인이 늦어도 새로고침하면 대부분 반영돼 있다
            return;
          }
        }
        if (next) setPhase(next);
      } catch {
        // 일시 오류는 다음 폴링에서 다시 확인
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [phase, check]);

  const start = async () => {
    setPhase("requesting");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const body = (await res.json()) as { reason?: string; nextAllowedAt?: string | null };
      if (body.reason === "started" || body.reason === "already_running") {
        deploySince.current = null;
        setPhase("collecting");
      } else if (body.reason === "cooldown") {
        setNextAllowedAt(body.nextAllowedAt ?? null);
        setPhase("cooldown");
      } else {
        setPhase("failed");
      }
    } catch {
      setPhase("failed");
    }
  };

  const busy = phase === "requesting" || phase === "collecting" || phase === "deploying";

  return (
    <>
      <span className="inline-flex items-center gap-1.5 text-xs" aria-live="polite">
        {phase === "idle" || phase === "failed" || phase === "cooldown" ? (
          <button
            type="button"
            onClick={start}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-white px-2.5 font-medium text-teal-800 ring-1 ring-stone-200 active:bg-stone-100"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            최신 정보 가져오기
          </button>
        ) : (
          <span
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-medium",
              phase === "ready" ? "bg-teal-700 text-white" : "bg-teal-50 text-teal-800",
            )}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="size-3.5" aria-hidden />
            )}
            {phase === "requesting" && "요청 중…"}
            {phase === "collecting" && "최신 정보 수집 중 · 약 5분"}
            {phase === "deploying" && "사이트에 반영 중…"}
            {phase === "ready" && "새 정보 반영됨"}
          </span>
        )}
        {phase === "cooldown" && (
          <span className="text-stone-500">
            방금 업데이트했어요{nextAllowedAt ? ` · ${hhmm(nextAllowedAt)} 이후 다시 가능` : ""}
          </span>
        )}
        {phase === "failed" && (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <TriangleAlert className="size-3.5" aria-hidden />
            잠시 후 다시 시도해 주세요
          </span>
        )}
      </span>

      {phase === "ready" && (
        <div className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 lg:bottom-4 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-sm text-white shadow-lg">
          <span>새 행사 정보가 반영됐어요</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-stone-900"
          >
            새로고침
          </button>
        </div>
      )}
    </>
  );
}
