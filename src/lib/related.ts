import { computeStatus, todayKst } from "@/lib/dates";
import { detectSubregion, regionShortLabel } from "@/data/regions";
import {
  DEFAULT_EXPLORER_FILTERS,
  filtersToQueryString,
  sortEvents,
  toListItem,
} from "@/lib/events";
import { isHttpUrl } from "@/lib/images";
import type { Event, EventListItem } from "@/types/event";

const SIZE = 10;

export interface RelatedShelf {
  title: string;
  hint: string;
  items: EventListItem[];
  seeAllHref: string;
}

function rank(list: Event[], today: string): Event[] {
  const sorted = sortEvents(list, "recommended", today);
  return [
    ...sorted.filter((e) => isHttpUrl(e.thumbnail_url)),
    ...sorted.filter((e) => !isHttpUrl(e.thumbnail_url)),
  ];
}

/**
 * 상세 페이지 아래 '같은 지역 다른 행사' · '비슷한 행사' — 다 보고 나서 다음으로 이어지게.
 * 같은 구·시가 있으면 그 안에서 먼저 찾는다.
 */
export function relatedShelves(
  event: Event,
  all: Event[],
  today: string = todayKst(),
): RelatedShelf[] {
  const open = all.filter(
    (e) => e.id !== event.id && computeStatus(e.start_date, e.end_date, today) !== "ended",
  );
  const sub = detectSubregion(event.region, event.address ?? "", event.district);
  const sameRegion = open.filter((e) => e.region === event.region);
  const sameSub = sub
    ? sameRegion.filter((e) => detectSubregion(e.region, e.address ?? "", e.district) === sub)
    : [];
  const nearby = [...rank(sameSub, today), ...rank(sameRegion.filter((e) => !sameSub.includes(e)), today)];
  const nearbyItems = nearby.slice(0, SIZE);
  const used = new Set(nearbyItems.map((e) => e.id));

  const similar = rank(
    open.filter((e) => e.category === event.category && !used.has(e.id)),
    today,
  ).slice(0, SIZE);

  const shortRegion = regionShortLabel(event.region);
  const shelves: RelatedShelf[] = [
    {
      title: `${sub ?? shortRegion}의 다른 행사`,
      hint: sub ? `${shortRegion} ${sub} 근처부터` : `${shortRegion}에서 열리는 행사`,
      items: nearbyItems.map((e) => toListItem(e, null, today)),
      seeAllHref: `/${filtersToQueryString({
        ...DEFAULT_EXPLORER_FILTERS,
        region: event.region,
        subregion: sub ?? "all",
      })}`,
    },
    {
      title: "비슷한 행사",
      hint: "같은 종류의 다른 행사",
      items: similar.map((e) => toListItem(e, null, today)),
      seeAllHref: `/${filtersToQueryString({ ...DEFAULT_EXPLORER_FILTERS, category: event.category })}`,
    },
  ];
  return shelves.filter((s) => s.items.length >= 2);
}
