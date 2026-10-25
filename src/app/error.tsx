"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * 예상 못 한 오류가 나도 빈 화면 대신 다시 시도할 수 있게.
 * (데이터 파일이 깨졌거나 날씨·외부 서버가 느릴 때 등)
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[page error]", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-[#f6f3ee] px-6 text-center">
      <div className="space-y-1.5">
        <h1 className="text-xl font-bold text-stone-900">잠시 문제가 생겼어요</h1>
        <p className="text-sm leading-6 text-stone-600">
          화면을 불러오다 오류가 났어요. 다시 시도해 주세요.
        </p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="h-11 rounded-full bg-stone-900 px-6 text-sm font-semibold text-white active:bg-stone-800"
      >
        다시 시도
      </button>
      <Link href="/" className="text-sm font-medium text-teal-800 underline-offset-2 hover:underline">
        첫 화면으로
      </Link>
    </main>
  );
}
