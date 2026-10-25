import { ImageResponse } from "next/og";

/**
 * 설치용 앱 아이콘 (manifest에서 씀): /app-icon/192.png · /app-icon/512.png · /app-icon/maskable-512.png
 * maskable은 안드로이드가 원·물방울 모양으로 잘라도 글자가 남도록 가운데 80% 안에만 그린다.
 */
const ICONS: Record<string, { size: number; maskable: boolean }> = {
  "192.png": { size: 192, maskable: false },
  "512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
};

export function generateStaticParams() {
  return Object.keys(ICONS).map((name) => ({ name }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const icon = ICONS[name];
  if (!icon) return new Response("not found", { status: 404 });
  const { size, maskable } = icon;
  const font = Math.round(size * (maskable ? 0.46 : 0.625));
  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f766e",
          color: "#f6f3ee",
          fontSize: font,
          fontWeight: 700,
          letterSpacing: -Math.round(font / 26),
          // 일반 아이콘은 둥근 모서리, maskable은 OS가 모양을 정하므로 꽉 채운다
          borderRadius: maskable ? 0 : Math.round(size * 0.22),
        }}
      >
        E<span style={{ color: "#fbbf24" }}>.</span>
      </div>
    ),
    { width: size, height: size },
  );
  image.headers.set("Cache-Control", "public, max-age=604800, immutable");
  return image;
}
