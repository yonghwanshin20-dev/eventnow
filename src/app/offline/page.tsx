import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

import { RetryButton } from "@/components/layout/retry-button";

export const metadata: Metadata = {
  title: "연결 끊김",
  robots: { index: false },
};

/**
 * 앱(설치한 홈 화면 아이콘)으로 열었는데 인터넷이 안 될 때 보이는 화면.
 * 서비스 워커가 미리 저장해 두고, 저장된 페이지가 없을 때 대신 보여준다.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#f6f3ee] px-6 text-center">
      <WifiOff className="size-10 text-stone-400" aria-hidden />
      <div className="space-y-1.5">
        <h1 className="text-xl font-bold text-stone-900">인터넷 연결이 끊겼어요</h1>
        <p className="text-sm leading-6 text-stone-600">
          전에 열어 본 화면은 연결 없이도 볼 수 있어요.
          <br />
          연결되면 다시 시도해 주세요.
        </p>
      </div>
      <RetryButton />
      <Link href="/" className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline">
        첫 화면으로
      </Link>
    </main>
  );
}
