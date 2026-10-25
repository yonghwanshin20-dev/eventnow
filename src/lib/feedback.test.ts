import { describe, expect, it, vi } from "vitest";

import { buildIssue, createIssue, feedbackHref, getFeedbackConfig, validateFeedback } from "./feedback";

describe("validateFeedback", () => {
  it("행사 제보는 이름과 날짜·장소 중 하나가 필요하다", () => {
    expect(validateFeedback({ type: "event", reportTitle: "다가가다 가족축제" })).toEqual({
      ok: false,
      error: "날짜나 장소 중 하나는 적어 주세요.",
    });
    const ok = validateFeedback({ type: "event", reportTitle: "다가가다 가족축제", reportPlace: "홍제폭포" });
    expect(ok.ok).toBe(true);
  });

  it("오류 신고·건의는 5자 이상", () => {
    expect(validateFeedback({ type: "bug", message: "틀림" }).ok).toBe(false);
    expect(validateFeedback({ type: "idea", message: "맛집 지도도 있으면 좋겠어요" }).ok).toBe(true);
    expect(validateFeedback({ type: "spam", message: "aaaaaa" }).ok).toBe(false);
  });

  it("링크는 http 주소만, 긴 글은 자른다", () => {
    expect(validateFeedback({ type: "event", reportTitle: "x", reportDate: "10/24", reportLink: "javascript:alert(1)" }).ok).toBe(false);
    const r = validateFeedback({ type: "idea", message: "가".repeat(5000) });
    expect(r.ok && r.value.message.length).toBe(2000);
  });
});

describe("buildIssue", () => {
  it("제목·라벨을 정하고 사용자 글은 인용 블록, @멘션은 끊는다", () => {
    const issue = buildIssue(
      { type: "bug", message: "날짜가 달라요 @someone", eventId: "abc", eventTitle: "광릉숲축제" },
      "https://eventnow.vercel.app",
    );
    expect(issue.title).toBe("[오류 신고] 광릉숲축제");
    expect(issue.labels).toEqual(["feedback", "bug"]);
    expect(issue.body).toContain("https://eventnow.vercel.app/events/abc");
    expect(issue.body).toContain("> 날짜가 달라요 @​someone");
  });
});

describe("createIssue", () => {
  it("라벨 권한이 없으면 라벨 없이 다시 보낸다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 422 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ number: 7 }), { status: 201 }));
    const out = await createIssue({ token: "t", repo: "a/b" }, { title: "t", body: "b", labels: ["x"] }, fetchImpl);
    expect(out.number).toBe(7);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ title: "t", body: "b" });
  });
});

describe("설정·링크", () => {
  it("토큰과 저장소가 있어야 켜진다", () => {
    expect(getFeedbackConfig({})).toBeNull();
    expect(
      getFeedbackConfig({ FEEDBACK_GITHUB_TOKEN: "x", VERCEL_GIT_REPO_OWNER: "o", VERCEL_GIT_REPO_SLUG: "r" }),
    ).toEqual({ token: "x", repo: "o/r" });
  });

  it("행사 화면에서 오류 신고로", () => {
    expect(feedbackHref({ id: "e1", title: "축제" })).toBe("/feedback?type=bug&event=e1&title=%EC%B6%95%EC%A0%9C");
  });
});
