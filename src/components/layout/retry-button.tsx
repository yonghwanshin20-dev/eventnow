"use client";

/** 오프라인 화면은 원래 열려던 주소 그대로 보이므로, 새로고침이 곧 '다시 시도' */
export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="h-11 rounded-full bg-stone-900 px-6 text-sm font-semibold text-white active:bg-stone-800"
    >
      다시 시도
    </button>
  );
}
