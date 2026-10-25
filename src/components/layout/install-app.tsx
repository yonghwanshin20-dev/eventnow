"use client";

import { useEffect, useState } from "react";
import { Download, Plus, Share, SquareArrowOutUpRight, X } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  dismissInstall,
  installDismissed,
  openInExternalBrowser,
  promptInstall,
  registerServiceWorker,
  useInstallMode,
  type InstallMode,
} from "@/lib/pwa";

/** 레이아웃에 한 번: 서비스 워커 등록 (오프라인에서도 열리게) */
export function AppBootstrap() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}

/** 설치 창이 없는 환경(아이폰·카톡·기타 브라우저)용 단계 안내 */
function InstallGuide({
  mode,
  open,
  onOpenChange,
}: {
  mode: InstallMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-lg gap-0 rounded-t-3xl bg-white p-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="px-5 pt-5 pb-2">
          <SheetTitle className="text-lg font-bold">EventNow 앱으로 쓰기</SheetTitle>
          <SheetDescription className="text-sm text-stone-600">
            홈 화면 아이콘으로 바로 열리고, 주소창 없이 앱처럼 보여요. 설치비·스토어 없이 무료예요.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-3 px-5 pt-2 pb-3">
          {mode === "inapp" ? (
            <>
              <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                카카오톡·인스타그램 안에서 연 화면에서는 홈 화면에 추가할 수 없어요.
                <br />
                먼저 기본 브라우저(사파리·크롬)로 연 다음, 위의 <b>앱 설치</b>를 다시 눌러 주세요.
              </p>
              <button
                type="button"
                onClick={() => openInExternalBrowser()}
                className="flex h-12 w-full items-center justify-center gap-1.5 rounded-xl bg-stone-900 text-[15px] font-semibold text-white"
              >
                <SquareArrowOutUpRight className="size-4" aria-hidden />
                브라우저로 열기
              </button>
            </>
          ) : mode === "ios" ? (
            <ol className="space-y-2.5 text-[15px] text-stone-800">
              <Step n={1}>
                화면 아래(아이패드는 위)의 <Share className="inline size-4 align-[-2px] text-sky-600" aria-label="공유" />{" "}
                <b>공유</b> 버튼을 눌러요
              </Step>
              <Step n={2}>
                목록을 내려 <Plus className="inline size-4 align-[-2px]" aria-hidden /> <b>홈 화면에 추가</b>를 눌러요
              </Step>
              <Step n={3}>
                오른쪽 위 <b>추가</b>를 누르면 끝!
              </Step>
            </ol>
          ) : (
            <ol className="space-y-2.5 text-[15px] text-stone-800">
              <Step n={1}>
                브라우저 오른쪽 위(또는 아래)의 <b>메뉴 ⋮</b>를 눌러요
              </Step>
              <Step n={2}>
                <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요
              </Step>
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-bold text-white">
        {n}
      </span>
      <span className="leading-6">{children}</span>
    </li>
  );
}

/** 설치 시작: 안드로이드는 바로 설치 창, 나머지는 안내 시트 */
function useInstallAction() {
  const mode = useInstallMode();
  const [guideOpen, setGuideOpen] = useState(false);
  const start = async () => {
    if (mode === "prompt") {
      await promptInstall();
      return;
    }
    setGuideOpen(true);
  };
  const guide = <InstallGuide mode={mode} open={guideOpen} onOpenChange={setGuideOpen} />;
  return { mode, start, guide };
}

/** 헤더 오른쪽 '앱 설치' (설치돼 있으면 안 보임) */
export function InstallButton() {
  const { mode, start, guide } = useInstallAction();
  if (mode === "installed") return null;
  return (
    <>
      <button
        type="button"
        onClick={start}
        className="inline-flex h-8 items-center gap-1 rounded-full bg-teal-700 px-3 text-[13px] font-semibold text-white active:bg-teal-800"
      >
        <Download className="size-3.5" aria-hidden />앱 설치
      </button>
      {guide}
    </>
  );
}

/**
 * 첫 화면을 잠깐 둘러본 뒤(20초) 아래에 뜨는 설치 권유. 닫으면 2주 동안 안 뜬다.
 * 바로 띄우면 무엇인지 보기도 전에 가려서, 둘러본 다음에 보여준다.
 */
export function InstallBanner() {
  const { mode, start, guide } = useInstallAction();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (mode === "installed" || installDismissed()) return;
    const t = setTimeout(() => setShow(true), 20_000);
    return () => clearTimeout(t);
  }, [mode]);

  if (!show || mode === "installed") return guide;
  return (
    <>
      <div
        role="dialog"
        aria-label="앱 설치 안내"
        className="fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-stone-900 px-4 py-3 text-white shadow-xl lg:bottom-6"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-lg font-bold">
          E<span className="text-amber-400">.</span>
        </span>
        <p className="min-w-0 flex-1 text-[13.5px] leading-5">
          <span className="block font-semibold">EventNow 앱으로 쓰기</span>
          <span className="block text-white/70">홈 화면에서 바로 열려요 · 무료</span>
        </p>
        <button
          type="button"
          onClick={() => {
            setShow(false);
            start();
          }}
          className="h-9 shrink-0 rounded-full bg-white px-3.5 text-[13px] font-semibold text-stone-900"
        >
          {mode === "prompt" ? "설치" : "방법 보기"}
        </button>
        <button
          type="button"
          aria-label="설치 안내 닫기"
          onClick={() => {
            dismissInstall();
            setShow(false);
          }}
          className="-mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-white/60"
        >
          <X className="size-4" />
        </button>
      </div>
      {guide}
    </>
  );
}
