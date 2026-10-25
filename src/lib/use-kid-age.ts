"use client";

import { useCallback, useSyncExternalStore } from "react";

import { KID_AGE_COOKIE, parseKidAge, type KidAge } from "@/lib/kid-age";

const listeners = new Set<() => void>();

function read(): KidAge | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${KID_AGE_COOKIE}=([^;]*)`));
  return parseKidAge(m ? decodeURIComponent(m[1]) : null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 우리 아이 나이 (쿠키). 바꾸면 onChange로 화면을 새로 받아 서버 정렬에 반영한다.
 * 서버 렌더에서는 serverValue(서버가 읽은 쿠키)를 써서 하이드레이션이 어긋나지 않게 한다.
 */
export function useKidAge(serverValue: KidAge | null = null) {
  const kid = useSyncExternalStore(subscribe, read, () => serverValue);

  const setKid = useCallback((next: KidAge | null) => {
    const maxAge = next ? 60 * 60 * 24 * 365 : 0;
    document.cookie = `${KID_AGE_COOKIE}=${next ?? ""}; path=/; max-age=${maxAge}; samesite=lax`;
    listeners.forEach((l) => l());
  }, []);

  return { kid, setKid };
}
