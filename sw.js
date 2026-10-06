/* 오프라인에서도 일정을 볼 수 있게 앱 파일과 사진을 캐시해요. */
const VERSION = 'hkbkk-v9';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/data.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const RUNTIME = `${VERSION}-runtime`;

self.addEventListener('install', (e) => {
  // 한 파일이 실패해도(예: 안드로이드 앱의 폴더 주소) 나머지는 저장해요
  e.waitUntil(caches.open(VERSION)
    .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 앱 파일: 네트워크 우선, 실패하면 캐시
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }

  // 사진·글꼴: 캐시 우선, 없으면 받아서 저장
  const cacheable = /(^|\.)wikimedia\.org$/.test(url.hostname)
    || url.hostname === 'cdn.jsdelivr.net'
    || url.hostname === 'fonts.googleapis.com'
    || url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;
  e.respondWith(
    caches.open(RUNTIME).then((c) => c.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') c.put(req, res.clone());
        return res;
      });
    })),
  );
});
