import type { MetadataRoute } from "next";

/**
 * 홈 화면에 추가하면 앱처럼 열린다 (스토어 없이, 무료).
 * 아이콘을 길게 누르면 바로가기(이번 주말·다음 주말·달력)가 나온다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "EventNow — 아이랑 어디 가지?",
    short_name: "EventNow",
    description: "이번 주말·다음 주말·다음 달, 아이랑 갈 만한 축제·전시·팝업·키즈 체험",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f3ee",
    theme_color: "#f6f3ee",
    lang: "ko",
    dir: "ltr",
    categories: ["lifestyle", "travel", "entertainment"],
    icons: [
      { src: "/app-icon/192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app-icon/512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app-icon/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "이번 주말",
        short_name: "이번 주말",
        url: "/?when=weekend",
        icons: [{ src: "/app-icon/192.png", sizes: "192x192" }],
      },
      {
        name: "다음 주말",
        short_name: "다음 주말",
        url: "/?when=next_weekend",
        icons: [{ src: "/app-icon/192.png", sizes: "192x192" }],
      },
      {
        name: "달력으로 보기",
        short_name: "달력",
        url: "/?view=calendar",
        icons: [{ src: "/app-icon/192.png", sizes: "192x192" }],
      },
    ],
  };
}
