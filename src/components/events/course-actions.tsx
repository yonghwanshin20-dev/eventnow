"use client";

import { useState } from "react";
import { Check, Heart, MessageCircle } from "lucide-react";

import { useFavorites } from "@/lib/favorites";
import { shareToKakao } from "@/lib/share";

interface CourseActionsProps {
  ids: string[];
  title: string;
  description: string;
  imageUrl: string | null;
}

/** 코스 페이지 하단: 코스 전체 찜하기 · 카톡으로 보내기 */
export function CourseActions({ ids, title, description, imageUrl }: CourseActionsProps) {
  const { ids: saved, ready, addMany } = useFavorites();
  const [copied, setCopied] = useState(false);
  const allSaved = ready && ids.every((id) => saved.includes(id));

  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        type="button"
        disabled={allSaved}
        onClick={() => addMany(ids)}
        className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-white text-[14px] font-semibold text-stone-800 ring-1 ring-stone-200 active:bg-stone-50 disabled:text-rose-700"
      >
        {allSaved ? (
          <Check className="size-4" aria-hidden />
        ) : (
          <Heart className="size-4" aria-hidden />
        )}
        {allSaved ? "모두 찜했어요" : "코스 전체 찜하기"}
      </button>
      <button
        type="button"
        onClick={async () => {
          const result = await shareToKakao({
            title,
            description,
            imageUrl,
            url: window.location.href,
            buttonTitle: "코스 보기",
          });
          if (result === "copied") {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          }
        }}
        className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#FEE500] text-[14px] font-semibold text-[#191919] active:bg-[#f5dc00]"
      >
        <MessageCircle className="size-4 fill-current" aria-hidden />
        {copied ? "링크 복사됨" : "카톡으로 보내기"}
      </button>
    </div>
  );
}
