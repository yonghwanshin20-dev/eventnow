"use client";

import "leaflet/dist/leaflet.css";

import Link from "next/link";
import { useMemo } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

import { CATEGORY_LABELS, formatDateRange } from "@/lib/events";
import type { EventCategory, EventMapPoint } from "@/types/event";

const CATEGORY_COLOR: Record<EventCategory, string> = {
  festival: "#0f766e",
  exhibition: "#57534e",
  popup: "#b45309",
  kids_experience: "#0369a1",
  parents: "#be123c",
};

const KOREA_CENTER: [number, number] = [36.4, 127.8];

interface EventMapProps {
  points: EventMapPoint[];
  near: { lat: number; lng: number } | null;
  /** 마커를 누르면 (빠른 보기 열기). 없으면 팝업으로 제목·링크만 */
  onSelect?: (id: string) => void;
}

/** OSM 타일 + CircleMarker (마커 이미지 번들 문제 없이 동작) */
export default function EventMap({ points, near, onSelect }: EventMapProps) {
  const bounds = useMemo(() => {
    if (points.length === 0) return null;
    const lats = points.map((p) => p.latitude);
    const lngs = points.map((p) => p.longitude);
    return [
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ] as [[number, number], [number, number]];
  }, [points]);

  return (
    // isolate + z-0: Leaflet 안쪽 층(z-index 400~1000)이 이 상자 밖으로 새지 않게 —
    // 그래야 빠른 보기 시트·위쪽 필터 줄이 지도 위로 올라온다
    <div className="relative isolate z-0 h-full min-h-80 overflow-hidden rounded-2xl ring-1 ring-stone-200">
      <MapContainer
        key={`${points.length}-${bounds?.flat().join(",") ?? "none"}`}
        center={near ? [near.lat, near.lng] : KOREA_CENTER}
        zoom={near ? 11 : 7}
        bounds={!near && bounds ? bounds : undefined}
        boundsOptions={{ padding: [24, 24], maxZoom: 13 }}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {near && (
          <CircleMarker
            center={[near.lat, near.lng]}
            radius={7}
            pathOptions={{ color: "#e11d48", fillColor: "#e11d48", fillOpacity: 0.9 }}
          >
            <Popup>내 위치</Popup>
          </CircleMarker>
        )}
        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.latitude, p.longitude]}
            radius={7}
            eventHandlers={onSelect ? { click: () => onSelect(p.id) } : undefined}
            pathOptions={{
              color: "#fff",
              weight: 1.5,
              fillColor: CATEGORY_COLOR[p.category],
              fillOpacity: 0.9,
            }}
          >
            {!onSelect && (
              <Popup>
                <div className="space-y-1">
                  <p className="text-xs text-stone-500">
                    {CATEGORY_LABELS[p.category]} · {formatDateRange(p.start_date, p.end_date)}
                  </p>
                  <Link href={`/events/${p.id}`} className="font-semibold text-teal-800">
                    {p.title}
                  </Link>
                </div>
              </Popup>
            )}
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
