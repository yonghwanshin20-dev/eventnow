"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Baby, Check, ChevronDown } from "lucide-react";

import { KID_AGE_OPTIONS, kidAgeLabel, type KidAge } from "@/lib/kid-age";
import { useKidAge } from "@/lib/use-kid-age";
import { cn } from "@/lib/utils";

/**
 * "우리 아이 4~7세" — 한 번 고르면 추천 순서가 그 나이에 맞춰진다
 * (다른 연령 대상 행사는 뒤로, 딱 맞는 행사엔 표시).
 */
export function KidAgePicker({ initial }: { initial: KidAge | null }) {
  const { kid, setKid } = useKidAge(initial);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const choose = (next: KidAge | null) => {
    setOpen(false);
    if (next === kid) return;
    setKid(next);
    // 서버가 쿠키를 읽어 다시 정렬하도록 화면 데이터를 새로 받는다
    startTransition(() => router.refresh());
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition-colors",
          kid
            ? "bg-teal-50 text-teal-900 ring-1 ring-teal-100"
            : "bg-white text-stone-600 ring-1 ring-stone-200",
          pending && "opacity-60",
        )}
      >
        <Baby className="size-3.5" aria-hidden />
        {kid ? `우리 아이 ${kidAgeLabel(kid)}` : "아이 나이 설정"}
        <ChevronDown className="size-3" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="우리 아이 나이"
          // 휴대폰: 버튼 위치와 상관없이 화면 아래쪽 패널로 (6칸이라 옆으로 넘치지 않게)
          className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-sm rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-stone-200 sm:absolute sm:inset-x-auto sm:top-8 sm:bottom-auto sm:left-0 sm:w-60"
        >
          <p className="px-2.5 pt-1.5 pb-1 text-[11.5px] leading-4 text-stone-500">
            나이에 맞는 행사를 먼저 보여드려요. 이 휴대폰에만 저장돼요.
          </p>
          {KID_AGE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={kid === o.value}
              onClick={() => choose(o.value)}
              className="flex h-10 w-full items-center justify-between rounded-xl px-2.5 text-sm text-stone-800 active:bg-stone-100"
            >
              {o.long}
              {kid === o.value && <Check className="size-4 text-teal-700" aria-hidden />}
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={kid === null}
            onClick={() => choose(null)}
            className="flex h-10 w-full items-center justify-between rounded-xl px-2.5 text-sm text-stone-500 active:bg-stone-100"
          >
            설정 안 함
            {kid === null && <Check className="size-4 text-teal-700" aria-hidden />}
          </button>
        </div>
      )}
    </div>
  );
}
