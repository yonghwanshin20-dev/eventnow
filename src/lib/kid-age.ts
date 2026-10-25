import type { TargetAgeGroup } from "@/types/event";

/**
 * '우리 아이 나이' — 한 번 정해 두면 추천 순서와 카드 표시가 그 나이에 맞춰진다.
 * 서버가 목록을 정렬할 때 읽어야 해서 쿠키에 둔다 (로그인·개인정보 없음, 이 브라우저에만).
 *
 * 2살 단위로 나눠, 행사 본문에 적힌 세부 나이("만 4~7세", "36개월 이상")와 겹치는지로 판단한다.
 * 세부 나이가 없는 행사는 연령대(영유아·미취학·초등)로 판단한다.
 */
export type KidAge = "0-1" | "2-3" | "4-5" | "6-7" | "8-10" | "11-13";

export const KID_AGE_COOKIE = "eventnow_kid";

export const KID_AGE_OPTIONS: {
  value: KidAge;
  label: string;
  long: string;
  years: [number, number];
  group: Exclude<TargetAgeGroup, "all">;
}[] = [
  { value: "0-1", label: "0~1세", long: "0~1세 (영아)", years: [0, 1], group: "toddler" },
  { value: "2-3", label: "2~3세", long: "2~3세", years: [2, 3], group: "toddler" },
  { value: "4-5", label: "4~5세", long: "4~5세", years: [4, 5], group: "kids" },
  { value: "6-7", label: "6~7세", long: "6~7세", years: [6, 7], group: "kids" },
  { value: "8-10", label: "초등 저학년", long: "초등 저학년 (8~10세)", years: [8, 10], group: "elementary" },
  { value: "11-13", label: "초등 고학년", long: "초등 고학년 (11~13세)", years: [11, 13], group: "elementary" },
];

/** 예전 3단계 값(toddler·kids·elementary)도 받아 가장 가까운 칸으로 옮긴다 */
const LEGACY: Record<string, KidAge> = { toddler: "2-3", kids: "4-5", elementary: "8-10" };

export function parseKidAge(value: string | null | undefined): KidAge | null {
  if (!value) return null;
  if (LEGACY[value]) return LEGACY[value];
  return KID_AGE_OPTIONS.some((o) => o.value === value) ? (value as KidAge) : null;
}

function option(kid: KidAge) {
  return KID_AGE_OPTIONS.find((o) => o.value === kid)!;
}

export function kidAgeLabel(kid: KidAge): string {
  return option(kid).label;
}

export interface AgeFields {
  target_age_group?: TargetAgeGroup | null;
  age_min?: number | null;
  age_max?: number | null;
}

/** 범위가 이보다 넓으면("3세 이상" 등) 갈 수는 있어도 '딱 맞는' 행사로 보지 않는다 */
const SNUG_SPAN = 6;

/**
 * 행사와 우리 아이: 'fit'(딱 맞음) · 'mismatch'(대상 나이가 다름) · null(누구나·넓은 범위·정보 없음).
 */
export function ageFit(event: AgeFields, kid: KidAge | null): "fit" | "mismatch" | null {
  if (!kid) return null;
  const { years, group } = option(kid);
  if (event.age_min != null || event.age_max != null) {
    const lo = event.age_min ?? 0;
    const hi = event.age_max ?? 99;
    if (hi < years[0] || lo > years[1]) return "mismatch";
    return hi - lo <= SNUG_SPAN ? "fit" : null;
  }
  const target = event.target_age_group;
  if (!target || target === "all") return null;
  return target === group ? "fit" : "mismatch";
}

/**
 * 다른 연령 대상 행사만 뒤로 보낸다 (나머지 순서는 그대로).
 * '딱 맞는' 행사를 맨 앞으로 끌어올리면 날짜·마감 기준 추천 순서가 크게 흐트러져서 하지 않는다.
 */
export function preferKidAge<T extends AgeFields>(events: T[], kid: KidAge | null): T[] {
  if (!kid) return events;
  const keep = events.filter((e) => ageFit(e, kid) !== "mismatch");
  if (keep.length === events.length) return events;
  return [...keep, ...events.filter((e) => ageFit(e, kid) === "mismatch")];
}
