"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "eventnow:favorites";
const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let cached: { raw: string | null; ids: string[] } = { raw: null, ids: EMPTY };

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return cached.ids;
  }
  if (raw === cached.raw) return cached.ids;
  let ids: string[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((v): v is string => typeof v === "string");
  } catch {
    ids = EMPTY;
  }
  cached = { raw, ids };
  return ids;
}

function write(ids: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // 저장 불가(사파리 프라이빗 등) — 이번 세션 메모리에만 유지
    cached = { raw: JSON.stringify(ids), ids };
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const noopSubscribe = () => () => {};

/** 브라우저별 찜 목록 (localStorage) */
export function useFavorites() {
  const ids = useSyncExternalStore(subscribe, read, () => EMPTY);
  // 서버 렌더·하이드레이션 중에는 false — 그때의 빈 목록을 '찜 없음'으로 오해하지 않게
  const ready = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const toggle = useCallback((id: string) => {
    const current = read();
    write(current.includes(id) ? current.filter((v) => v !== id) : [...current, id]);
  }, []);

  /** 여러 개를 한 번에 찜 (친구가 보낸 목록·코스 담기) — 이미 있는 것은 그대로 */
  const addMany = useCallback((more: string[]) => {
    const current = read();
    const next = [...current, ...more.filter((id) => !current.includes(id))];
    if (next.length !== current.length) write(next);
  }, []);

  return { ids, ready, has: (id: string) => ids.includes(id), toggle, addMany };
}
