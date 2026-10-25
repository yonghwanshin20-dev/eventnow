"use client";

import { Clock, TrendingUp, X } from "lucide-react";

const KEY = "eventnow:recent-searches";
const MAX_RECENT = 6;

/** 가족 나들이에서 자주 찾는 말 — 눌러서 바로 검색 */
export const POPULAR_KEYWORDS = [
  "불꽃",
  "국화",
  "빛축제",
  "공룡",
  "어린이",
  "미술관",
  "박물관",
  "한강",
  "체험",
  "무료",
];

export function loadRecentSearches(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(term: string): void {
  const t = term.trim();
  if (!t) return;
  try {
    const next = [t, ...loadRecentSearches().filter((v) => v !== t)].slice(0, MAX_RECENT);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 저장 불가(사파리 프라이빗 등) — 최근 검색만 못 보여줄 뿐
  }
}

function removeRecentSearch(term: string): string[] {
  const next = loadRecentSearches().filter((v) => v !== term);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 무시
  }
  return next;
}

interface SearchSuggestionsProps {
  recent: string[];
  onRecentChange: (next: string[]) => void;
  onPick: (term: string) => void;
}

/** 빈 검색창을 눌렀을 때: 최근 검색어 + 인기 검색어 */
export function SearchSuggestions({ recent, onRecentChange, onPick }: SearchSuggestionsProps) {
  // 버튼을 눌러도 입력창 포커스가 먼저 빠지지 않게
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  const chip =
    "inline-flex h-8 items-center gap-1 rounded-full bg-stone-100 px-3 text-[13px] text-stone-700 active:bg-stone-200";

  return (
    <div className="absolute inset-x-0 top-full z-40 mt-1.5 space-y-3 rounded-2xl bg-white p-3.5 shadow-lg ring-1 ring-stone-200">
      {recent.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1 text-xs font-semibold text-stone-500">
            <Clock className="size-3.5" aria-hidden />
            최근 검색
          </p>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((term) => (
              <span key={term} className={chip}>
                <button type="button" onMouseDown={keepFocus} onClick={() => onPick(term)}>
                  {term}
                </button>
                <button
                  type="button"
                  aria-label={`${term} 지우기`}
                  onMouseDown={keepFocus}
                  onClick={() => onRecentChange(removeRecentSearch(term))}
                  className="-mr-1 rounded-full p-0.5 text-stone-400"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <p className="flex items-center gap-1 text-xs font-semibold text-stone-500">
          <TrendingUp className="size-3.5" aria-hidden />
          이런 걸 많이 찾아요
        </p>
        <div className="flex flex-wrap gap-1.5">
          {POPULAR_KEYWORDS.map((term) => (
            <button
              key={term}
              type="button"
              onMouseDown={keepFocus}
              onClick={() => onPick(term)}
              className={chip}
            >
              {term}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
