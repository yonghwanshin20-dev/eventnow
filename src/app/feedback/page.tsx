import type { Metadata } from "next";

import { FeedbackForm } from "@/components/feedback/feedback-form";
import { SiteHeader } from "@/components/layout/site-header";
import { getFeedbackConfig } from "@/lib/feedback";

export const metadata: Metadata = {
  title: "피드백",
  description: "오류 신고·행사 제보·건의를 보내 주세요. 하나씩 확인해서 반영해요.",
};

interface FeedbackPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** 오류 신고 · 행사 제보 · 건의 — 보낸 글은 저장소의 '이슈'로 모여 하나씩 확인·반영한다 */
export default async function FeedbackPage({ searchParams }: FeedbackPageProps) {
  const params = await searchParams;
  const type = one(params.type);
  return (
    <div className="flex min-h-full flex-col bg-[#f6f3ee]">
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-5 px-4 pt-5 pb-28 sm:pb-12">
        <section className="space-y-1.5">
          <h1 className="text-[22px] font-bold tracking-tight text-stone-900">피드백</h1>
          <p className="text-sm leading-6 text-stone-600">
            틀린 정보, 빠진 행사, 바라는 점을 알려 주세요. 보내 주신 글은 하나씩 확인해서 고치거나
            추가해요.
          </p>
        </section>
        <FeedbackForm
          enabled={getFeedbackConfig() != null}
          initialType={type === "event" || type === "idea" ? type : "bug"}
          eventId={one(params.event).replace(/[^\w-]/g, "").slice(0, 64) || undefined}
          eventTitle={one(params.title).slice(0, 120) || undefined}
        />
      </main>
    </div>
  );
}
