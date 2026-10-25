/**
 * next/image 최적화를 허용한 호스트. next.config.ts remotePatterns와 같게 유지.
 * 목록 밖 호스트는 unoptimized로 그려 "hostname not configured" 런타임 에러를 막는다.
 */
export const OPTIMIZED_IMAGE_HOSTS = [
  "images.unsplash.com",
  "tong.visitkorea.or.kr",
  "kfescdn.visitkorea.or.kr",
  "www.culture.go.kr",
  "culture.seoul.go.kr",
  "d8nffddmkwqeq.cloudfront.net", // 팝플리
  "www.mcst.go.kr", // 문화체육관광부 지역축제
  "www.khs.go.kr", // 국가유산청 사적·명승
] as const;

export function shouldOptimizeImage(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    return (
      protocol === "https:" &&
      (OPTIMIZED_IMAGE_HOSTS as readonly string[]).includes(hostname)
    );
  } catch {
    return false;
  }
}

export function isHttpUrl(url: string | null | undefined): url is string {
  return Boolean(url && /^https?:\/\//i.test(url));
}
