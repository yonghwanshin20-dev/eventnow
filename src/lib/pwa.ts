"use client";

import { useSyncExternalStore } from "react";

/**
 * 앱 설치(홈 화면에 추가) 상태.
 * - 안드로이드 크롬·삼성 인터넷: 브라우저가 주는 설치 이벤트(beforeinstallprompt)로 바로 설치 창
 * - 아이폰: 설치 창이 없어 "공유 → 홈 화면에 추가" 안내
 * - 카카오톡 안 브라우저: 설치가 안 돼 기본 브라우저로 열기부터 안내
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallMode = "prompt" | "ios" | "inapp" | "manual" | "installed";

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  // 이벤트는 페이지 초반에 한 번 오므로 모듈이 읽힐 때부터 받아 둔다
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    notify();
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function currentMode(): InstallMode {
  if (installed || isStandalone()) return "installed";
  const ua = navigator.userAgent;
  if (/KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(ua)) return "inapp";
  if (deferred) return "prompt";
  // 아이패드 사파리는 맥처럼 보이므로 터치 지원으로 구분
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  return "manual";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 서버 렌더에서는 'installed'로 보아 설치 안내를 그리지 않는다 (하이드레이션 후 결정) */
export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, currentMode, () => "installed");
}

/** 안드로이드 설치 창 띄우기. 설치했으면 true */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const event = deferred;
  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === "accepted") installed = true;
  notify();
  return outcome === "accepted";
}

/** 카카오톡 안 브라우저 → 기본 브라우저로 같은 주소 열기 */
export function openInExternalBrowser(url: string = window.location.href): void {
  if (/KAKAOTALK/i.test(navigator.userAgent)) {
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
    return;
  }
  window.open(url, "_blank");
}

const DISMISS_KEY = "eventnow:install-dismissed-until";

export function installDismissed(): boolean {
  try {
    return Number(window.localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now();
  } catch {
    return false;
  }
}

/** 안내 배너 닫기 — 2주 동안 다시 띄우지 않는다 (헤더의 '앱 설치' 버튼은 그대로) */
export function dismissInstall(days = 14): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now() + days * 86_400_000));
  } catch {
    // 저장 불가 — 이번 화면에서만 닫힌다
  }
}

/** 서비스 워커 등록 (배포 환경에서만 — 개발 중에는 저장본 때문에 수정이 안 보이는 일을 막는다) */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
}
