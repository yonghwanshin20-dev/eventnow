"use client";

import {
  Baby,
  Car,
  Church,
  FerrisWheel,
  Footprints,
  Home,
  Landmark,
  Leaf,
  Milk,
  Shrub,
  Sun,
  Tent,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  AGE_GROUP_OPTIONS,
  PLACE_TYPE_OPTIONS,
  type ExplorerFilters,
  type FamilyTagFilter,
} from "@/lib/events";
import type { EventAmenities, PlaceType, TargetAgeGroup } from "@/types/event";

interface FamilyFilterProps {
  filters: ExplorerFilters;
  onChange: (next: ExplorerFilters) => void;
  className?: string;
}

const FAMILY_TAG_OPTIONS: {
  value: Exclude<FamilyTagFilter, null>;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "experience", label: "체험/교육형", icon: Tent },
  { value: "indoor", label: "실내 공간", icon: Home },
  { value: "outdoor", label: "야외 축제", icon: Sun },
];

const PLACE_ICONS: Record<PlaceType, typeof Sun> = {
  amusement_park: FerrisWheel,
  park_playground: Tent,
  forest_recreation: Shrub,
  cultural_center: Users,
  temple: Church,
  historical: Landmark,
  nature_science: Leaf,
};

const AMENITY_FILTERS: {
  key: keyof EventAmenities;
  label: string;
  icon: typeof Car;
}[] = [
  { key: "parking", label: "주차", icon: Car },
  { key: "stroller", label: "유모차", icon: Baby },
  { key: "nursing_room", label: "수유실", icon: Milk },
];

export function FamilyFilter({
  filters,
  onChange,
  className,
}: FamilyFilterProps) {
  const toggleAmenity = (key: keyof EventAmenities) => {
    const next = { ...filters.amenities };
    if (next[key]) {
      delete next[key];
    } else {
      next[key] = true;
    }
    onChange({ ...filters, amenities: next });
  };

  const setAge = (value: TargetAgeGroup | "all") => {
    onChange({ ...filters, targetAgeGroup: value });
  };

  const setFamilyTag = (value: FamilyTagFilter) => {
    onChange({
      ...filters,
      familyTag: filters.familyTag === value ? null : value,
    });
  };

  const togglePlaceType = (value: PlaceType) => {
    const has = filters.placeTypes.includes(value);
    onChange({
      ...filters,
      placeTypes: has
        ? filters.placeTypes.filter((t) => t !== value)
        : [...filters.placeTypes, value],
    });
  };

  return (
    <section
      className={cn(
        "space-y-3 rounded-2xl bg-white/80 p-3 ring-1 ring-stone-200/80 backdrop-blur sm:space-y-4 sm:p-4",
        className,
      )}
      aria-label="가족·장소 필터"
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={filters.familyFriendlyOnly}
          onClick={() =>
            onChange({
              ...filters,
              familyFriendlyOnly: !filters.familyFriendlyOnly,
            })
          }
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
            filters.familyFriendlyOnly
              ? "bg-teal-700 text-white"
              : "bg-stone-100 text-stone-700 hover:bg-stone-200",
          )}
        >
          <Users className="size-4" />
          아이 동반 추천
        </button>

        {FAMILY_TAG_OPTIONS.map(({ value, label, icon: Icon }) => {
          const selected = filters.familyTag === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={selected}
              onClick={() => setFamilyTag(value)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                selected
                  ? "bg-teal-700 text-white"
                  : "bg-stone-100 text-stone-700 hover:bg-stone-200",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
      </div>

      <div className="space-y-2">
        <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-stone-500 uppercase">
          <Footprints className="size-3.5" />
          놀이·공원·숲 장소
        </p>
        <div className="flex flex-wrap gap-2">
          {PLACE_TYPE_OPTIONS.map((option) => {
            const selected = filters.placeTypes.includes(option.value);
            const Icon = PLACE_ICONS[option.value];
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                title={option.description}
                onClick={() => togglePlaceType(option.value)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
                  selected
                    ? "bg-teal-700 text-white"
                    : "bg-stone-100 text-stone-700 hover:bg-stone-200",
                )}
              >
                <Icon className="size-4" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
          연령대
        </p>
        <div className="flex flex-wrap gap-2">
          {AGE_GROUP_OPTIONS.map((option) => {
            const selected = filters.targetAgeGroup === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setAge(option.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm transition-colors",
                  selected
                    ? "bg-teal-700 text-white ring-1 ring-teal-700"
                    : "text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-stone-500 uppercase">
          편의시설
        </p>
        <div className="flex flex-wrap gap-2">
          {AMENITY_FILTERS.map(({ key, label, icon: Icon }) => {
            const selected = Boolean(filters.amenities[key]);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleAmenity(key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                  selected
                    ? "bg-teal-700 text-white ring-1 ring-teal-700"
                    : "text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
