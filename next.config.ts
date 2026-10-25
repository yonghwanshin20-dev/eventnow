import type { NextConfig } from "next";

// src/lib/images.ts OPTIMIZED_IMAGE_HOSTS와 같게 유지 (위키미디어는 unoptimized로 직접 로드)
const nextConfig: NextConfig = {
  // 행사 상세 페이지 700여 개를 빌드 때 미리 만든다. PC가 바쁠 때 기본 제한(60초)을 넘겨
  // 빌드가 실패한 적이 있어 넉넉히 둔다 (정상일 때는 1~2분이면 끝난다)
  staticPageGenerationTimeout: 300,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "tong.visitkorea.or.kr",
      },
      {
        protocol: "https",
        hostname: "kfescdn.visitkorea.or.kr",
      },
      {
        protocol: "https",
        hostname: "www.culture.go.kr",
      },
      {
        protocol: "https",
        hostname: "culture.seoul.go.kr",
      },
      {
        // 팝플리 팝업스토어 사진
        protocol: "https",
        hostname: "d8nffddmkwqeq.cloudfront.net",
      },
      {
        // 문화체육관광부 지역축제 사진
        protocol: "https",
        hostname: "www.mcst.go.kr",
      },
    ],
    // 카드(폰 반 폭~데스크톱 1/4)와 상세 사진(최대 768px)에 필요한 크기만 — 기본값(최대 3840px)보다
    // 변형 수가 적어 srcset이 짧아지고 최적화 캐시도 덜 쓴다
    deviceSizes: [640, 828, 1080, 1440],
    imageSizes: [96, 160, 256, 384],
    // 일부 사내망은 이미지 CDN을 NAT64 주소(64:ff9b::)로 돌려줘 Next가 사설 IP로 보고 막는다.
    // 로컬 개발 미리보기에서만 허용하고, 배포(production)에서는 기본값(차단)을 유지한다.
    dangerouslyAllowLocalIP: process.env.NODE_ENV === "development",
  },
  async headers() {
    return [
      {
        // 기본 보안 헤더 — 다른 사이트가 이 화면을 몰래 감싸거나(클릭재킹) 파일 종류를 오인하지 않게
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
      {
        // 서비스 워커는 늘 최신으로 (옛 버전이 남아 새 기능이 안 보이는 일이 없게)
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
