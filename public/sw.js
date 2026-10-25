/*
 * EventNow 서비스 워커 — 홈 화면 앱이 연결이 약하거나 없어도 열리게.
 *
 * - 페이지: 인터넷 먼저(항상 최신 행사), 안 되면 전에 본 같은 주소의 화면, 그것도 없으면 /offline
 * - /_next/static (빌드 파일): 한 번 받으면 재사용 (파일 이름에 해시가 있어 바뀌면 새 이름)
 * - 사진(/_next/image, 앱 아이콘): 저장본을 바로 보여주고 뒤에서 새로 받기
 * - /api, /og, Next 내부 데이터 요청(RSC)은 건드리지 않는다
 *
 * 배포마다 빌드 파일 이름이 바뀌어도 저장본이 끝없이 쌓이지 않게 개수를 제한하고,
 * 연결 끊김 화면(과 그 화면의 파일)은 따로 두어 지워지지 않게 한 뒤 하루 한 번 새로 받는다.
 * 저장 방식을 크게 바꿀 때는 VERSION을 올리면 옛 저장본이 지워진다.
 */
const VERSION = "v3";
const STATIC_CACHE = `eventnow-static-${VERSION}`;
const PAGE_CACHE = `eventnow-pages-${VERSION}`;
const IMAGE_CACHE = `eventnow-images-${VERSION}`;
const OFFLINE_CACHE = `eventnow-offline-${VERSION}`;
const KEEP = [STATIC_CACHE, PAGE_CACHE, IMAGE_CACHE, OFFLINE_CACHE];
const OFFLINE_URL = "/offline";
const MAX_PAGES = 40;
const MAX_IMAGES = 150;
// 한 번 배포분의 화면 파일은 100개 안팎 — 몇 번 배포분까지만 남긴다
const MAX_STATIC = 400;
const OFFLINE_REFRESH_MS = 24 * 60 * 60 * 1000;

/**
 * 연결 끊김 화면은 그 화면이 쓰는 스크립트·스타일까지 저장해야 오프라인에서 열린다
 * (HTML만 있으면 Next가 필요한 파일을 못 받아 오류 화면이 뜬다).
 * 새로 받은 게 완전할 때만 바꿔 넣어, 중간에 실패해도 이전 저장본이 남는다.
 */
async function precacheOffline() {
  const response = await fetch(OFFLINE_URL, { cache: "no-store" });
  if (!response.ok) return;
  const html = await response.clone().text();
  const assets = [
    ...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)].map((m) => m[1])),
  ];
  const files = await Promise.all(
    [...assets, "/app-icon/192.png"].map(async (url) => [url, await fetch(url)]),
  );
  if (files.some(([, r]) => !r.ok)) return;
  await caches.delete(OFFLINE_CACHE);
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.put(OFFLINE_URL, response);
  await Promise.all(files.map(([url, r]) => cache.put(url, r)));
  await cache.put("/__refreshed", new Response(String(Date.now())));
}

/** 배포가 바뀌어도 연결 끊김 화면이 최신이 되게, 하루 한 번 뒤에서 다시 받는다 */
async function refreshOfflineIfStale() {
  const cache = await caches.open(OFFLINE_CACHE);
  const stamp = await cache.match("/__refreshed");
  const at = stamp ? Number(await stamp.text()) : 0;
  if (Date.now() - at > OFFLINE_REFRESH_MS) await precacheOffline().catch(() => {});
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheOffline().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("eventnow-") && !KEEP.includes(n)).map((n) => caches.delete(n)),
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

/** 오래된 것부터 지워 개수 제한 */
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function handleNavigation(event) {
  const { request } = event;
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || (await fetch(request));
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      event.waitUntil(
        caches
          .open(PAGE_CACHE)
          .then((cache) => cache.put(request, copy))
          .then(() => trim(PAGE_CACHE, MAX_PAGES))
          .then(refreshOfflineIfStale),
      );
    }
    return response;
  } catch {
    // 전에 본 같은 주소만 저장본으로 — 다른 화면(첫 화면 등)을 대신 보여주면 주소와 내용이 어긋난다.
    // 처음 보는 주소는 연결 끊김 안내 (거기서 '첫 화면으로'를 누르면 저장된 첫 화면이 열린다)
    const pages = await caches.open(PAGE_CACHE);
    const offline = await caches.open(OFFLINE_CACHE);
    return (
      (await pages.match(request)) ||
      (await offline.match(OFFLINE_URL)) ||
      new Response("오프라인", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
    );
  }
}

async function cacheFirst(event) {
  const { request } = event;
  // 연결 끊김 화면용 저장본까지 함께 찾는다
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    event.waitUntil(
      caches
        .open(STATIC_CACHE)
        .then((cache) => cache.put(request, copy))
        .then(() => trim(STATIC_CACHE, MAX_STATIC)),
    );
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then((response) => {
      if (response.ok) {
        cache.put(event.request, response.clone()).then(() => trim(IMAGE_CACHE, MAX_IMAGES));
      }
      return response;
    })
    .catch(() => hit);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/og/")) return;
  // Next 클라이언트 이동용 데이터(RSC) — 실패하면 Next가 전체 페이지 이동으로 바꾸고, 그건 아래 navigate가 받는다
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event));
    return;
  }
  if (url.pathname.startsWith("/_next/image") || url.pathname.startsWith("/app-icon/")) {
    event.respondWith(staleWhileRevalidate(event));
  }
});
