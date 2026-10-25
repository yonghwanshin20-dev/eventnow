"use client";

import { Heart } from "lucide-react";

import { useFavorites } from "@/lib/favorites";
import { cn } from "@/lib/utils";

interface FavoriteButtonProps {
  eventId: string;
  title: string;
  className?: string;
  withLabel?: boolean;
}

export function FavoriteButton({
  eventId,
  title,
  className,
  withLabel = false,
}: FavoriteButtonProps) {
  const { has, toggle } = useFavorites();
  const active = has(eventId);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `${title} 찜 해제` : `${title} 찜하기`}
      onClick={() => toggle(eventId)}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-full transition-colors",
        withLabel
          ? "min-h-11 px-4 text-sm font-medium ring-1 ring-stone-200 hover:bg-stone-50"
          : // 보이는 원은 32px로 두고, 누르는 영역만 사방 6px 넓혀 44px로 (사진을 가리지 않게)
            "relative size-8 bg-white/90 shadow-sm ring-1 ring-stone-200 after:absolute after:-inset-1.5 after:rounded-full after:content-[''] hover:bg-white",
        active && "text-rose-600",
        !active && "text-stone-500",
        className,
      )}
    >
      <Heart className={cn("size-4", active && "fill-current")} />
      {withLabel ? (active ? "찜 해제" : "찜하기") : null}
    </button>
  );
}
