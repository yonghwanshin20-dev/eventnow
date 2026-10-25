import { SiteHeader } from "@/components/layout/site-header";

/** 상세 페이지를 여는 동안 보여줄 뼈대 — 빈 화면 대신 곧 나올 모양을 미리 보여준다 */
export default function Loading() {
  return (
    <div className="flex min-h-full flex-col bg-[#f6f3ee]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 sm:px-4 sm:py-8" aria-busy="true">
        <div className="aspect-[4/3] max-h-[28rem] w-full animate-pulse bg-stone-200 sm:rounded-t-3xl" />
        <div className="relative -mt-5 space-y-4 rounded-t-3xl bg-white px-4 pt-5 pb-10 sm:mt-0 sm:rounded-none sm:px-8">
          <div className="flex gap-2">
            <div className="h-6 w-16 animate-pulse rounded-md bg-stone-200" />
            <div className="h-6 w-12 animate-pulse rounded-md bg-stone-100" />
          </div>
          <div className="h-7 w-3/4 animate-pulse rounded-lg bg-stone-200" />
          <div className="space-y-3 rounded-2xl bg-stone-50 p-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-5 w-full animate-pulse rounded bg-stone-200/70" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-stone-100" />
            ))}
          </div>
        </div>
        <span className="sr-only">행사 정보를 불러오는 중</span>
      </main>
    </div>
  );
}
