import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * OG 이미지 렌더러에는 한글 글꼴이 없어 Google Fonts에서 필요한 글자만 받아온다 (수 KB).
 * 실패하면 null — 호출부는 한글 없는 대체 이미지를 그린다.
 */
async function loadKoreanFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(text)}`,
      { next: { revalidate: 86_400 } },
    ).then((r) => r.text());
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url, { next: { revalidate: 86_400 } });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

interface OgCardProps {
  eyebrow: string;
  title: string;
  lines: string[];
  accent?: string;
}

export async function renderOgCard({
  eyebrow,
  title,
  lines,
  accent = "#0f766e",
}: OgCardProps): Promise<ImageResponse> {
  const text = [eyebrow, title, ...lines, "EventNow"].join("");
  const font = await loadKoreanFont(text);
  const korean = font != null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: "#f6f3ee",
          fontFamily: korean ? "NotoSansKR" : "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              padding: "10px 22px",
              borderRadius: 999,
              background: accent,
              color: "white",
              fontSize: 30,
            }}
          >
            {korean ? eyebrow : "EventNow"}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: title.length > 24 ? 64 : 76,
              lineHeight: 1.2,
              color: "#1c1917",
              letterSpacing: -1.5,
            }}
          >
            {korean ? title : "Family events in Korea"}
          </div>
          {korean &&
            lines.map((line) => (
              <div key={line} style={{ display: "flex", fontSize: 34, color: "#57534e" }}>
                {line}
              </div>
            ))}
        </div>
        <div style={{ display: "flex", fontSize: 36, color: "#1c1917" }}>
          Event<span style={{ color: "#0f766e" }}>Now</span>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: font ? [{ name: "NotoSansKR", data: font, weight: 700, style: "normal" }] : [],
    },
  );
}
