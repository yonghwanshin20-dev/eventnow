"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";

import { FEEDBACK_TYPES, type FeedbackType } from "@/lib/feedback";
import { cn } from "@/lib/utils";

interface FeedbackFormProps {
  /** 서버에 토큰이 있어 보낼 수 있는지 */
  enabled: boolean;
  initialType: FeedbackType;
  /** 행사 화면의 [정보가 틀렸어요]에서 왔을 때 */
  eventId?: string;
  eventTitle?: string;
}

const field =
  "w-full rounded-xl bg-white px-3.5 py-3 text-[15px] text-stone-900 ring-1 ring-stone-200 outline-none placeholder:text-stone-400 focus:ring-2 focus:ring-teal-600";

export function FeedbackForm({ enabled, initialType, eventId, eventTitle }: FeedbackFormProps) {
  const [type, setType] = useState<FeedbackType>(initialType);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState({ title: "", date: "", place: "", link: "" });
  const [website, setWebsite] = useState(""); // 봇 걸러내기용 숨은 칸
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          message,
          website,
          eventId: type === "bug" ? eventId : undefined,
          eventTitle: type === "bug" ? eventTitle : undefined,
          reportTitle: report.title,
          reportDate: report.date,
          reportPlace: report.place,
          reportLink: report.link,
          page: typeof window === "undefined" ? undefined : document.referrer || window.location.href,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "보내지 못했어요. 잠시 후 다시 시도해 주세요.");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("인터넷 연결을 확인하고 다시 시도해 주세요.");
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <div className="space-y-4 rounded-2xl bg-white p-6 text-center ring-1 ring-stone-200">
        <CheckCircle2 className="mx-auto size-10 text-teal-600" aria-hidden />
        <div className="space-y-1">
          <p className="text-lg font-bold text-stone-900">잘 받았어요, 고마워요!</p>
          <p className="text-sm leading-6 text-stone-600">
            하나씩 확인해서 고치거나 추가할게요. 행사 제보는 확인되면 목록에 올라가요.
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMessage("");
              setReport({ title: "", date: "", place: "", link: "" });
              setState("idle");
            }}
            className="h-11 rounded-full px-5 text-sm font-medium text-stone-700 ring-1 ring-stone-200"
          >
            하나 더 보내기
          </button>
          <Link href="/" className="inline-flex h-11 items-center rounded-full bg-stone-900 px-5 text-sm font-semibold text-white">
            첫 화면으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!enabled && (
        <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 ring-1 ring-amber-100">
          피드백 받기를 아직 준비 중이에요. 곧 보낼 수 있게 열어 둘게요.
        </p>
      )}

      <div role="radiogroup" aria-label="종류" className="grid grid-cols-3 gap-2">
        {FEEDBACK_TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={type === t.value}
            onClick={() => setType(t.value)}
            className={cn(
              "rounded-2xl px-2 py-3 text-center transition-colors",
              type === t.value ? "bg-stone-900 text-white" : "bg-white text-stone-800 ring-1 ring-stone-200",
            )}
          >
            <span className="block text-[14.5px] font-bold">{t.label}</span>
            <span className={cn("mt-0.5 block text-[11px] leading-4", type === t.value ? "text-white/70" : "text-stone-500")}>
              {t.hint}
            </span>
          </button>
        ))}
      </div>

      {type === "bug" && eventTitle && (
        <p className="rounded-xl bg-white px-3.5 py-2.5 text-sm text-stone-700 ring-1 ring-stone-200">
          신고할 행사: <span className="font-semibold">{eventTitle}</span>
        </p>
      )}

      {type === "event" && (
        <div className="space-y-2.5">
          <input className={field} placeholder="행사 이름 (필수)" value={report.title} maxLength={120}
            onChange={(e) => setReport({ ...report, title: e.target.value })} aria-label="행사 이름" />
          <div className="grid grid-cols-2 gap-2.5">
            <input className={field} placeholder="날짜 (예: 10월 24일 토)" value={report.date} maxLength={60}
              onChange={(e) => setReport({ ...report, date: e.target.value })} aria-label="날짜" />
            <input className={field} placeholder="장소 (예: 홍제폭포)" value={report.place} maxLength={120}
              onChange={(e) => setReport({ ...report, place: e.target.value })} aria-label="장소" />
          </div>
          <input className={field} placeholder="안내 링크 (구청 공지·인스타 등, 있으면)" value={report.link} maxLength={300}
            inputMode="url" onChange={(e) => setReport({ ...report, link: e.target.value })} aria-label="링크" />
        </div>
      )}

      <textarea
        className={cn(field, "min-h-36 resize-y leading-6")}
        placeholder={
          type === "bug"
            ? "무엇이 틀렸는지 알려 주세요 (예: 날짜가 10월 31일이 아니라 11월 1일이에요)"
            : type === "event"
              ? "더 알려 주실 내용 (시간·대상·요금 등, 선택)"
              : "있었으면 하는 기능이나 바라는 점을 적어 주세요"
        }
        value={message}
        maxLength={2000}
        onChange={(e) => setMessage(e.target.value)}
        aria-label="내용"
      />
      <p className="text-[12px] leading-5 text-stone-500">
        이름·연락처 없이 내용만 전달돼요. 개인정보는 적지 말아 주세요.
      </p>
      {/* 사람에게는 안 보이는 칸 (봇 걸러내기) */}
      <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />

      {error && <p role="alert" className="text-sm font-medium text-rose-700">{error}</p>}
      <button
        type="submit"
        disabled={!enabled || state === "sending"}
        className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-teal-700 text-[15px] font-semibold text-white active:bg-teal-800 disabled:opacity-50"
      >
        <Send className="size-4" aria-hidden />
        {state === "sending" ? "보내는 중…" : "보내기"}
      </button>
    </form>
  );
}
