import { searchParamsToFilters } from "@/lib/events";
import { getEventsSnapshot } from "@/lib/events-data";
import { describeList } from "@/lib/list-meta";
import { renderOgCard } from "@/lib/og";

/**
 * 목록 링크 미리보기 그림: /og/list?when=weekend&region=… → "부산 · 이번 주말 갈 만한 곳 14곳".
 * 글자는 쿼리를 그대로 쓰지 않고 필터로 다시 계산한다 (아무 문구나 그림으로 만들 수 없게).
 * 조건이 없으면 사이트 기본 소개 그림.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = searchParamsToFilters(params);
  const { events } = await getEventsSnapshot();
  const meta = describeList(filters, events);

  const image = meta
    ? await renderOgCard({
        eyebrow: meta.eyebrow,
        title: meta.title,
        lines: meta.lines.map((l) => (l.length > 26 ? `${l.slice(0, 25)}…` : l)),
      })
    : await renderOgCard({
        eyebrow: "축제 · 전시 · 팝업 · 키즈 체험",
        title: "이번 주말, 아이랑 어디 가지?",
        lines: ["전국 행사를 날짜·지역·가족 조건으로 골라보세요"],
      });
  // 메신저 미리보기 서버가 여러 번 가져가도 매번 그리지 않게 (데이터는 하루 한 번 바뀜)
  image.headers.set("Cache-Control", "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400");
  return image;
}
