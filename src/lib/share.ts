/**
 * 공유: 카카오톡(키가 있으면 사진 카드) → 휴대폰 공유 시트(카톡 포함) → 링크 복사 순서로 시도한다.
 *
 * 카카오톡 카드 공유는 무료 JavaScript 키(NEXT_PUBLIC_KAKAO_JS_KEY)와 사이트 도메인 등록이 필요하다.
 * 키가 없어도 휴대폰에서는 공유 시트에 카카오톡이 나오므로 기능은 그대로 쓸 수 있다.
 */

export interface SharePayload {
  title: string;
  /** 카톡 카드 두 번째 줄 (날짜 · 장소) */
  description?: string;
  /** 카톡 카드 사진 (http 주소만) */
  imageUrl?: string | null;
  url: string;
  /** 카톡 카드 버튼 글자 */
  buttonTitle?: string;
}

export type ShareResult = "kakao" | "native" | "copied" | "cancelled" | "failed";

const KAKAO_SDK_URL = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js";

interface KakaoLink {
  mobileWebUrl: string;
  webUrl: string;
}

interface KakaoSdk {
  isInitialized(): boolean;
  init(key: string): void;
  Share: {
    sendDefault(options: {
      objectType: "feed";
      content: { title: string; description?: string; imageUrl: string; link: KakaoLink };
      buttons?: { title: string; link: KakaoLink }[];
    }): void;
  };
}

declare global {
  interface Window {
    Kakao?: KakaoSdk;
  }
}

export function kakaoKey(): string | null {
  return process.env.NEXT_PUBLIC_KAKAO_JS_KEY?.trim() || null;
}

let sdkPromise: Promise<KakaoSdk | null> | null = null;

/** 누를 때만 카카오 SDK를 불러온다 (첫 화면 무게를 늘리지 않게) */
function loadKakao(): Promise<KakaoSdk | null> {
  const key = kakaoKey();
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve) => {
      const ready = () => {
        const kakao = window.Kakao;
        if (!kakao) return resolve(null);
        try {
          if (!kakao.isInitialized()) kakao.init(key);
          resolve(kakao);
        } catch {
          resolve(null);
        }
      };
      if (window.Kakao) return ready();
      const script = document.createElement("script");
      script.src = KAKAO_SDK_URL;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = ready;
      script.onerror = () => {
        sdkPromise = null; // 다음에 다시 시도
        resolve(null);
      };
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

/** 카톡 카드에 쓸 사진 — 행사 사진이 없으면 그 링크에 맞춰 그린 미리보기 그림 (코스·행사·목록) */
export function cardImage(payload: Pick<SharePayload, "imageUrl" | "url">): string {
  if (payload.imageUrl && /^https?:\/\//i.test(payload.imageUrl)) return payload.imageUrl;
  const { origin, pathname, search } = new URL(payload.url);
  if (pathname === "/course") return `${origin}/og/course${search}`;
  if (/^\/events\/[^/]+$/.test(pathname)) return `${origin}${pathname}/opengraph-image`;
  return `${origin}/og/list${search}`;
}

async function copy(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    window.prompt("링크를 복사하세요", url);
    return false;
  }
}

/** 카카오톡 버튼: 카톡 카드 → 공유 시트 → 복사 */
export async function shareToKakao(payload: SharePayload): Promise<ShareResult> {
  const kakao = await loadKakao();
  if (kakao) {
    try {
      const link = { mobileWebUrl: payload.url, webUrl: payload.url };
      kakao.Share.sendDefault({
        objectType: "feed",
        content: {
          title: payload.title,
          description: payload.description,
          imageUrl: cardImage(payload),
          link,
        },
        buttons: [{ title: payload.buttonTitle ?? "자세히 보기", link }],
      });
      return "kakao";
    } catch {
      // 도메인 미등록 등 — 아래 방법으로 넘어간다
    }
  }
  return shareNative(payload);
}

/** 일반 공유: 휴대폰 공유 시트(카톡·문자·메신저) → 복사 */
export async function shareNative(payload: SharePayload): Promise<ShareResult> {
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      const text = [payload.title, payload.description].filter(Boolean).join("\n");
      await navigator.share({ title: payload.title, text, url: payload.url });
      return "native";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
    }
  }
  return (await copy(payload.url)) ? "copied" : "failed";
}
