import {
  Baby,
  Car,
  Milk,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { EventAmenities } from "@/types/event";
import { AMENITY_META } from "@/lib/events";

const ICONS = {
  parking: Car,
  stroller: Baby,
  nursing_room: Milk,
} as const;

interface AmenityIconsProps {
  amenities: EventAmenities;
  /** true면 사용 가능한 항목만 표시 */
  onlyAvailable?: boolean;
  size?: "sm" | "md";
  className?: string;
  showLabel?: boolean;
}

export function AmenityIcons({
  amenities,
  onlyAvailable = true,
  size = "sm",
  className,
  showLabel = false,
}: AmenityIconsProps) {
  const items = AMENITY_META.filter((item) =>
    onlyAvailable ? amenities[item.key] : true,
  );

  if (items.length === 0) return null;

  const iconSize = size === "sm" ? "size-3.5" : "size-4";

  return (
    <ul className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {items.map(({ key, label }) => {
        const Icon = ICONS[key];
        const available = amenities[key];
        return (
          <li
            key={key}
            title={label}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
              available
                ? "border-teal-200 bg-teal-50 text-teal-800"
                : "border-border bg-muted/40 text-muted-foreground opacity-50",
            )}
          >
            <Icon className={iconSize} aria-hidden />
            {showLabel ? <span>{label}</span> : <span className="sr-only">{label}</span>}
          </li>
        );
      })}
    </ul>
  );
}
