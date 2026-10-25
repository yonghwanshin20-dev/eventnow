"use client";

import Link from "next/link";
import { CalendarDays, CalendarHeart, Heart, House, Map as MapIcon, MessageSquareText } from "lucide-react";

import { cn } from "@/lib/utils";

interface BottomTabBarProps {
  isHome: boolean;
  weekend: boolean;
  calendar: boolean;
  map: boolean;
  favoritesOnly: boolean;
  favoriteCount: number;
  onHome: () => void;
  onWeekend: () => void;
  onCalendar: () => void;
  onMap: () => void;
  onFavorites: () => void;
}

/** 모바일·태블릿 하단 탭 — 자주 쓰는 동작을 엄지 닿는 곳에 */
export function BottomTabBar(props: BottomTabBarProps) {
  const tabs = [
    { key: "home", label: "홈", icon: House, active: props.isHome, onClick: props.onHome },
    {
      key: "weekend",
      label: "이번 주말",
      icon: CalendarHeart,
      active: props.weekend,
      onClick: props.onWeekend,
    },
    {
      key: "calendar",
      label: "달력",
      icon: CalendarDays,
      active: props.calendar,
      onClick: props.onCalendar,
    },
    { key: "map", label: "지도", icon: MapIcon, active: props.map, onClick: props.onMap },
    {
      key: "fav",
      label: "찜",
      icon: Heart,
      active: props.favoritesOnly,
      onClick: props.onFavorites,
      badge: props.favoriteCount,
    },
  ];

  return (
    <nav
      aria-label="주요 메뉴"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-6">
        {tabs.map(({ key, label, icon: Icon, active, onClick, badge }) => (
          <li key={key}>
            <button
              type="button"
              aria-pressed={active}
              onClick={onClick}
              className={cn(
                "relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium",
                active ? "text-teal-800" : "text-stone-500",
              )}
            >
              <Icon
                className={cn("size-[22px]", active && key === "fav" && "fill-current")}
                strokeWidth={active ? 2.25 : 1.75}
                aria-hidden
              />
              {label}
              {badge ? (
                <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 rounded-full bg-rose-600 px-1 text-[10px] leading-4 font-bold text-white">
                  {badge}
                </span>
              ) : null}
            </button>
          </li>
        ))}
        <li>
          <Link
            href="/feedback"
            className="flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-stone-500"
          >
            <MessageSquareText className="size-[22px]" strokeWidth={1.75} aria-hidden />
            피드백
          </Link>
        </li>
      </ul>
    </nav>
  );
}
