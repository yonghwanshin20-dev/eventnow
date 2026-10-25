"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { EventQuickView } from "@/components/events/event-quick-view";
import { QuickViewContext, type QuickViewApi } from "@/components/events/quick-view-context";
import type { EventListItem } from "@/types/event";

const HASH = "#quick";

/**
 * 홈 밖(지역 페이지·상세 페이지 아래 선반)에서도 카드를 누르면 빠른 보기가 열리게 한다.
 * 열 때 기록을 하나 쌓아 휴대폰 뒤로가기로 닫힌다.
 */
export function QuickViewHost({ items, children }: { items: EventListItem[]; children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [siblings, setSiblings] = useState<string[]>([]);
  const byId = useMemo(() => new Map(items.map((e) => [e.id, e])), [items]);

  useEffect(() => {
    const onPop = () => {
      if (window.location.hash !== HASH) setOpenId(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const api = useMemo<QuickViewApi>(
    () => ({
      open: (id, list) => {
        setSiblings(list);
        setOpenId(id);
        if (window.location.hash !== HASH) {
          window.history.pushState(null, "", `${window.location.pathname}${window.location.search}${HASH}`);
        }
      },
    }),
    [],
  );

  const close = useCallback(() => {
    if (window.location.hash === HASH) window.history.back();
    else setOpenId(null);
  }, []);

  return (
    <QuickViewContext.Provider value={api}>
      {children}
      <EventQuickView
        event={openId ? (byId.get(openId) ?? null) : null}
        siblings={siblings}
        onClose={close}
        onNavigate={setOpenId}
      />
    </QuickViewContext.Provider>
  );
}
