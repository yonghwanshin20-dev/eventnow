"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ComponentProps } from "react";

import { lastListHref } from "@/lib/last-list";

/** 첫 화면 링크 — 다른 화면(피드백·맛집·상세)에서 누르면 보던 목록(필터)으로 돌아간다.
 * 첫 화면에서 누르면 그대로 처음 화면(필터 없음)으로. */
export function HomeLink({ onClick, ...props }: Omit<ComponentProps<typeof Link>, "href">) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <Link
      {...props}
      href="/"
      onClick={(e) => {
        onClick?.(e);
        const href = lastListHref();
        if (e.defaultPrevented || pathname === "/" || href === "/" || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        router.push(href);
      }}
    />
  );
}
