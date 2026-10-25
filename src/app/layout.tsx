import type { Metadata, Viewport } from "next";
import { Noto_Sans_KR } from "next/font/google";

import { AppBootstrap } from "@/components/layout/install-app";
import { siteUrl } from "@/lib/links";

import "./globals.css";

const notoSansKr = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  // 웹폰트가 늦거나 실패해도 굵기가 살아 있는 한글 시스템 글꼴로
  fallback: ["Apple SD Gothic Neo", "Malgun Gothic", "system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "EventNow",
    template: "%s | EventNow",
  },
  description:
    "패밀리 & 핫플레이스 이벤트 큐레이션 — 축제, 전시, 팝업, 체험 행사를 한곳에서",
  // 기본 미리보기 그림. 목록 링크는 page.tsx가 조건에 맞는 그림(/og/list?…)으로 바꾼다
  // (opengraph-image 파일 규칙을 쓰면 페이지별 그림을 덮어써서 라우트로 만든다)
  openGraph: {
    type: "website",
    siteName: "EventNow",
    locale: "ko_KR",
    images: [{ url: "/og/list", width: 1200, height: 630, alt: "EventNow — 이번 주말, 아이랑 어디 가지?" }],
  },
  twitter: { card: "summary_large_image" },
  appleWebApp: {
    capable: true,
    title: "EventNow",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#f6f3ee",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${notoSansKr.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col overflow-x-hidden bg-[#f6f3ee] font-sans text-stone-900">
        {children}
        <AppBootstrap />
      </body>
    </html>
  );
}
