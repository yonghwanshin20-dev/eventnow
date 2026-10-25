import Link from "next/link";

import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-col bg-[#f6f3ee]">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-start justify-center gap-4 px-4 py-16">
        <h1 className="text-2xl font-semibold text-stone-900">
          페이지를 찾을 수 없어요
        </h1>
        <p className="text-stone-600">
          요청하신 이벤트나 경로가 없거나 이동되었을 수 있습니다.
        </p>
        <Button asChild className="bg-teal-700 hover:bg-teal-800">
          <Link href="/">메인으로 돌아가기</Link>
        </Button>
      </main>
    </div>
  );
}
