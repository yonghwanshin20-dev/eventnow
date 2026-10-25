import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** 앱 아이콘: 청록 바탕의 'E' + 점 (홈 화면·탭) */
export default function Icon() {
  return new ImageResponse(
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
          fontSize: 320,
          fontWeight: 700,
          letterSpacing: -12,
        }}
      >
        E<span style={{ color: "#fbbf24" }}>.</span>
      </div>
    ),
    size,
  );
}
