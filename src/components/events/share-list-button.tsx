"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";

import { shareToKakao } from "@/lib/share";

interface ShareListButtonProps {
  /** "이번 주말 갈 만한 곳 87곳" */
  title: string;
  /** 앞쪽 행사 몇 개 이름 */
  description?: string;
  imageUrl?: string | null;
}

/**
 * 지금 보고 있는 목록(이번 주말·11월·찜 목록 …)을 그대로 카톡으로 보낸다.
 * 링크에 조건이 다 들어 있어 받은 사람도 같은 목록을 본다 (찜 목록은 fav=로 id가 실린다).
 */
export function ShareListButton({ title, description, imageUrl }: ShareListButtonProps) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("e"); // 열려 있는 빠른 보기는 빼고
    url.searchParams.delete("n");
    // '가까운 순'의 내 위치(약 10m 정밀도)는 남에게 보내지 않는다
    url.searchParams.delete("near");
    if (url.searchParams.get("sort") === "near") url.searchParams.delete("sort");
    const result = await shareToKakao({
      title,
      description,
      imageUrl,
      url: url.toString(),
      buttonTitle: "목록 보기",
    });
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${title} 카카오톡으로 공유`}
      className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full bg-[#FEE500] px-3 text-[13px] font-semibold text-[#191919] active:bg-[#f5dc00]"
    >
      <MessageCircle className="size-4 fill-current" aria-hidden />
      {copied ? (
        "복사됨"
      ) : (
        <>
          <span className="sm:hidden">공유</span>
          <span className="hidden sm:inline">이 목록 공유</span>
        </>
      )}
    </button>
  );
}
