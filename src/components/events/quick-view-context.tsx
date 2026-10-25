"use client";

import { createContext, useContext } from "react";

/** 카드를 누르면 페이지 이동 대신 빠른 보기 시트를 연다 (제공자가 없으면 일반 링크로 동작) */
export interface QuickViewApi {
  open: (id: string, siblings: string[]) => void;
}

export const QuickViewContext = createContext<QuickViewApi | null>(null);

/** 시트 안에서 '이전/다음'으로 넘길 같은 목록의 id들 */
export const QuickViewListContext = createContext<string[]>([]);

export function useQuickView() {
  return {
    api: useContext(QuickViewContext),
    siblings: useContext(QuickViewListContext),
  };
}
