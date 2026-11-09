/**
 * 보던 목록(필터 주소)을 기억해 두는 곳 — 피드백·맛집 화면에 다녀오거나 찜을 보고 나와도
 * 고른 지역·분류·날짜가 그대로 남게 한다. 탭을 닫으면 사라지는 sessionStorage 를 쓴다.
 */

const LAST_LIST = "eventnow:last-list";
const BEFORE_FAV = "eventnow:before-fav";

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // 개인정보 보호 모드 등 저장을 못 하면 그냥 넘어간다 (첫 화면으로 가면 될 뿐)
  }
}

/** 목록 주소의 '?…' 부분 (필터가 없으면 빈 문자열) */
export function saveLastList(query: string): void {
  write(LAST_LIST, query);
}

export function lastListHref(): string {
  return `/${read(LAST_LIST) ?? ""}`;
}

/** 찜 보기로 들어가기 직전 필터 — 찜에서 나오면 그대로 돌아간다 */
export function stashBeforeFavorites(query: string): void {
  write(BEFORE_FAV, query);
}

export function takeBeforeFavorites(): string | null {
  const value = read(BEFORE_FAV);
  write(BEFORE_FAV, null);
  return value;
}
