import { parseCourse } from "@/lib/course-page";
import { getEventsSnapshot } from "@/lib/events-data";
import { renderOgCard } from "@/lib/og";

/** 하루 코스 링크 미리보기 그림: "10.24(토) 하루 코스 · 3곳" + 들를 곳 순서 */
export async function GET(request: Request) {
  const { events } = await getEventsSnapshot();
  const course = parseCourse(new URL(request.url).searchParams, events);
  if (!course) return new Response("not found", { status: 404 });
  const lines = course.description
    .split(" → ")
    .slice(0, 3)
    .map((t, i) => `${i + 1}. ${t.length > 24 ? `${t.slice(0, 23)}…` : t}`);
  const [eyebrow, rest] = course.title.split(" 하루 코스");
  const image = await renderOgCard({
    eyebrow,
    title: `하루 코스${rest}`,
    lines,
  });
  image.headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
  return image;
}
