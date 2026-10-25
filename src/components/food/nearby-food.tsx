"use client";

import { useCallback, useEffect, useState } from "react";
import { Baby, Flame, LocateFixed, MessageSquareText, Star, Users } from "lucide-react";

import {
  FOOD_KIND_LABELS,
  formatCount,
  formatDistance,
  kakaoSearchUrl,
  type FoodArea,
  type FoodKind,
  type FoodPick,
} from "@/lib/food";
import { cn } from "@/lib/utils";

interface NearbyFoodProps {
  /** 행사에서 들어왔을 때 — 없으면 내 위치로 찾는다 */
  eventId: string | null;
  /** 키가 없거나 실패했을 때 쓸 검색어 ('연희동 맛집') */
  fallbackQuery: string;
}

type Status = "idle" | "locating" | "loading" | "ready" | "error";
type FoodResult = { picks: FoodPick[]; area: FoodArea; rated: boolean } | { error: string };

async function fetchFood(params: string): Promise<FoodResult> {
  try {
    const res = await fetch(`/api/food?${params}`);
    const data = (await res.json()) as { picks?: FoodPick[]; area?: FoodArea; rated?: boolean; error?: string };
    if (res.ok && data.picks) return { picks: data.picks, area: data.area ?? {}, rated: Boolean(data.rated) };
    return { error: data.error ?? "맛집을 불러오지 못했어요." };
  } catch {
    return { error: "맛집을 불러오지 못했어요." };
  }
}

const withKind = (base: string, kind: FoodKind) => (kind === "cafe" ? `${base}&kind=cafe` : base);

