import { afterEach, describe, expect, it, vi } from "vitest";

import { siteUrl } from "@/lib/links";

describe("siteUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("직접 지정한 주소가 먼저", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://my.example.com/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "eventnow-abc.vercel.app");
    expect(siteUrl()).toBe("https://my.example.com");
  });

  it("없으면 Vercel 정식 주소 → 이 배포 주소", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "eventnow-abc.vercel.app");
    expect(siteUrl()).toBe("https://eventnow-abc.vercel.app");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "eventnow-git-x.vercel.app");
    expect(siteUrl()).toBe("https://eventnow-git-x.vercel.app");
  });
});
