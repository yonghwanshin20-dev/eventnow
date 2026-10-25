import { regionShortLabel } from "@/data/regions";
import { dateWindow, todayKst } from "@/lib/dates";
import {
  CATEGORY_LABELS,
  filterEvents,
  filtersToQueryString,
  formatShortRange,
  getScheduleType,
  sortEvents,
  whenTitle,
  type ExplorerFilters,
} from "@/lib/events";
import type { Event } from "@/types/event";

export interface ListMeta {
  /** "부산 · 이번 주말 갈 만한 곳 14곳" */
  title: string;
  /** 앞쪽 행사 이름 몇 개 */
  description: string;
  /** 미리보기 그림의 작은 머리말 ("10.24 – 10.25") */
  eyebrow: string;
  /** 미리보기 그림에 넣을 행사 이름 (최대 3개) */
  lines: string[];
}

/**
 * 공유된 목록 링크(?when=weekend&region=…)의 제목·설명 — 카톡·메신저에 링크만 붙여 넣어도
 * "이번 주말 갈 만한 곳 241곳"처럼 무엇이 담긴 링크인지 보이게 한다. 조건이 없으면 null(기본 소개).
 */
export function describeList(
  filters: ExplorerFilters,
  events: Event[],
  today: string = todayKst(),
): ListMeta | null {
  if (filtersToQueryString({ ...filters, view: "list" }) === "") return null;

  const matched = sortEvents(filterEvents(events, filters, today), "recommended", today);
  const dated = Boolean(filters.date || filters.when);
  // 기간을 골랐으면 화면의 타일 숫자처럼 기간 한정 행사만 센다
  const counted = dated ? matched.filter((e) => getScheduleType(e) === "limited") : matched;
  const n = counted.length;

  const when = filters.date
    ? `${Number(filters.date.slice(5, 7))}월 ${Number(filters.date.slice(8, 10))}일`
    : filters.when
      ? whenTitle(filters.when, today)
      : null;
  const where = filters.subregion !== "all"
    ? filters.subregion
    : filters.region !== "all"
      ? regionShortLabel(filters.region)
      : null;
  const what = filters.category !== "all" ? CATEGORY_LABELS[filters.category] : null;

  // 검색어는 실제로 찾은 행사가 있고 짧을 때만 제목에 넣는다 — 아무 문구(광고·주소)나
  // 링크에 넣어 EventNow 이름의 미리보기 그림으로 찍어 내지 못하게
  const showQuery = filters.q && n > 0 && filters.q.length <= 20;
  let title: string;
  if (filters.favorites.length > 0) title = `찜한 행사 ${n}곳`;
  else if (showQuery) title = `‘${filters.q}’ 행사 ${n}곳`;
  else if (filters.q) title = `검색 결과 ${n}곳`;
  else {
    const head = [when, what ?? "갈 만한 곳"].filter(Boolean).join(" ");
    title = `${head} ${n}곳`;
  }
  if (where && filters.favorites.length === 0) title = `${where} · ${title}`;

  const names = counted.slice(0, 3).map((e) => e.title);
  const range = filters.date
    ? formatShortRange(filters.date, filters.date)
    : filters.when
      ? (() => {
          const [from, to] = dateWindow(filters.when, today);
          return formatShortRange(from, to);
        })()
      : "축제 · 전시 · 팝업 · 키즈 체험";
  return {
    title,
    description: names.length ? names.join(" · ") : "조건에 맞는 행사를 모아 봤어요",
    eyebrow: range,
    lines: names,
  };
}
