"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, LocateFixed, MessageSquareText } from "lucide-react";

import { formatCount, formatDistance, kakaoSearchUrl, type FoodArea, type FoodPick } from "@/lib/food";

interface NearbyFoodProps {
  /** 행사에서 들어왔을 때 — 없으면 내 위치로 찾는다 */
  eventId: string | null;
  /** 키가 없거나 실패했을 때 쓸 네이버 검색어 ('연희동 맛집') */
  fallbackQuery: string;
}

type Status = "idle" | "locating" | "loading" | "ready" | "error";
type FoodResult = { picks: FoodPick[]; area: FoodArea } | { error: string };

async function fetchFood(params: string): Promise<FoodResult> {
  try {
    const res = await fetch(`/api/food?${params}`);
    const data = (await res.json()) as { picks?: FoodPick[]; area?: FoodArea; error?: string };
    if (res.ok && data.picks) return { picks: data.picks, area: data.area ?? {} };
    return { error: data.error ?? "맛집을 불러오지 못했어요." };
  } catch {
    return { error: "맛집을 불러오지 못했어요." };
  }
}

export function NearbyFood({ eventId, fallbackQuery }: NearbyFoodProps) {
  const [status, setStatus] = useState<Status>(eventId ? "loading" : "idle");
  const [picks, setPicks] = useState<FoodPick[]>([]);
  const [area, setArea] = useState<FoodArea>({});
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<string | null>(eventId ? `event=${encodeURIComponent(eventId)}` : null);

  const apply = useCallback((result: FoodResult) => {
    if ("picks" in result) {
      setPicks(result.picks);
      setArea(result.area);
      setError(null);
      setStatus("ready");
    } else {
      setError(result.error);
      setStatus("error");
    }
  }, []);
  const load = (p: string) => {
    setParams(p);
    setStatus("loading");
    void fetchFood(p).then(apply);
  };

  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    void fetchFood(`event=${encodeURIComponent(eventId)}`).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [eventId, apply]);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("이 기기에서는 위치를 쓸 수 없어요.");
      setStatus("error");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => load(`lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`),
      () => {
        setError("위치 권한을 허용하면 근처 맛집을 찾아드려요.");
        setStatus("error");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };

  const where = [area.district, area.dong].filter(Boolean).join(" ");
  const moreQuery = where ? `${where} 맛집` : fallbackQuery;

  return (
    <div className="space-y-4">
      {status === "idle" && (
        <button
          type="button"
          onClick={locate}
          className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-[15px] font-semibold text-white"
        >
          <LocateFixed className="size-4" aria-hidden />
          내 위치 근처 맛집 찾기
        </button>
      )}

      {(status === "locating" || status === "loading") && (
        <div className="space-y-2" aria-busy>
          <p className="text-[13px] text-stone-500">블로그 글이 많은 식당을 고르는 중이에요…</p>
          <ul className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="h-[72px] animate-pulse rounded-2xl bg-white/70 ring-1 ring-stone-200" />
            ))}
          </ul>
        </div>
      )}

      {status === "error" && (
        <div role="alert" className="space-y-3 rounded-2xl bg-white px-4 py-4 text-sm text-stone-700 ring-1 ring-stone-200">
          <p>{error}</p>
          <div className="flex flex-wrap gap-2">
            {params && (
              <button
                type="button"
                onClick={() => load(params)}
                className="h-10 rounded-full px-4 font-semibold text-teal-800 ring-1 ring-teal-200"
              >
                다시 시도
              </button>
            )}
            {!eventId && (
              <button type="button" onClick={locate} className="h-10 rounded-full px-4 font-semibold text-stone-800 ring-1 ring-stone-200">
                내 위치로 찾기
              </button>
            )}
            <a
              href={kakaoSearchUrl(moreQuery)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center rounded-full bg-[#fee500] px-4 font-semibold text-stone-900"
            >
              카카오맵에서 &lsquo;{moreQuery}&rsquo; 보기
            </a>
          </div>
        </div>
      )}

      {status === "ready" && (
        <>
          <p className="text-[13px] text-stone-600">
            {where ? <b className="font-semibold text-stone-800">{where}</b> : "이 근처"}에서 블로그 글이 많은 식당
            {picks.length > 0 ? ` ${picks.length}곳` : ""}이에요.
          </p>
          {picks.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-stone-600 ring-1 ring-stone-200">
              추천할 만한 식당을 찾지 못했어요.
            </p>
          ) : (
            <ol className="divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
              {picks.map((p, i) => (
                <li key={`${p.name}-${i}`}>
                  <a
                    href={p.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3.5 active:bg-stone-50"
                  >
                    <span className="w-5 shrink-0 text-center text-[15px] font-bold text-teal-700">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-stone-900">{p.name}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-stone-500">
                        {[p.category, p.distance != null ? `${eventId ? "행사장" : "내 위치"}에서 ${formatDistance(p.distance)}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-medium text-orange-700">
                        <MessageSquareText className="size-3.5" aria-hidden />
                        블로그 후기 {formatCount(p.blogCount)}건{p.blogMore ? " 이상" : ""}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-stone-400" aria-hidden />
                  </a>
                </li>
              ))}
            </ol>
          )}
          <p className="text-[11.5px] leading-5 text-stone-400">
            근처 {formatDistance(1500)} 안 식당 중 가게 이름이 실제로 나온 블로그 후기가 많은 순이에요 (가게당 최근 100건까지 확인).
            누르면 카카오맵에서 별점·리뷰·사진을 볼 수 있어요.
          </p>
        </>
      )}
    </div>
  );
}
