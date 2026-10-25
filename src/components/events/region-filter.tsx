"use client";

import { MapPin } from "lucide-react";

import {
  REGION_OPTIONS,
  getSubregionOptions,
  getSubregionSectionLabel,
} from "@/data/regions";
import { subregionKey } from "@/lib/events";
import { cn } from "@/lib/utils";
import type { RegionCode } from "@/types/event";

interface RegionFilterProps {
  /** 고른 시·도 (비면 전국) */
  regions: RegionCode[];
  /** 고른 구·시 ("경기도:의정부시") */
  subregions: string[];
  onChange: (next: { regions: RegionCode[]; subregions: string[] }) => void;
  className?: string;
}

/**
 * 지역 여러 개 고르기: 시·도를 여러 개 누를 수 있고, 고른 시·도마다 구·시를 여러 개 고를 수 있다.
 * 구·시를 하나도 안 고른 시·도는 시·도 전체.
 */
export function RegionFilter({ regions, subregions, onChange, className }: RegionFilterProps) {
  const toggleRegion = (value: RegionCode | "all") => {
    if (value === "all") {
      onChange({ regions: [], subregions: [] });
      return;
    }
    if (regions.includes(value)) {
      onChange({
        regions: regions.filter((r) => r !== value),
        // 시·도를 빼면 그 안에서 고른 구·시도 함께 뺀다
        subregions: subregions.filter((s) => !s.startsWith(`${value}:`)),
      });
    } else {
      onChange({ regions: [...regions, value], subregions });
    }
  };

  const toggleSub = (region: RegionCode, sub: string) => {
    const key = subregionKey(region, sub);
    onChange({
      regions,
      subregions: subregions.includes(key)
        ? subregions.filter((s) => s !== key)
        : [...subregions, key],
    });
  };

  return (
    <section
      className={cn(
        "space-y-3 rounded-2xl bg-white/80 p-4 ring-1 ring-stone-200/80 backdrop-blur",
        className,
      )}
      aria-label="지역 필터"
    >
      <div className="flex items-center justify-between gap-1.5 text-sm font-medium text-stone-800">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-4 text-teal-700" />
          지역
        </span>
        <span className="text-xs font-normal text-stone-500">여러 곳을 고를 수 있어요</span>
      </div>

      <div role="group" aria-label="시·도" className="flex flex-wrap gap-2">
        {REGION_OPTIONS.map((option) => {
          const selected =
            option.value === "all" ? regions.length === 0 : regions.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleRegion(option.value)}
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

      {regions.map((region) => {
        const options = getSubregionOptions(region).filter((o) => o.value !== "all");
        if (options.length === 0) return null;
        const chosen = subregions.filter((s) => s.startsWith(`${region}:`));
        const short = REGION_OPTIONS.find((o) => o.value === region)?.label ?? region;
        return (
          <div key={region} className="space-y-2 border-t border-stone-100 pt-3">
            <p className="text-xs font-medium text-stone-500">
              {short} {getSubregionSectionLabel(region)}
              <span className="ml-1 font-normal text-stone-400">
                {chosen.length === 0 ? "· 전체" : `· ${chosen.length}곳`}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {options.map((option) => {
                const selected = chosen.includes(subregionKey(region, option.value));
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleSub(region, option.value)}
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
        );
      })}
    </section>
  );
}
