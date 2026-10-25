"use client";

import { useCallback, useEffect, useState } from "react";
import { Baby, ExternalLink, LocateFixed, MapPin } from "lucide-react";

import {
  FOOD_KIND_LABELS,
  formatDistance,
  kakaoSearchUrl,
  naverSearchUrl,
  nearbyQuery,
  walkMinutes,
  type FoodKind,
  type FoodPlace,
} from "@/lib/food";
import { cn } from "@/lib/utils";

interface Base {
  lat: number;
  lng: number;
  name?: string | null;
  area?: string | null;
  eventId?: string;
  eventTitle?: string;
}

interface NearbyFoodProps {
  /** 행사장 좌표 (없으면 내 위치로) */
  base: Base | null;
  /** 좌표 없는 행사일 때 지도 앱 검색어 */
  fallbackQuery: string | null;
}

type Status = "idle" | "locating" | "loading" | "ready" | "error";

const FILTERS: { value: FoodKind | "all"; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "meal", label: FOOD_KIND_LABELS.meal },
  { value: "cafe", label: FOOD_KIND_LABELS.cafe },
  { value: "dessert", label: FOOD_KIND_LABELS.dessert },
];

type FoodResult = { places: FoodPlace[] } | { error: string };

async function fetchFood(at: { lat: number; lng: number }): Promise<FoodResult> {
  try {
    const res = await fetch(`/api/food?lat=${at.lat}&lng=${at.lng}`);
    const data = (await res.json()) as { places?: FoodPlace[]; error?: string };
    if (res.ok && data.places) return { places: data.places };
    return { error: data.error ?? "맛집 목록을 불러오지 못했어요." };
  } catch {
    return { error: "맛집 목록을 불러오지 못했어요." };
  }
}

export function NearbyFood({ base: initialBase, fallbackQuery }: NearbyFoodProps) {
  const [base, setBase] = useState<Base | null>(initialBase);
  const [status, setStatus] = useState<Status>(initialBase ? "loading" : "idle");
  const [places, setPlaces] = useState<FoodPlace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FoodKind | "all">("all");
  const [kidsOnly, setKidsOnly] = useState(false);

  const apply = useCallback((result: FoodResult) => {
    if ("places" in result) {
      setPlaces(result.places);
      setError(null);
      setStatus("ready");
    } else {
      setError(result.error);
      setStatus("error");
    }
  }, []);
  const load = (at: Base) => void fetchFood(at).then(apply);

  useEffect(() => {
    if (!initialBase) return;
    let alive = true;
    void fetchFood(initialBase).then((result) => alive && apply(result));
    return () => {
      alive = false;
    };
  }, [initialBase, apply]);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      setError("이 기기에서는 위치를 쓸 수 없어요.");
      setStatus("error");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = { lat: pos.coords.latitude, lng: pos.coords.longitude, name: "내 위치" };
        setBase(at);
        setStatus("loading");
        load(at);
      },
      () => {
        setError("위치 권한을 허용하면 근처 맛집을 찾아드려요.");
        setStatus("error");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  };

  const query = base
    ? nearbyQuery({ name: base.name === "내 위치" ? null : base.name, area: base.area })
    : nearbyQuery({ name: fallbackQuery });
  const near = base ? { lat: base.lat, lng: base.lng } : undefined;
  const shown = places.filter((p) => (filter === "all" || p.kind === filter) && (!kidsOnly || p.kids));
  const kidsCount = places.filter((p) => p.kids).length;

  return (
    <div className="space-y-4">
      {/* 지도 앱 바로가기 — 평점·리뷰·예약은 여기서 */}
      <div className="grid grid-cols-2 gap-2">
        <a
          href={base?.name === "내 위치" ? naverSearchUrl("맛집", near) : naverSearchUrl(query, near)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#03c75a] text-sm font-semibold text-white"
        >
          네이버 지도에서 보기
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <a
          href={kakaoSearchUrl(query)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#fee500] text-sm font-semibold text-stone-900"
        >
          카카오맵에서 보기
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      <p className="-mt-2 text-[12px] leading-5 text-stone-500">평점·리뷰·예약은 지도 앱에서 확인하세요.</p>

      {(status === "idle" || (status === "error" && !base)) && (
        <button
          type="button"
          onClick={locate}
          className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-[15px] font-semibold text-white"
        >
          <LocateFixed className="size-4" aria-hidden />
          내 위치 근처 맛집 찾기
        </button>
      )}
      {base && status !== "idle" && (
        <div className="flex items-center justify-between gap-2 text-[13px] text-stone-600">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="size-3.5 shrink-0 text-teal-700" aria-hidden />
            <span className="truncate">
              <b className="font-semibold text-stone-800">{base.name}</b> 기준 · 걸어서 10분 안쪽
            </span>
          </span>
          {base.name !== "내 위치" && (
            <button type="button" onClick={locate} className="shrink-0 font-medium text-teal-800">
              내 위치로
            </button>
          )}
        </div>
      )}

      {(status === "locating" || status === "loading") && (
        <ul className="space-y-2" aria-busy>
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="h-[68px] animate-pulse rounded-2xl bg-white/70 ring-1 ring-stone-200" />
          ))}
        </ul>
      )}
      {status === "error" && error && (
        <p role="alert" className="rounded-2xl bg-white px-4 py-3 text-sm text-stone-700 ring-1 ring-stone-200">
          {error} 위의 지도 앱 바로가기로도 찾아볼 수 있어요.
          {base && (
            <button
              type="button"
              onClick={() => {
                setStatus("loading");
                load(base);
              }}
              className="ml-1 font-semibold text-teal-800 underline underline-offset-2"
            >
              다시 시도
            </button>
          )}
        </p>
      )}

      {status === "ready" && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "h-9 rounded-full px-3.5 text-[13.5px] font-medium",
                  filter === f.value ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200",
                )}
              >
                {f.label}
              </button>
            ))}
            {kidsCount > 0 && (
              <button
                type="button"
                aria-pressed={kidsOnly}
                onClick={() => setKidsOnly((v) => !v)}
                className={cn(
                  "inline-flex h-9 items-center gap-1 rounded-full px-3.5 text-[13.5px] font-medium",
                  kidsOnly ? "bg-teal-700 text-white" : "bg-white text-teal-800 ring-1 ring-teal-200",
                )}
              >
                <Baby className="size-3.5" aria-hidden />
                아이 편의 ({kidsCount})
              </button>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-stone-600 ring-1 ring-stone-200">
              등록된 가게가 아직 없어요. 지도 앱 바로가기로 찾아보세요.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
              {shown.map((p) => (
                <li key={p.id}>
                  <a
                    href={naverSearchUrl([base?.area, p.name].filter(Boolean).join(" "), { lat: p.lat, lng: p.lng })}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3 active:bg-stone-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold text-stone-900">{p.name}</p>
                      <p className="mt-0.5 truncate text-[12.5px] text-stone-500">
                        {[p.cuisine ?? FOOD_KIND_LABELS[p.kind], p.kids ? "아이 편의시설" : null, p.address]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[13.5px] font-semibold text-teal-800">{formatDistance(p.distance)}</p>
                      <p className="text-[11.5px] text-stone-500">도보 {walkMinutes(p.distance)}분</p>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11.5px] leading-5 text-stone-400">
            가게 정보: © OpenStreetMap 기여자 · 문을 닫았거나 빠진 곳이 있을 수 있어요.
          </p>
        </>
      )}
    </div>
  );
}
