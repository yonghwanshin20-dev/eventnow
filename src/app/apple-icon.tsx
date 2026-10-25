import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 112,
          fontWeight: 700,
          letterSpacing: -4,
        }}
      >
        E<span style={{ color: "#fbbf24" }}>.</span>
      </div>
    ),
    size,
  );
}
