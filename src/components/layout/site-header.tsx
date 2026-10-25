import Link from "next/link";

import { InstallButton } from "@/components/layout/install-app";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-[#f6f3ee]/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-3 sm:h-14 sm:px-4">
        <Link
          href="/"
          className="text-lg font-bold tracking-tight text-stone-900"
        >
          Event<span className="text-teal-700">Now</span>
        </Link>
        <div className="flex items-center gap-3">
          <p className="hidden text-sm text-stone-500 sm:block">패밀리 & 핫플레이스 큐레이션</p>
          {/* 모바일은 하단 탭에 있어서 넓은 화면에서만 */}
          <Link href="/food" className="hidden text-sm font-medium text-stone-700 hover:text-teal-800 lg:block">
            주변 맛집
          </Link>
          <Link href="/feedback" className="hidden text-sm font-medium text-stone-700 hover:text-teal-800 lg:block">
            피드백
          </Link>
          <InstallButton />
        </div>
      </div>
    </header>
  );
}
