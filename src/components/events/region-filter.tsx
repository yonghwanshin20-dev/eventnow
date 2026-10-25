"use client";

import { MapPin } from "lucide-react";

import {
  REGION_OPTIONS,
  getSubregionOptions,
  getSubregionSectionLabel,
} from "@/data/regions";
import { cn } from "@/lib/utils";
import type { RegionCode } from "@/types/event";

interface RegionFilterProps {
  region: RegionCode | "all";
  subregion: string | "all";
  onRegionChange: (region: RegionCode | "all") => void;
  onSubregionChange: (subregion: string | "all") => void;
  className?: string;
}

export function RegionFilter({
  region,
  subregion,
  onRegionChange,
  onSubregionChange,
  className,
}: RegionFilterProps) {
  const subOptions =
    region === "all" ? [] : getSubregionOptions(region);

  return (
    <section
      className={cn(
        "space-y-3 rounded-2xl bg-white/80 p-4 ring-1 ring-stone-200/80 backdrop-blur",
        className,
      )}
      aria-label="지역 필터"
    >
      <div className="flex items-center gap-1.5 text-sm font-medium text-stone-800">
        <MapPin className="size-4 text-teal-700" />
        지역
      </div>

      <div
        role="group"
        aria-label="시·도"
        className="flex flex-wrap gap-2"
      >
        {REGION_OPTIONS.map((option) => {
          const selected = region === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onRegionChange(option.value)}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                selected
                  ? "bg-teal-700 text-white"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {subOptions.length > 0 && region !== "all" && (
        <div className="space-y-2 border-t border-stone-100 pt-3">
          <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
            {getSubregionSectionLabel(region)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {subOptions.map((option) => {
              const selected = subregion === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSubregionChange(option.value)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                    selected
                      ? "bg-teal-700 text-white"
                      : "bg-stone-50 text-stone-600 ring-1 ring-stone-200 hover:bg-stone-100",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
