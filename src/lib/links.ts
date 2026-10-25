import type { Event } from "@/types/event";

type LinkFields = Pick<Event, "official_link" | "title" | "location_name" | "address"> &
  Partial<Pick<Event, "category" | "place_types">>;

function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return `https://${trimmed}`;
  return null;
}

/** 행사 공식 페이지. 없으면 행사명 검색 (구청·시청 대문은 행사 정보가 없어 쓰지 않음) */
export function resolveInfoUrl(event: LinkFields): {
  href: string;
  label: string;
  kind: "official" | "search";
} {
  const official = normalizeUrl(event.official_link);
  // 도서관·문화공간(관광명소)은 그곳 홈페이지에서 이달의 문화 프로그램·강좌를 보게 된다
  const programPlace =
    event.category === "attraction" &&
    (event.place_types ?? []).some((t) => t === "library" || t === "cultural_space");
  if (official && programPlace) {
    return { href: official, label: "문화 프로그램 보기", kind: "official" };
  }
  if (official) {
    // 행사 공식 사이트가 아니라 안내 사이트로 가는 경우 그 이름으로 (버튼이 사실과 다르지 않게)
    const host = hostLabel(official);
    const label = /(^|\.)popply\.co\.kr$/.test(host)
      ? "팝플리에서 보기"
      : /(^|\.)culture\.go\.kr$/.test(host)
        ? "문화포털에서 보기"
        : /^culture\.seoul\.go\.kr$/.test(host)
          ? "서울문화포털에서 보기"
          : /mcst\.go\.kr$/.test(host)
            ? "문체부 축제정보 보기"
            : /\.go\.kr$/.test(host)
              ? "시·군청 안내 보기"
              : "공식 홈페이지";
    return { href: official, label, kind: "official" };
  }

  const q = encodeURIComponent(
    `${event.title} ${event.location_name}`.trim(),
  );
  return {
    href: `https://search.naver.com/search.naver?query=${q}`,
    label: "네이버에서 정보 보기",
    kind: "search",
  };
}

export function mapsUrl(event: Pick<Event, "location_name" | "address">): string {
  const q = encodeURIComponent(
    [event.location_name, event.address].filter(Boolean).join(" "),
  );
  return `https://map.naver.com/v5/search/${q}`;
}

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "바로가기";
  }
}

/**
 * 사이트 주소 (공유 링크·미리보기·sitemap). 직접 정하지 않으면 Vercel이 알려주는 실제 주소를 쓴다:
 * NEXT_PUBLIC_SITE_URL(직접 지정) → 정식 배포 주소(VERCEL_PROJECT_PRODUCTION_URL) → 이 배포 주소(VERCEL_URL).
 * 그래서 Vercel이 정해 준 주소가 'eventnow-abc.vercel.app'이어도 따로 설정할 필요가 없다.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const host =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL;
  if (host) return `https://${host.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "http://localhost:3000";
}
