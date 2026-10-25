"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { CATEGORY_OPTIONS } from "@/lib/events";
import type { EventCategory } from "@/types/event";

interface CategoryFilterBarProps {
  value: EventCategory | "all";
  onChange: (value: EventCategory | "all") => void;
  /** 카테고리별 건수 ('all' 포함). 주면 칩 옆에 숫자를 붙이고 0건 칩은 흐리게 한다 */
  counts?: Record<string, number>;
  /** 맨 앞에 붙일 것 (모바일의 [필터] 버튼) — 줄을 하나 아끼려고 같은 가로줄에 둔다 */
  leading?: ReactNode;
  className?: string;
}

export function CategoryFilterBar({
  value,
  onChange,
  counts,
  leading,
  className,
}: CategoryFilterBarProps) {
  return (
    <div
      role="group"
      aria-label="카테고리 필터"
      className={cn(
        "flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {leading}
      {CATEGORY_OPTIONS.map((option) => {
        const selected = value === option.value;
        const count = counts ? (counts[option.value] ?? 0) : null;
        // 선택된 칩은 0건이어도 눌러서 해제할 수 있어야 하므로 흐리게만 하고 막지 않는다
        const empty = count === 0 && !selected;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            aria-label={count == null ? undefined : `${option.label} ${count}건`}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-full px-4 py-2 text-sm font-medium transition-colors",
              selected
                ? "bg-teal-700 text-white shadow-sm"
                : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50 hover:text-stone-900",
              empty && "opacity-45",
            )}
          >
            {option.label}
            {count != null && (
              <span
                aria-hidden
                className={cn(
                  "text-[11px] tabular-nums",
                  selected ? "text-white/75" : "text-stone-400",
                )}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