export function NearbyFood({ eventId, fallbackQuery }: NearbyFoodProps) {
  const [kind, setKind] = useState<FoodKind>("meal");
  const [status, setStatus] = useState<Status>(eventId ? "loading" : "idle");
  const [picks, setPicks] = useState<FoodPick[]>([]);
  const [area, setArea] = useState<FoodArea>({});
  const [rated, setRated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 위치(행사 또는 내 좌표) — 탭을 바꿔도 같은 곳에서 다시 찾는다
  const [base, setBase] = useState<string | null>(eventId ? `event=${encodeURIComponent(eventId)}` : null);

  const apply = useCallback((result: FoodResult) => {
    if ("picks" in result) {
      setPicks(result.picks);
      setArea(result.area);
      setRated(result.rated);
      setError(null);
      setStatus("ready");
    } else {
      setError(result.error);
      setStatus("error");
    }
  }, []);
  const load = (b: string, k: FoodKind) => {
    setBase(b);
    setStatus("loading");
    void fetchFood(withKind(b, k)).then(apply);
  };

  useEffect(() => {
    if (!eventId) return;
    let alive = true;
    void fetchFood(`event=${encodeURIComponent(eventId)}`).then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, [eventId, apply]);

  const switchKind = (k: FoodKind) => {
    if (k === kind) return;
    setKind(k);
    if (base) load(base, k);
  };

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("이 기기에서는 위치를 쓸 수 없어요.");
      setStatus("error");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => load(`lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`, kind),
      () => {
        setError("위치 권한을 허용하면 근처 맛집을 찾아드려요.");
        setStatus("error");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };

  const where = [area.district, area.dong].filter(Boolean).join(" ");
  const moreQuery = where ? `${where} ${kind === "cafe" ? "카페" : "맛집"}` : fallbackQuery;

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="종류" className="grid grid-cols-2 gap-1 rounded-full bg-white p-1 ring-1 ring-stone-200">
        {(["meal", "cafe"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => switchKind(k)}
            className={cn(
              "h-9 rounded-full text-sm font-semibold transition-colors",
              kind === k ? "bg-stone-900 text-white" : "text-stone-600",
            )}
          >
            {k === "meal" ? "맛집" : "카페"}
          </button>
        ))}
      </div>

      {status === "idle" && (
        <button
          type="button"
          onClick={locate}
          className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-[15px] font-semibold text-white"
        >
          <LocateFixed className="size-4" aria-hidden />
          내 위치 근처 {FOOD_KIND_LABELS[kind]} 찾기
        </button>
      )}

      {(status === "locating" || status === "loading") && (
        <div className="space-y-2" aria-busy>
          <p className="text-[13px] text-stone-500">블로그 후기·맘카페 이야기를 모아 고르는 중이에요… (처음엔 10초쯤 걸려요)</p>
          <ul className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="h-[88px] animate-pulse rounded-2xl bg-white/70 ring-1 ring-stone-200" />
            ))}
          </ul>
        </div>
      )}

      {status === "error" && (
        <div role="alert" className="space-y-3 rounded-2xl bg-white px-4 py-4 text-sm text-stone-700 ring-1 ring-stone-200">
          <p>{error}</p>
          <div className="flex flex-wrap gap-2">
            {base && (
              <button
                type="button"
                onClick={() => load(base, kind)}
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
            {where ? <b className="font-semibold text-stone-800">{where}</b> : "이 근처"}에서 후기가 많고 요즘도 인기 있는{" "}
            {FOOD_KIND_LABELS[kind]}
            {picks.length > 0 ? ` ${picks.length}곳` : ""}이에요.
          </p>
          {picks.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-stone-600 ring-1 ring-stone-200">
              추천할 만한 곳을 찾지 못했어요.
            </p>
          ) : (
            <ol className="divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
              {picks.map((p, i) => (
                <li key={`${p.name}-${i}`} className="flex gap-3 px-4 py-3.5">
                  <span className="w-5 shrink-0 pt-0.5 text-center text-[15px] font-bold text-teal-700">{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <a href={p.link} target="_blank" rel="noopener noreferrer" className="block">
                      <p className="truncate text-[15px] font-semibold text-stone-900">{p.name}</p>
                      <p className="truncate text-[12.5px] text-stone-500">
                        {[p.category, p.distance != null ? `${eventId ? "행사장" : "내 위치"}에서 ${formatDistance(p.distance)}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </a>
                    <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-stone-700">
                      {p.rating != null && (
                        <span className="inline-flex items-center gap-0.5 font-semibold text-amber-700">
                          <Star className="size-3.5 fill-current" aria-hidden />
                          {p.rating.toFixed(1)}
                          {p.ratingCount != null && <span className="font-normal text-stone-500">({formatCount(p.ratingCount)})</span>}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <MessageSquareText className="size-3.5 text-orange-600" aria-hidden />
                        블로그 후기 {formatCount(p.blogCount)}
                        {p.blogMore ? "+" : ""}
                        {p.recentCount > 0 && <span className="text-stone-500">(최근 1년 {formatCount(p.recentCount)})</span>}
                      </span>
                      {p.cafeCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3.5 text-violet-600" aria-hidden />
                          맘카페 언급 {formatCount(p.cafeCount)}
                        </span>
                      )}
                    </p>
                    {(p.familyCount >= 2 || p.hotCount >= 3) && (
                      <p className="flex flex-wrap gap-1.5">
                        {p.familyCount >= 2 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11.5px] font-semibold text-teal-800">
                            <Baby className="size-3" aria-hidden />
                            아이랑 가기 좋아요
                          </span>
                        )}
                        {p.hotCount >= 3 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11.5px] font-semibold text-rose-700">
                            <Flame className="size-3" aria-hidden />
                            웨이팅 인기
                          </span>
                        )}
                      </p>
                    )}
                    <p className="flex gap-3 pt-0.5 text-[12px] font-medium">
                      <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-stone-700 underline-offset-2 hover:underline">
                        카카오맵 별점·리뷰
                      </a>
                      <a href={p.naverLink} target="_blank" rel="noopener noreferrer" className="text-[#03a94d] underline-offset-2 hover:underline">
                        네이버 후기 보기
                      </a>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="text-[11.5px] leading-5 text-stone-400">
            근처 {formatDistance(1500)} 안에서 가게 이름이 실제로 나온 블로그 후기(대부분 네이버 블로그)·최근 1년 후기·맘카페 이야기
            {rated ? "·구글 지도 별점" : ""}을 함께 보고 골랐어요. &lsquo;아이랑 가기 좋아요&rsquo;는 후기에 아기의자·키즈존 같은 말이 여러 번 나온 곳이에요.
          </p>
        </>
      )}
    </div>
  );
}
