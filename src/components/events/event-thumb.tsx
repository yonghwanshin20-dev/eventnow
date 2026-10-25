"use client";

import Image from "next/image";
import { useState } from "react";
import { Baby, Palette, PartyPopper, Store } from "lucide-react";

import { isHttpUrl, shouldOptimizeImage } from "@/lib/images";
import { cn } from "@/lib/utils";
import type { EventCategory } from "@/types/event";

/** 사진이 없을 때의 대체 타일 — 비어 보이지 않게 카테고리별 그라데이션 + 아이콘 */
const TILE: Record<EventCategory, { className: string; icon: typeof Palette; label: string }> = {
  festival: {
    className: "bg-gradient-to-br from-teal-100 via-emerald-50 to-amber-100 text-teal-700",
    icon: PartyPopper,
    label: "축제",
  },
  exhibition: {
    className: "bg-gradient-to-br from-violet-100 via-fuchsia-50 to-sky-100 text-violet-700",
    icon: Palette,
    label: "전시",
  },
  popup: {
    className: "bg-gradient-to-br from-amber-100 via-orange-50 to-rose-100 text-amber-700",
    icon: Store,
    label: "팝업",
  },
  kids_experience: {
    className: "bg-gradient-to-br from-sky-100 via-cyan-50 to-lime-100 text-sky-700",
    icon: Baby,
    label: "키즈 체험",
  },
};

interface EventThumbProps {
  src: string | null;
  category: EventCategory;
  sizes: string;
  className?: string;
  /** 이미지가 없을 때 className 대신 쓸 크기 (예: 상세의 얇은 띠) */
  fallbackClassName?: string;
  priority?: boolean;
  /** contain: 글자가 많은 포스터를 자르지 않고 전체를 보여준다 */
  fit?: "cover" | "contain";
  /** 대체 타일에 카테고리 이름도 쓸지 (큰 카드용) */
  showLabel?: boolean;
  /** cover일 때 기준점 — 포스터는 제목이 위에 있어 top */
  align?: "center" | "top";
}

/** 이미지가 없거나 깨지면 카테고리 색 타일로 대신 보여준다 */
export function EventThumb({
  src,
  category,
  sizes,
  className,
  fallbackClassName,
  priority,
  fit = "cover",
  showLabel = false,
  align = "center",
}: EventThumbProps) {
  const [failed, setFailed] = useState(false);
  const tile = TILE[category];

  if (!isHttpUrl(src) || failed) {
    const Icon = tile.icon;
    return (
      <div
        aria-hidden
        className={cn(
          "flex flex-col items-center justify-center gap-1.5",
          tile.className,
          fallbackClassName ?? className,
        )}
      >
        <Icon className={cn("opacity-80", showLabel ? "size-10" : "size-7")} strokeWidth={1.5} />
        {showLabel && <span className="text-xs font-semibold opacity-70">{tile.label}</span>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        fit === "contain" ? "bg-stone-800" : "bg-stone-100",
        className,
      )}
    >
      {fit === "contain" && (
        // 포스터 여백을 같은 그림을 흐리게 깔아 채운다
        <Image
          src={src}
          alt=""
          fill
          sizes="64px"
          aria-hidden
          className="scale-110 object-cover opacity-50 blur-xl"
          unoptimized={!shouldOptimizeImage(src)}
        />
      )}
      <Image
        src={src}
        alt=""
        fill
        sizes={sizes}
        preload={priority}
        className={cn(
          fit === "contain" ? "object-contain" : "object-cover",
          fit === "cover" && align === "top" && "object-top",
        )}
        unoptimized={!shouldOptimizeImage(src)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
