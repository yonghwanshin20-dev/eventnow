"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 브라우저 히스토리로 돌아가 필터 URL을 유지. 직접 진입 시 홈으로. */
export function BackToListButton({ floating = false }: { floating?: boolean }) {
  const router = useRouter();
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push("/");
  };

  if (floating) {
    // 사진 위에 떠 있는 둥근 버튼
    return (
      <button
        type="button"
        onClick={goBack}
        aria-label="목록으로"
        className={cn(
          "absolute top-3 left-3 z-10 flex size-10 items-center justify-center rounded-full",
          "bg-white/90 text-stone-800 shadow-md backdrop-blur-sm active:bg-white",
        )}
      >
        <ArrowLeft className="size-5" />
      </button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      className="mb-3 -ml-2 min-h-10 text-stone-600 sm:mb-4"
      onClick={goBack}
    >
      <ArrowLeft data-icon="inline-start" />
      목록으로
    </Button>
  );
}
