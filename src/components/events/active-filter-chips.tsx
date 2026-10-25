"use client";

import { X } from "lucide-react";

import { regionShortLabel } from "@/data/regions";
import {
  AGE_GROUP_LABELS,
  AMENITY_META,
  CATEGORY_LABELS,
  PLACE_TYPE_OPTIONS,
  SCHEDULE_TYPE_OPTIONS,
  WHEN_OPTIONS,
  type ExplorerFilters,
} from "@/lib/events";

const FAMILY_TAG_LABELS = { indoor: "실내 공간", outdoor: "야외 축제", experience: "체험/교육형" };

interface Chip {
  key: string;
  label: string;
  clear: Partial<ExplorerFilters>;
}

/** 지금 걸린 조건을 한 줄로 — 각각 ✕로 바로 뺄 수 있다 */
export function activeFilterChips(f: ExplorerFilters): Chip[] {
  const chips: Chip[] = [];
  if (f.q) chips.push({ key: "q", label: `‘${f.q}’`, clear: { q: "" } });
  if (f.favorites.length > 0) chips.push({ key: "fav", label: "찜한 행사", clear: { favorites: [] } });
  if (f.date) {
    chips.push({
      key: "date",
      label: `${Number(f.date.slice(5, 7))}.${Number(f.date.slice(8, 10))} 열리는`,
      clear: { date: null },
    });
  } else if (f.when) {
    const label = WHEN_OPTIONS.find((o) => o.value === f.when)?.label ?? f.when;
    chips.push({ key: "when", label, clear: { when: null } });
  }
  if (f.scheduleType !== "all") {
    const label = SCHEDULE_TYPE_OPTIONS.find((o) => o.value === f.scheduleType)?.label ?? "";
    chips.push({ key: "schedule", label, clear: { scheduleType: "all" } });
  }
  if (f.category !== "all") {
    chips.push({ key: "category", label: CATEGORY_LABELS[f.category], clear: { category: "all" } });
  }
  if (f.region !== "all") {
    chips.push({
      key: "region",
      label: regionShortLabel(f.region),
      clear: { region: "all", subregion: "all" },
    });
  }
  if (f.subregion !== "all") {
    chips.push({ key: "sub", label: f.subregion, clear: { subregion: "all" } });
  }
  if (f.familyFriendlyOnly) {
    chips.push({ key: "family", label: "아이 동반", clear: { familyFriendlyOnly: false } });
  }
  if (f.targetAgeGroup !== "all") {
    chips.push({ key: "age", label: AGE_GROUP_LABELS[f.targetAgeGroup], clear: { targetAgeGroup: "all" } });
  }
  if (f.familyTag) {
    chips.push({ key: "ftag", label: FAMILY_TAG_LABELS[f.familyTag], clear: { familyTag: null } });
  }
  for (const t of f.placeTypes) {
    const label = PLACE_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
    chips.push({ key: `place-${t}`, label, clear: { placeTypes: f.placeTypes.filter((v) => v !== t) } });
  }
  for (const { key, label } of AMENITY_META) {
    if (f.amenities[key]) {
      const rest = { ...f.amenities };
      delete rest[key];
      chips.push({ key: `amenity-${key}`, label, clear: { amenities: rest } });
    }
  }
  if (f.includeEnded) chips.push({ key: "ended", label: "종료 포함", clear: { includeEnded: false } });
  return chips;
}

interface ActiveFilterChipsProps {
  filters: ExplorerFilters;
  onClear: (patch: Partial<ExplorerFilters>) => void;
  onReset: () => void;
  /** 화면 위쪽에서 이미 선택 상태로 보이는 조건 (같은 걸 두 번 보여주지 않게) */
  hidden?: ReadonlySet<string>;
}

export function ActiveFilterChips({ filters, onClear, onReset, hidden }: ActiveFilterChipsProps) {
  const all = activeFilterChips(filters);
  const chips = hidden ? all.filter((c) => !hidden.has(c.key)) : all;
  if (chips.length === 0) return null;
  return (
    <div
      role="group"
      aria-label="적용된 조건"
      className="-mx-3 flex items-center gap-1.5 overflow-x-auto px-3 [-ms-overflow-style:none] [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onClear(chip.clear)}
          aria-label={`${chip.label} 조건 빼기`}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-teal-50 pr-2 pl-3 text-[13px] font-medium text-teal-900 ring-1 ring-teal-100 active:bg-teal-100"
        >
          {chip.label}
          <X className="size-3.5 text-teal-700" aria-hidden />
        </button>
      ))}
      <button
        type="button"
        onClick={onReset}
        className="h-8 shrink-0 px-2 text-[13px] text-stone-500 underline-offset-2 hover:underline"
      >
        전체 초기화
      </button>
    </div>
  );
}
