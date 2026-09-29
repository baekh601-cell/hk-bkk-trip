import { DAYS, TRIP, PHOTOS, KIND, CITY, BRANCH } from './data.js';

/* ---------- 작은 도구들 ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;
const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const mapUrl = (q) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);

const store = {
  get(k, d) { try { const v = localStorage.getItem('hkbkk:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hkbkk:' + k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } },
};

/* ---------- 햅틱 ---------- */
const Haptic = {
  on: store.get('haptic', true),
  fire(p) {
    if (!this.on || !('vibrate' in navigator)) return;
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return; // 첫 터치 전에는 브라우저가 막아요
    try { navigator.vibrate(p); } catch { /* 무시 */ }
  },
  tap() { this.fire(8); },
  select() { this.fire(14); },
  nav() { this.fire([6, 32, 10]); },
  swipe() { this.fire([10, 24, 16]); },
  success() { this.fire([12, 60, 22]); },
  edge() { this.fire([28]); },
  sheet() { this.fire(18); },
};

/* ---------- 시간 ---------- */
const NOW_OVERRIDE = new URLSearchParams(location.search).get('now');
const now = () => (NOW_OVERRIDE ? new Date(NOW_OVERRIDE) : new Date());
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysBetween = (a, b) => Math.round((Date.UTC(...b.split('-').map((v, i) => (i === 1 ? v - 1 : +v))) - Date.UTC(...a.split('-').map((v, i) => (i === 1 ? v - 1 : +v)))) / 864e5);
const fmtDate = (iso, dow) => { const [, m, d] = iso.split('-').map(Number); return `${m}월 ${d}일${dow ? ` (${dow})` : ''}`; };
const shortDate = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${m}/${d}`; };

function flat(day) {
  const out = [];
  day.periods.forEach((p, pi) => p.events.forEach((e) => out.push({ ...e, pi, period: p.label, i: out.length })));
  return out;
}

function tripState() {
  const d = now();
  const ds = dateStr(d);
  const mins = d.getHours() * 60 + d.getMinutes();
  if (ds < TRIP.start) return { phase: 'before', dday: daysBetween(ds, TRIP.start), mins, ds };
  if (ds > TRIP.end) return { phase: 'after', mins, ds };
  const day = DAYS.find((x) => x.date === ds);
  const evs = flat(day);
  const current = evs.filter((e) => toMin(e.s) <= mins && mins < toMin(e.e));
  const next = evs.find((e) => toMin(e.s) > mins);
  return { phase: 'during', day, current, next, mins, ds };
}

function defaultDay() {
  const st = tripState();
  return st.phase === 'during' ? st.day.n : st.phase === 'after' ? 8 : 1;
}

/* ---------- 확인 목록(이 기기에만 저장) ---------- */
const checked = new Set(store.get('checks', []));
function checkItem(key, text) {
  const on = checked.has(key);
  return `<li><button type="button" class="check ${on ? 'is-done' : ''}" data-check="${key}" aria-pressed="${on}"><i aria-hidden="true">${icon('check')}</i><span>${esc(text)}</span></button></li>`;
}

/* ---------- 사진 ---------- */
function photo(key, { city = '', cls = '', eager = false, vt = '' } = {}) {
  const p = PHOTOS[key];
  if (!p) return `<div class="ph ${city} ${cls}"></div>`;
  const load = eager ? 'fetchpriority="high"' : 'loading="lazy"';
  const vtStyle = vt ? ` style="view-transition-name:${vt}"` : '';
  return `<div class="ph ${city} ${cls}"><img src="${p.src}" alt="${esc(p.alt)}" ${load} decoding="async" referrerpolicy="no-referrer"${vtStyle}></div>`;
}
function settleImages(root = document) {
  $$('img', root).forEach((img) => {
    if (img.complete) img.classList.add(img.naturalWidth ? 'is-loaded' : 'is-broken');
  });
}
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('is-loaded'); }, true);
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('is-broken'); }, true);

/* ---------- 라우터 ---------- */
const view = $('#view');
const topbar = $('#topbar');
const tabbar = $('#tabbar');
let route = null;
let homeScroll = 0;
let morphDay = 0;
let pendingFocus = null;
let branchFilter = store.get('branch', 'all');

function parse(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { page: 'home' };
  if (parts[0] === 'day') {
    const n = parseInt(parts[1], 10);
    return n >= 1 && n <= DAYS.length ? { page: 'day', n } : { page: 'day', n: defaultDay(), fix: true };
  }
  if (parts[0] === 'stay') return { page: 'stay' };
  if (parts[0] === 'tools') return { page: 'tools' };
  return { page: 'home' };
}
const rank = (r) => ({ home: 0, day: 1 + r.n / 10, stay: 2, tools: 3 }[r.page]);

function onRoute() {
  const next = parse(location.hash);
  if (next.fix) { history.replaceState(null, '', `#/day/${next.n}`); }
  const prev = route;
  if (prev && prev.page === next.page && prev.n === next.n) return;
  closeSheet(true);

  let dir = 'fade';
  if (prev) {
    if (prev.page === 'day' && next.page === 'day') dir = next.n > prev.n ? 'fwd' : 'back';
    else if (prev.page === 'home' && next.page === 'day') dir = morphDay ? 'fade' : 'fwd';
    else if (prev.page === 'day' && next.page === 'home') dir = 'fade';
    else dir = rank(next) > rank(prev) ? 'fwd' : 'back';
  }
  if (prev?.page === 'home') homeScroll = scrollY;

  // 일정 → 홈으로 돌아갈 때 대표 사진이 보드의 핀으로 돌아가요
  let morphBack = 0;
  if (prev?.page === 'day' && next.page === 'home' && scrollY < innerHeight * 0.6) {
    const heroImg = $('.day-hero img');
    if (heroImg) { heroImg.style.viewTransitionName = 'hero-media'; morphBack = prev.n; }
  }

  const update = () => {
    route = next;
    render(next);
    const y = next.page === 'home' && prev ? homeScroll : 0;
    window.scrollTo({ top: y, behavior: 'instant' });
    afterRender(next);
    if (morphBack) {
      const pinImg = $(`.pin[data-day="${morphBack}"] img`);
      const r = pinImg?.getBoundingClientRect();
      if (r && r.bottom > 0 && r.top < innerHeight) pinImg.style.viewTransitionName = 'hero-media';
      else $('.day-hero img')?.style.removeProperty('view-transition-name');
    }
  };

  if (!prev) { update(); return; }
  Haptic.nav();
  if (document.startViewTransition && !reduceMotion.matches) {
    document.documentElement.dataset.dir = dir;
    const t = document.startViewTransition(update);
    t.ready.catch(() => { /* 빠르게 연달아 이동하면 앞 전환이 취소돼요 */ });
    t.finished.catch(() => {}).finally(() => {
      $$('[style*="view-transition-name"]').forEach((el) => { el.style.viewTransitionName = ''; });
      morphDay = 0;
    });
  } else {
    update();
    morphDay = 0;
    view.classList.remove('fallback-in', 'fallback-in-back', 'fallback-fade');
    void view.offsetWidth;
    view.classList.add(dir === 'fwd' ? 'fallback-in' : dir === 'back' ? 'fallback-in-back' : 'fallback-fade');
  }
}

function render(r) {
  view.dataset.page = r.page;
  if (r.page === 'home') view.innerHTML = renderHome();
  else if (r.page === 'day') view.innerHTML = renderDay(r.n);
  else if (r.page === 'stay') view.innerHTML = renderStay();
  else view.innerHTML = renderTools();
  updateChrome(r);
}

function afterRender(r) {
  settleImages(view);
  observeReveal();
  if (r.page === 'home') { setupBoard(); animateCounters(); }
  if (r.page === 'day') {
    if (pendingFocus) { const t = pendingFocus; pendingFocus = null; requestAnimationFrame(() => focusEventAt(t)); }
    prefetchNeighbors(r.n);
  }
  if (r.page === 'tools') setupTools();
  if (r.page === 'home' || r.page === 'tools') startClocks();
  onScroll();
}

/* ---------- 상단·하단·레일 ---------- */
function buildRail() {
  const dayLinks = DAYS.map((d) => `
    <a href="#/day/${d.n}" data-rail="day-${d.n}">
      <span class="rd">${d.n}</span>
      <span class="rt">${esc(d.title)}<small>${fmtDate(d.date, d.dow)} · ${esc(d.route)}</small></span>
      <span class="cdot" style="background:var(--${d.city})"></span>
    </a>`).join('');
  $('#rail').innerHTML = `
    <a class="brand" href="#/" aria-label="홈으로"><span class="brand-mark" aria-hidden="true"></span><span class="brand-text">HK <i>&amp;</i> BKK <b>2026</b></span></a>
    <a href="#/" data-rail="home">${icon('home')}<span>여행 보드</span></a>
    <div class="rail-h">일정 · 7박 8일</div>
    ${dayLinks}
    <div class="rail-h">안내</div>
    <a href="#/stay" data-rail="stay">${icon('bed')}<span>숙소·항공</span></a>
    <a href="#/tools" data-rail="tools">${icon('tools')}<span>여행 도구</span></a>`;
}

function updateChrome(r) {
  const key = r.page === 'day' ? 'day' : r.page;
  const tabs = $$('[data-tab]', tabbar);
  tabs.forEach((a, i) => {
    const on = a.dataset.tab === key;
    if (on) { a.setAttribute('aria-current', 'page'); $('.tab-ink', tabbar).style.transform = `translateX(${i * 100}%)`; }
    else a.removeAttribute('aria-current');
  });
  const railKey = r.page === 'day' ? `day-${r.n}` : r.page;
  $$('[data-rail]').forEach((a) => (a.dataset.rail === railKey ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));

  const t = $('#topbarTitle');
  const titles = { home: '', stay: '숙소·항공', tools: '여행 도구' };
  const text = r.page === 'day' ? `${r.n}일차 · ${DAYS[r.n - 1].title}` : titles[r.page];
  t.textContent = text;
  t.classList.toggle('has-text', !!text);
  document.title = r.page === 'day' ? `${r.n}일차 · ${DAYS[r.n - 1].title} | 홍콩·방콕 2026` : '홍콩·방콕 2026 · 우리의 여행';
  tabbar.classList.remove('is-hidden');
}

function updateClockBadge() {
  const st = tripState();
  const el = $('#topbarClock');
  el.textContent = st.phase === 'before' ? `D-${st.dday}` : st.phase === 'during' ? `${st.day.n}일차 · ${pad(now().getHours())}:${pad(now().getMinutes())}` : '다녀왔어요';
}

let lastY = 0;
let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const y = scrollY;
    const hero = $('.hero, .day-hero', view);
    const limit = hero ? hero.offsetHeight - 90 : -1;
    topbar.classList.toggle('is-solid', y > limit);
    if (hero && y < hero.offsetHeight && !reduceMotion.matches) {
      const media = $('.hero-media, .day-hero > .ph', hero);
      if (media) media.style.transform = `translate3d(0, ${y * 0.32}px, 0)`;
    }
    if (Math.abs(y - lastY) > 6) {
      tabbar.classList.toggle('is-hidden', y > lastY && y > 240 && !sheetOpen);
      lastY = y;
    }
  });
}
addEventListener('scroll', onScroll, { passive: true });

/* ---------- 등장 모션 ---------- */
let io;
function observeReveal() {
  io?.disconnect();
  io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  $$('.reveal', view).forEach((el) => io.observe(el));
}

function animateCounters() {
  $$('[data-count]', view).forEach((el) => {
    const target = +el.dataset.count;
    if (reduceMotion.matches) { el.textContent = target; return; }
    const t0 = performance.now();
    const dur = 1100;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ==========================================================================
   홈
   ========================================================================== */
const dotDate = (iso) => iso.slice(5).replace('-', '.');

function routeSVG() {
  const path = 'M30,70 Q120,0 210,70 Q300,140 390,70 Q480,0 570,70';
  const [a, b, c, d] = TRIP.route;
  const nodes = [
    { x: 30, code: 'ICN', sub: `${dotDate(a)} 서울`, cls: '', up: false },
    { x: 210, code: 'HKG', sub: `${dotDate(b)} 홍콩`, cls: 'hk', up: true },
    { x: 390, code: 'BKK', sub: `${dotDate(c)} 방콕`, cls: 'bkk', up: false },
    { x: 570, code: 'ICN', sub: `${dotDate(d)} 귀국`, cls: '', up: true },
  ];
  const plane = reduceMotion.matches ? '' : `
    <g><path d="M-9,-3 L6,-1 L10,0 L6,1 L-9,3 L-6,0 Z M-2,-1 L-6,-8 L-3,-8 L3,-1 Z M-2,1 L-6,8 L-3,8 L3,1 Z" fill="#fff"/>
      <animateMotion dur="9s" begin="1.4s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="linear" path="${path}"/></g>`;
  return `<svg viewBox="0 -8 600 160" role="img" aria-label="서울에서 홍콩, 방콕을 거쳐 서울로 돌아오는 경로">
    <path class="track" d="${path}"/>
    <path class="draw" d="${path}" pathLength="1"/>
    ${nodes.map((n) => `
      <circle class="node ${n.cls}" cx="${n.x}" cy="70" r="7"/>
      <text class="code" x="${n.x}" y="${n.up ? 44 : 104}" text-anchor="${n.x < 60 ? 'start' : n.x > 540 ? 'end' : 'middle'}">${n.code}</text>
      <text class="sub" x="${n.x}" y="${n.up ? 28 : 120}" text-anchor="${n.x < 60 ? 'start' : n.x > 540 ? 'end' : 'middle'}">${n.sub}</text>`).join('')}
    ${plane}
  </svg>`;
}

function nowCard() {
  const st = tripState();
  let pulse = icon('plane'); let live = ''; let label; let title; let sub; let href;
  if (st.phase === 'before') {
    label = `여행까지 D-${st.dday}`;
    const d1 = DAYS[0];
    const first = d1.periods[0].events[0];
    title = `첫 일정 · ${fmtDate(d1.date, d1.dow)} ${first.s}`;
    sub = `${first.t} → ${d1.stops[0][0]} ${d1.stops[0][1]}`;
    href = '#/day/1';
  } else if (st.phase === 'during') {
    live = 'live'; pulse = icon('clock');
    const cur = st.current.filter((e) => !e.br || branchFilter === 'all' || e.br === branchFilter)[0];
    label = `지금 · ${st.day.n}일차 ${CITY[st.day.city].label}`;
    title = cur ? `${cur.s} ${cur.t}` : st.next ? `다음 · ${st.next.s} ${st.next.t}` : '오늘 일정을 마쳤어요';
    sub = cur && st.next ? `다음 · ${st.next.s} ${st.next.t}` : st.day.title;
    href = `#/day/${st.day.n}`;
  } else {
    label = '여행 완료';
    title = '함께여서 좋았던 8일';
    sub = '일정을 다시 둘러볼 수 있어요';
    href = '#/day/1';
  }
  return `<a class="now-card pressable reveal" href="${href}" data-now>
    <span class="now-pulse ${live}">${pulse}</span>
    <span><span class="label">${esc(label)}</span><span class="title" style="display:block">${esc(title)}</span><span class="sub" style="display:block">${esc(sub)}</span></span>
    <span class="go">${icon('right')}</span>
  </a>`;
}

const AR = ['4 / 5', '3 / 4', '1 / 1', '4 / 5', '2 / 3', '3 / 4', '4 / 5', '1 / 1'];

function dayPin(d, i) {
  const count = flat(d).length;
  const cityChip = `<span class="chip glass">${esc(CITY[d.city].label)}</span>`;
  const badge = d.birthday ? `<span class="pin-badge" aria-label="생일">${icon('cake')}</span>` : '';
  return `<div class="pin pin-day reveal" data-day="${d.n}" data-city="${d.city}" style="--d:${(i % 4) * 0.06}s">
    <a class="pin-inner pressable" href="#/day/${d.n}" data-morph="${d.n}">
      ${photo(d.cover, { city: d.city, cls: '', eager: i < 2 })}
      <div class="pin-top">${cityChip}</div>${badge}
      <div class="pin-over">
        <div class="pin-num">${pad(d.n)}<small>DAY</small></div>
        <h3>${esc(d.title)}</h3>
        <div class="pin-date">${fmtDate(d.date, d.dow)} · ${esc(d.route)}</div>
      </div>
    </a>
    <div class="sr-only">${esc(d.location)}</div>
  </div>`.replace('<div class="ph', `<div style="--ar:${AR[i % AR.length]}" class="ph`);
}

function flightPin(f, i) {
  const cities = [f.from === 'HKG' ? 'hk' : f.from === 'BKK' ? 'bkk' : 'seoul', f.to === 'HKG' ? 'hk' : f.to === 'BKK' ? 'bkk' : 'seoul'];
  return `<div class="pin pin-flight reveal" data-city="${cities.join(' ')}" style="--d:${(i % 4) * 0.06}s">
    <a class="pin-inner pressable" href="#/day/${f.day}" aria-label="${f.no} ${f.fromCity}에서 ${f.toCity}">
      <div class="air"><span>${esc(f.air)}</span><span>${f.no}</span></div>
      <div class="codes"><b>${f.from}</b>${icon('plane')}<b class="to">${f.to}</b></div>
      <div class="times"><span>${f.dep} ${esc(f.fromCity)}</span><span>${f.arr} ${esc(f.toCity)}</span></div>
      <div class="perf"></div>
      <div class="foot"><span>${esc(f.date)}</span><b>${f.day}일차</b></div>
    </a>
  </div>`;
}

function hotelPin(h, i) {
  return `<div class="pin pin-hotel reveal" data-city="${h.city}" style="--d:${(i % 4) * 0.06}s">
    <a class="pin-inner pressable" href="#/stay">
      ${photo(h.img, { city: h.city })}
      <div class="pin-body">
        <span class="chip ${h.city}">${icon('bed')} 숙소</span>
        <h3 style="margin-top:8px">${esc(h.name)}</h3>
        <div class="en">${esc(h.en)}</div>
        <div class="stay">${icon('cal')} ${esc(h.stay)}</div>
      </div>
    </a>
  </div>`;
}

function quotePin(q, i) {
  return `<div class="pin pin-quote reveal" data-city="${q.city}" style="--d:${(i % 4) * 0.06}s">
    <a class="pin-inner pressable ${q.tone || ''}" href="#/day/${q.day}">
      <div class="q">“${esc(q.text)}”</div>
      <div class="q-sub">${esc(q.sub)}</div>
    </a>
  </div>`;
}

function renderHome() {
  const [f1, f2, f3] = TRIP.flights;
  const [h1, h2, h3] = TRIP.hotels;
  const D = (n) => DAYS[n - 1];
  const [q1, q2, q3] = TRIP.quotes;
  const items = [
    ['day', D(1)], ['flight', f1], ['day', D(2)], ['quote', q1],
    ['day', D(3)], ['hotel', h1], ['day', D(4)], ['quote', q2],
    ['flight', f2], ['day', D(5)], ['hotel', h2], ['day', D(6)],
    ['quote', q3],
    ['day', D(7)], ['hotel', h3], ['day', D(8)], ['flight', f3],
  ];
  let di = 0;
  const pins = items.map(([type, v], i) => {
    if (type === 'day') return dayPin(v, di++);
    if (type === 'flight') return flightPin(v, i);
    if (type === 'hotel') return hotelPin(v, i);
    return quotePin(v, i);
  }).join('');

  const eventTotal = DAYS.reduce((a, d) => a + flat(d).length, 0);
  const st = tripState();
  const dday = st.phase === 'before' ? `<span class="dday">D-<b>${st.dday}</b></span>` : st.phase === 'during' ? `<span class="dday">여행 중 · <b>${st.day.n}</b>일차</span>` : '';

  const anchors = TRIP.anchors.map((a) => {
    const d = D(a.d);
    const isPast = st.ds > d.date || (st.ds === d.date && st.mins > toMin(a.s));
    return `<a class="anchor pressable reveal ${d.city} ${isPast ? 'is-past' : ''}" href="#/day/${a.d}" data-focus="${a.s}">
      <span class="when"><b>${a.s}</b><span>${shortDate(d.date)} ${d.dow}</span></span>
      <span class="what"><strong>${esc(a.t)}</strong><span>${esc(a.sub)}</span></span>
      <span class="bar"></span>
    </a>`;
  }).join('');

  return `
  <section class="hero">
    <div class="hero-media">${`<img src="${PHOTOS.peak.src.replace('1920px', '3840px')}" alt="${esc(PHOTOS.peak.alt)}" fetchpriority="high" decoding="async" referrerpolicy="no-referrer">`}</div>
    <div class="hero-inner">
      <p class="eyebrow">Hong Kong · Bangkok · 2026</p>
      <h1><span class="line"><span style="--d:.1s">두 도시,</span></span><span class="line"><span style="--d:.24s">우리만의 <em>속도</em>로.</span></span></h1>
      <div class="hero-meta">${dday}<span>${TRIP.start.replaceAll('-', '. ')} — ${TRIP.end.slice(5).replace('-', '. ')}</span></div>
      <div class="hero-meta sub"><span>${esc(TRIP.length)}</span><span class="dot"></span><span>${esc(TRIP.nights)}</span><span class="dot"></span><span>${esc(TRIP.travelers)}</span></div>
      <div class="route-graphic">${routeSVG()}</div>
    </div>
  </section>
  ${nowCard()}
  <div class="wrap">
    <div class="stats">
      <div class="stat reveal"><b data-count="8">8</b><span>일의 여정</span></div>
      <div class="stat reveal" style="--d:.06s"><b data-count="2">2</b><span>도시</span></div>
      <div class="stat reveal" style="--d:.12s"><b data-count="3">3</b><span>항공편</span></div>
      <div class="stat reveal" style="--d:.18s"><b data-count="${eventTotal}">${eventTotal}</b><span>개의 일정</span></div>
    </div>

    <section class="section" aria-labelledby="boardTitle">
      <div class="section-head"><div><p class="eyebrow">Trip board</p><h2 id="boardTitle">8일의 여행 보드</h2></div></div>
      <div class="filters" role="toolbar" aria-label="도시별 보기">
        <button class="filter" type="button" data-filter="all" aria-pressed="true">전체</button>
        <button class="filter" type="button" data-filter="hk" aria-pressed="false">홍콩</button>
        <button class="filter" type="button" data-filter="bkk" aria-pressed="false">방콕</button>
        <button class="filter" type="button" data-filter="seoul" aria-pressed="false">서울·이동</button>
      </div>
      <div class="board" id="board">${pins}</div>
    </section>

    <section class="section" aria-labelledby="anchorTitle">
      <div class="section-head"><div><p class="eyebrow">Don't miss</p><h2 id="anchorTitle">놓치면 안 되는 시각</h2></div></div>
      <div class="anchors">${anchors}</div>
    </section>

    <section class="section" aria-labelledby="tzTitle">
      <div class="section-head"><div><p class="eyebrow">Time zones</p><h2 id="tzTitle">세 도시의 시계</h2></div><p>시각은 모두 현지 시간이에요</p></div>
      ${tzHTML()}
    </section>

    ${footerHTML()}
  </div>`;
}

function tzHTML(one = false) {
  const zones = [
    { city: 'seoul', label: 'SEOUL', tz: 'Asia/Seoul', diff: '기준 · UTC+9' },
    { city: 'hk', label: 'HONG KONG', tz: 'Asia/Hong_Kong', diff: '서울보다 1시간 느려요' },
    { city: 'bkk', label: 'BANGKOK', tz: 'Asia/Bangkok', diff: '서울보다 2시간 느려요' },
  ];
  return `<div class="tz${one ? ' one' : ''}">${zones.map((z, i) => `
    <div class="tz-card ${z.city} reveal" style="--d:${i * 0.06}s">
      <div><div class="city">${z.label}</div><div class="diff">${z.diff}</div></div>
      <div class="time" data-tz="${z.tz}">--:--</div>
    </div>`).join('')}</div>`;
}

function footerHTML() {
  return `<footer class="footer">
    <p>2026년 9월 5일 확인 기준 가족 여행 일정 · 운영시간과 가격은 여행 직전에 다시 확인해요.</p>
    <p style="margin-top:6px">사진: Wikimedia Commons · <button type="button" data-credits>사진 출처와 라이선스</button></p>
  </footer>`;
}

let clockTimer;
function startClocks() {
  clearInterval(clockTimer);
  const tick = () => {
    $$('[data-tz]', view).forEach((el) => {
      el.textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: el.dataset.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now());
    });
  };
  tick();
  clockTimer = setInterval(tick, 15000);
}

/* ---------- 매스너리 보드 ---------- */
let boardRO;
function layoutBoard() {
  const board = $('#board');
  if (!board) return;
  const cs = getComputedStyle(board);
  const row = parseFloat(cs.gridAutoRows) || 4;
  const gap = parseFloat(cs.columnGap) || 12;
  $$('.pin', board).forEach((p) => {
    if (p.classList.contains('is-filtered')) return;
    const h = p.firstElementChild.getBoundingClientRect().height;
    p.style.setProperty('--span', Math.ceil((h + gap) / row));
  });
}
function setupBoard() {
  layoutBoard();
  boardRO?.disconnect();
  let raf = 0;
  boardRO = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layoutBoard); });
  $$('#board .pin-inner').forEach((el) => boardRO.observe(el));
  document.fonts?.ready.then(layoutBoard);
}
function applyFilter(key) {
  const board = $('#board');
  const pins = $$('.pin', board);
  const first = new Map(pins.map((p) => [p, p.getBoundingClientRect()]));
  pins.forEach((p) => {
    const show = key === 'all' || p.dataset.city.split(' ').includes(key);
    p.classList.toggle('is-filtered', !show);
    if (show) p.classList.add('is-in');
  });
  layoutBoard();
  if (reduceMotion.matches) return;
  pins.forEach((p) => {
    if (p.classList.contains('is-filtered')) return;
    const a = first.get(p);
    const b = p.getBoundingClientRect();
    if (!a.width) {
      p.animate([{ opacity: 0, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
      return;
    }
    const dx = a.left - b.left; const dy = a.top - b.top;
    if (dx || dy) p.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.22,1,.36,1)' });
  });
}

/* ==========================================================================
   하루 일정
   ========================================================================== */
function timeLabel(e) {
  return e.k === 'flight' && toMin(e.e) - toMin(e.s) > 60 ? `${e.s} → ${e.e}` : `${e.s} – ${e.e}`;
}

function renderEvent(e, d, state) {
  const k = KIND[e.k];
  const status = state.nowIdx.includes(e.i) ? 'is-now' : state.past.has(e.i) ? 'is-past' : '';
  const hidden = e.br && branchFilter !== 'all' && e.br !== branchFilter ? 'is-hidden' : '';
  const tags = [
    e.br ? `<span class="tag-s branch-${e.br}">${esc(BRANCH[e.br].label)}</span>` : '',
    e.st ? `<span class="tag-s status">${esc(e.st)}</span>` : '',
    e.tt ? `<span class="tag-s tip">${icon('bulb')} 현장 팁</span>` : '',
    e.map ? `<span class="tag-s">${icon('pin')} 지도</span>` : '',
  ].join('');
  return `<li class="ev k-${e.k} ${status} ${hidden}" data-i="${e.i}" data-s="${e.s}" ${e.br ? `data-br="${e.br}"` : ''}>
    <div class="ev-time"><b>${e.s}</b><span>${e.k === 'flight' ? '→ ' : ''}${e.e}</span></div>
    <span class="ev-dot" aria-hidden="true"></span>
    <div class="ev-card pressable" role="button" tabindex="0" data-ev="${e.i}" aria-label="${esc(`${e.s} ${e.t} 자세히 보기`)}">
      ${status === 'is-now' ? '<span class="now-flag">지금</span>' : ''}
      ${e.img ? photo(e.img, { city: d.city }) : ''}
      <div class="in">
        <span class="ev-kind">${icon(k.icon)} ${k.label}</span>
        <h4 class="ev-title">${esc(e.t)}</h4>
        ${e.d ? `<p class="ev-desc">${esc(e.d)}</p>` : ''}
        ${tags ? `<div class="ev-tags">${tags}</div>` : ''}
      </div>
    </div>
  </li>`;
}

function renderDay(n) {
  const d = DAYS[n - 1];
  const evs = flat(d);
  const st = tripState();
  const isToday = st.phase === 'during' && st.day.n === n;
  const state = { nowIdx: [], past: new Set() };
  if (isToday) {
    evs.forEach((e) => {
      if (toMin(e.e) <= st.mins) state.past.add(e.i);
      else if (toMin(e.s) <= st.mins) state.nowIdx.push(e.i);
    });
  } else if (st.ds > d.date) {
    evs.forEach((e) => state.past.add(e.i));
  }
  const hotel = TRIP.hotels.find((h) => h.key === d.hotel);
  const prev = DAYS[n - 2];
  const next = DAYS[n];
  const cityVar = `--city: var(--${d.city}); --city-soft: var(--${d.city}-soft)`;
  const vt = morphDay === n ? 'hero-media' : '';
  const hasBranch = evs.some((e) => e.br);
  const cover = PHOTOS[d.cover];

  const pills = DAYS.map((x) => `<a class="dpill ${x.city} ${st.phase === 'during' && st.day.n === x.n ? 'is-today' : ''}" href="#/day/${x.n}" ${x.n === n ? 'aria-current="true"' : ''} aria-label="${x.n}일차 ${esc(x.title)}">
      <span class="d">${shortDate(x.date)} ${x.dow}</span><span class="n">${pad(x.n)}</span><span class="c"></span></a>`).join('');

  const stops = d.stops.map(([t, name, sub], i) => `<button class="stop reveal" type="button" data-focus="${t}" style="--d:${i * 0.05}s">
      <span class="dot"></span><span class="t">${t}</span><strong>${esc(name)}</strong><small>${esc(sub)}</small></button>`).join('');

  const periods = d.periods.map((p, pi) => {
    const list = evs.filter((e) => e.pi === pi);
    return `<section class="period" aria-labelledby="p-${n}-${pi}">
      <div class="period-head"><span class="tag">${esc(p.label)}</span><h3 id="p-${n}-${pi}">${esc(p.title)}</h3><span class="count">${list.length}개</span></div>
      <ol class="timeline">${list.map((e) => renderEvent(e, d, state)).join('')}</ol>
    </section>`;
  }).join('');

  const nowChip = isToday && state.nowIdx.length ? `<button class="btn small light" type="button" data-jump-now style="margin-top:14px">${icon('clock')} 지금 일정으로</button>` : '';

  const ovIcons = ['bulb', 'swap', 'rest', 'star', 'alert'];
  const ovLabels = ['', '', '쉬어 가는 방법', '가족과 함께', '계획이 바뀌면'];

  return `
  <section class="day-hero">
    ${photo(d.cover, { city: d.city, eager: true, vt })}
    <div class="hero-nav">
      <a class="icon-btn glass" href="#/" aria-label="여행 보드로">${icon('home')}</a>
      <div class="pair">
        ${prev ? `<a class="icon-btn glass" href="#/day/${prev.n}" aria-label="이전 날 ${prev.n}일차">${icon('left')}</a>` : ''}
        ${next ? `<a class="icon-btn glass" href="#/day/${next.n}" aria-label="다음 날 ${next.n}일차">${icon('right')}</a>` : ''}
      </div>
    </div>
    <div class="day-hero-inner">
      <div class="big-num" aria-hidden="true">${pad(n)}</div>
      <div class="kicker"><span class="chip glass">${esc(CITY[d.city].en)}</span><span class="chip glass">${fmtDate(d.date, d.dow)}</span><span class="chip glass">${esc(d.route)}</span></div>
      <h1><span class="sr-only">${n}일차 · </span>${esc(d.title)}</h1>
      <p class="loc">${esc(d.location)}</p>
      ${nowChip}
    </div>
    ${cover ? `<span class="credit">사진 ${esc(cover.by)} · ${esc(cover.lic)}</span>` : ''}
  </section>

  <nav class="day-strip" aria-label="날짜 선택"><div class="day-strip-scroller">${pills}</div></nav>

  <div class="day-main" style="${cityVar}">
    <div class="wrap">
      <div class="day-layout">
        <div class="main-col" style="display:grid;gap:16px;align-content:start;min-width:0">
          <div class="essential reveal"><p class="eyebrow">${icon('alert')} 꼭 기억할 것</p><p>${esc(d.essential)}</p></div>
          ${d.rec ? `<div class="rec reveal"><p class="eyebrow">이날의 추천</p><h3>${esc(d.rec.h)}</h3>${d.rec.name ? `<span class="name">${esc(d.rec.name)}</span>` : ''}<p>${esc(d.rec.p)}</p></div>` : ''}
          <div class="card reveal">
            <div class="card-title">${icon('pin')}<h3>이 순서로 이동해요</h3></div>
            <p style="font-size:14px;color:var(--muted);margin:-4px 0 6px">${esc(d.guideHead)} · 누르면 해당 일정으로 가요</p>
            <div class="stops-wrap"><div class="stops">${stops}</div></div>
            ${d.notice ? `<div class="note-box" style="margin-top:6px">${icon('alert')}<span>${esc(d.notice)}</span></div>` : ''}
          </div>
          <div>
            <div class="row-between" style="margin-top:6px;flex-wrap:wrap">
              <div><p class="eyebrow">Timeline</p><h2 style="font-size:24px;font-weight:800;margin-top:2px">오늘의 여정</h2><p style="font-size:13px;color:var(--muted);margin-top:2px">${evs.length}개 일정 · ${esc(d.tzNote)}</p></div>
              ${hasBranch ? `<div class="seg" role="group" aria-label="분기 선택">
                <button type="button" data-branch="all" aria-pressed="${branchFilter === 'all'}">모두</button>
                <button type="button" data-branch="swim" aria-pressed="${branchFilter === 'swim'}">수영</button>
                <button type="button" data-branch="dry" aria-pressed="${branchFilter === 'dry'}">비수영·야경</button></div>` : ''}
            </div>
            ${periods}
          </div>
        </div>

        <aside class="side" aria-label="숙소와 하루 준비">
          ${hotel ? `<div class="card hotel-card reveal">
            <div class="card-title">${icon('bed')}<h3>오늘 밤 숙소</h3></div>
            ${photo(hotel.img, { city: hotel.city })}
            <h4>${esc(hotel.name)}</h4><div class="en">${esc(hotel.en)} · ${esc(hotel.area)}</div>
            <div class="stay"><span class="chip ${hotel.city}">${icon('cal')} ${esc(hotel.stay)}</span></div>
            <p class="desc">${esc(hotel.desc)}</p>
            <ul class="points">${hotel.points.map((p) => `<li>${icon('check')}<span>${esc(p)}</span></li>`).join('')}</ul>
            <div class="actions">
              <a class="btn small" href="${mapUrl(hotel.map)}" target="_blank" rel="noopener">${icon('pin')} 지도</a>
              <button class="btn small ghost" type="button" data-copy="${esc(`${hotel.local}\n${hotel.localAddr}\n${hotel.en}\n${hotel.addr}`)}">${icon('copy')} 주소 복사</button>
            </div>
          </div>` : `<div class="card reveal"><div class="card-title">${icon('bed')}<h3>오늘 밤</h3></div><p style="font-size:14px;color:var(--ink-2)">${esc(d.nightNote || '')}</p></div>`}

          <div class="card reveal">
            <div class="card-title">${icon('bag')}<h3>현장 가이드</h3></div>
            <p class="sub-h">가방과 예약, 먼저 확인</p>
            <ul class="list-dots">${d.prep.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
            <p class="sub-h">예약·발권 확인</p>
            <ul class="checks">${d.checks.map((x, i) => checkItem(`d${d.n}-${i}`, x)).join('')}</ul>
            <p class="sub-h">필요할 때 보여주세요</p>
            ${phraseHTML(d.phrase)}
            <p class="sub-h">하루를 마칠 때</p>
            <p style="font-size:14px;color:var(--ink-2)">${esc(d.end)}</p>
          </div>

          <div class="card overview reveal">
            <div class="card-title">${icon('star')}<h3>함께 편하게 보내려면</h3></div>
            <p style="font-size:14px;color:var(--ink-2)">${esc(d.overview[0])}</p>
            <p class="flow">${esc(d.overview[1])}</p>
            <div class="ov-list">${d.overview.slice(2).map((t, i) => `<div>${icon(ovIcons[i + 2])}<span><b style="display:block;font-size:12.5px;color:var(--muted)">${ovLabels[i + 2]}</b>${esc(t)}</span></div>`).join('')}</div>
          </div>

          ${d.gallery?.length ? `<div class="card reveal">
            <div class="card-title">${icon('photo')}<h3>이날의 장면</h3></div>
            <div class="gallery">${d.gallery.map((g) => `<button type="button" data-photo="${g}" aria-label="${esc(PHOTOS[g].alt)} 크게 보기">${photo(g, { city: d.city })}</button>`).join('')}</div>
            <p style="font-size:11.5px;color:var(--muted)">Wikimedia Commons 사진이에요. 수영장·음식 등 일부는 분위기 사진이고, 촬영 시기에 따라 현재 모습과 다를 수 있어요.</p>
          </div>` : ''}

          <div class="card links reveal">
            <div class="card-title">${icon('ext')}<h3>공식 확인 링크</h3></div>
            ${d.links.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}${icon('ext')}</a>`).join('')}
          </div>
        </aside>

        <div class="full">
          <div class="day-pager">
            ${prev ? `<a class="pager-card pressable" href="#/day/${prev.n}">${photo(prev.cover, { city: prev.city })}<span class="tx"><span>${icon('left')} ${prev.n}일차</span><strong>${esc(prev.title)}</strong></span></a>` : `<a class="pager-card home pressable" href="#/"><span class="tx"><span>${icon('left')} 처음으로</span><strong>여행 보드</strong></span></a>`}
            ${next ? `<a class="pager-card next pressable" href="#/day/${next.n}">${photo(next.cover, { city: next.city })}<span class="tx"><span>${next.n}일차 ${icon('right')}</span><strong>${esc(next.title)}</strong></span></a>` : `<a class="pager-card next home pressable" href="#/"><span class="tx"><span>여행 보드 ${icon('right')}</span><strong>처음으로</strong></span></a>`}
          </div>
          <p class="swipe-hint">${icon('swap')} 좌우로 밀어서 다른 날로 이동</p>
        </div>
      </div>
    </div>
  </div>`;
}

function focusEventAt(time) {
  const all = $$('.ev:not(.is-hidden)', view);
  if (!all.length) return;
  let target = all.find((li) => li.dataset.s === time);
  if (!target) {
    const t = toMin(time);
    target = all.reduce((best, li) => (Math.abs(toMin(li.dataset.s) - t) < Math.abs(toMin(best.dataset.s) - t) ? li : best), all[0]);
  }
  target.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'center' });
  target.classList.remove('flash');
  void target.offsetWidth;
  target.classList.add('flash');
}

function prefetchNeighbors(n) {
  [DAYS[n - 2], DAYS[n]].forEach((d) => { if (d) { const i = new Image(); i.referrerPolicy = 'no-referrer'; i.src = PHOTOS[d.cover].src; } });
}

function setBranch(b) {
  branchFilter = b;
  store.set('branch', b);
  $$('[data-branch]', view).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.branch === b)));
  $$('.ev[data-br]', view).forEach((li) => {
    const hide = b !== 'all' && li.dataset.br !== b;
    if (li.classList.contains('is-hidden') === hide) return;
    li.classList.toggle('is-hidden', hide);
    if (!hide && !reduceMotion.matches) li.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.22,1,.36,1)' });
  });
}

/* ==========================================================================
   숙소·항공
   ========================================================================== */
function renderStay() {
  const passes = TRIP.flights.map((f, i) => `
    <article class="pass reveal" style="--d:${i * 0.06}s">
      ${photo(f.img, { city: f.to === 'HKG' ? 'hk' : f.to === 'BKK' ? 'bkk' : 'seoul' })}
      <div class="body">
        <div class="top"><span>${esc(f.air)} · ${f.no}</span><span>${esc(f.date)}</span></div>
        <div class="route">
          <div><b>${f.from}</b><small>${esc(f.fromCity)}</small></div>
          <div class="mid">${icon('plane')}<span>${f.day}일차</span></div>
          <div class="r"><b>${f.to}</b><small>${esc(f.toCity)}</small></div>
        </div>
        <div class="times"><span>${f.dep}</span><span>${f.arr}</span></div>
        <p class="note">${esc(f.note)}</p>
        <div class="actions"><a class="btn small ghost" href="#/day/${f.day}">${icon('cal')} ${f.day}일차 일정 보기</a></div>
      </div>
    </article>`).join('');

  const hotels = TRIP.hotels.map((h, i) => `
    <article class="hotel-big reveal" style="--d:${i * 0.06}s">
      ${photo(h.img, { city: h.city })}
      <div class="body">
        <span class="chip ${h.city}">${icon('cal')} ${esc(h.stay)}</span>
        <h3>${esc(h.name)}</h3>
        <div class="en">${esc(h.en)} · ${esc(h.area)}</div>
        <div class="addr"><div class="local" lang="${h.city === 'hk' ? 'zh-HK' : 'th'}">${esc(h.local)}</div><div class="line" lang="${h.city === 'hk' ? 'zh-HK' : 'th'}">${esc(h.localAddr)}</div><div class="line">${esc(h.addr)}</div></div>
        <p style="margin-top:12px;font-size:14px;color:var(--ink-2)">${esc(h.desc)}</p>
        <ul class="points">${h.points.map((p) => `<li>${icon('check')}<span>${esc(p)}</span></li>`).join('')}</ul>
        <div class="actions">
          <a class="btn small" href="${mapUrl(h.map)}" target="_blank" rel="noopener">${icon('pin')} 지도</a>
          <button class="btn small ghost" type="button" data-copy="${esc(`${h.local}\n${h.localAddr}\n${h.en}\n${h.addr}`)}">${icon('copy')} 주소 복사</button>
          <button class="btn small ghost" type="button" data-big="${esc(`${h.local}\n${h.localAddr}`)}" data-big-lang="${h.city === 'hk' ? 'zh-HK' : 'th'}" data-big-sub="${esc(`${h.en}\n${h.addr}`)}">기사님께 보여주기</button>
          <a class="btn small ghost" href="${h.site}" target="_blank" rel="noopener">${icon('ext')} 호텔 안내</a>
        </div>
      </div>
    </article>`).join('');

  return `<div class="wrap">
    <header class="page-head reveal"><p class="eyebrow">Stays &amp; flights</p><h1>숙소와 <em>항공</em></h1><p>세 번의 비행, 세 곳의 호텔. 기사님께 주소를 보여주거나 바로 지도로 열어요.</p></header>
    <section class="section"><div class="section-head"><h2>항공편</h2><p>출발·도착은 각 공항 현지 시간</p></div><div class="pass-list">${passes}</div></section>
    <section class="section"><div class="section-head"><h2>호텔</h2><p>홍콩 3박 · 방콕 3박</p></div><div class="hotel-list">${hotels}</div></section>
    ${footerHTML()}
  </div>`;
}

/* ==========================================================================
   도구
   ========================================================================== */
let deferredInstall = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('[data-install]')?.removeAttribute('hidden'); });

function renderTools() {
  const phrases = [
    ...TRIP.phrases,
    ...DAYS.map((d) => ({ ...d.phrase, label: `${d.n}일차 · ${d.title}` })),
  ];
  return `<div class="wrap">
    <header class="page-head reveal"><p class="eyebrow">Travel kit</p><h1>여행 <em>도구</em></h1><p>원화 계산, 현지에서 보여줄 문장, 준비물을 한곳에.</p></header>
    <div class="tool-grid section">
      <div class="card reveal">
        <div class="card-title">${icon('swap')}<h3>얼마쯤일까요?</h3></div>
        <div class="calc">
          <div class="seg" role="group" aria-label="통화">
            <button type="button" data-cur="hkd" aria-pressed="true" aria-label="홍콩 달러">HK$ 홍콩</button>
            <button type="button" data-cur="thb" aria-pressed="false" aria-label="태국 바트">฿ 방콕</button>
          </div>
          <label class="calc-input"><span class="sr-only">금액</span><span id="curSym" style="font-weight:800;color:var(--muted)">HK$</span>
            <input id="amount" type="text" inputmode="decimal" autocomplete="off" value="100" aria-label="현지 금액"></label>
          <div class="quick"><button type="button" data-q="50">50</button><button type="button" data-q="100">100</button><button type="button" data-q="500">500</button><button type="button" data-q="1000">1,000</button></div>
          <div class="calc-out"><span>약</span><b id="krw">17,300원</b></div>
          <p class="calc-note">${esc(TRIP.currency.note)}</p>
        </div>
      </div>

      <div class="card reveal" style="--d:.06s">
        <div class="card-title">${icon('bag')}<h3>가방에 챙겼나요?</h3></div>
        <ul class="checks">${TRIP.packing.map((x, i) => checkItem(`pack-${i}`, x)).join('')}</ul>
        <p style="font-size:12px;color:var(--muted);margin-top:12px">체크 표시는 이 기기에만 저장돼요.</p>
      </div>

      <div class="card reveal" style="--d:.12s">
        <div class="card-title">${icon('clock')}<h3>세 도시의 시계</h3></div>
        ${tzHTML(true)}
      </div>

      <div class="card reveal" style="grid-column:1/-1">
        <div class="card-title">${icon('chat')}<h3>현지에서 보여주세요</h3></div>
        <div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))">
          ${phrases.map((p) => phraseHTML(p, p.label)).join('')}
        </div>
      </div>

      <div class="card reveal">
        <div class="card-title">${icon('vibe')}<h3>설정</h3></div>
        <div class="row-between"><span><b style="display:block">진동 피드백</b><span style="font-size:13px;color:var(--muted)">누를 때 가볍게 진동해요 (안드로이드)</span></span>
          <button class="switch" type="button" role="switch" aria-checked="${Haptic.on}" data-haptic aria-label="진동 피드백"></button></div>
        <div class="row-between" style="margin-top:16px" data-install ${deferredInstall ? '' : 'hidden'}><span><b style="display:block">홈 화면에 추가</b><span style="font-size:13px;color:var(--muted)">앱처럼 바로 열고 오프라인에서도 봐요</span></span>
          <button class="btn small" type="button" data-install-btn>추가</button></div>
        ${window.TRIP_LOCK ? `<div class="row-between" style="margin-top:16px"><span><b style="display:block">이 기기에서 잠그기</b><span style="font-size:13px;color:var(--muted)">다음에 열 때 비밀번호를 다시 물어봐요</span></span>
          <button class="btn small ghost" type="button" data-lock>잠그기</button></div>` : ''}
      </div>

      <div class="card reveal" style="--d:.06s">
        <div class="card-title">${icon('photo')}<h3>사진 출처</h3></div>
        <p style="font-size:14px;color:var(--ink-2)">모든 사진은 Wikimedia Commons의 자유 라이선스 사진이에요. 수영장·음식·케이크 등 일부는 분위기 사진이고, 촬영 시기에 따라 현재 모습과 다를 수 있어요.</p>
        <div class="actions"><button class="btn small ghost" type="button" data-credits>${icon('photo')} 사진 ${Object.keys(PHOTOS).length}장의 저작자 보기</button></div>
      </div>
    </div>
    ${footerHTML()}
  </div>`;
}

function setupTools() {
  let cur = 'hkd';
  const input = $('#amount');
  const out = $('#krw');
  const sym = $('#curSym');
  const calc = () => {
    const v = parseFloat(String(input.value).replace(/[^\d.]/g, '')) || 0;
    const krw = Math.round((v * TRIP.currency[cur]) / 10) * 10;
    out.textContent = `${krw.toLocaleString('ko-KR')}원`;
  };
  input.addEventListener('input', calc);
  $$('[data-cur]', view).forEach((b) => b.addEventListener('click', () => {
    cur = b.dataset.cur;
    $$('[data-cur]', view).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    sym.textContent = cur === 'hkd' ? 'HK$' : '฿';
    Haptic.select();
    calc();
  }));
  $$('[data-q]', view).forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.q; Haptic.tap(); calc(); }));
  calc();
}

/* ==========================================================================
   시트(상세·사진·크게 보기)
   ========================================================================== */
const layer = $('#sheetLayer');
const sheet = $('#sheet');
const sheetBody = $('#sheetBody');
let sheetOpen = false;
let lastFocus = null;
let sheetCtx = null;

function openSheet(html, ctx = null) {
  sheetBody.innerHTML = html;
  sheetBody.scrollTop = 0;
  settleImages(sheetBody);
  sheetCtx = ctx;
  if (sheetOpen) return;
  sheetOpen = true;
  lastFocus = document.activeElement;
  layer.hidden = false;
  document.body.style.overflow = 'hidden';
  history.pushState({ sheet: 1 }, '');
  requestAnimationFrame(() => { layer.classList.add('is-open'); $('.sheet-close', sheet).focus({ preventScroll: true }); });
  Haptic.sheet();
}
function closeSheet(silent = false) {
  if (!sheetOpen) return;
  sheetOpen = false;
  layer.classList.remove('is-open');
  sheet.style.removeProperty('--drag');
  document.body.style.overflow = '';
  setTimeout(() => { if (!sheetOpen) layer.hidden = true; }, 420);
  if (!silent) lastFocus?.focus?.({ preventScroll: true });
}
function requestClose() {
  if (!sheetOpen) return;
  if (history.state?.sheet) history.back(); else closeSheet();
}
addEventListener('popstate', () => { if (sheetOpen) closeSheet(); });

function eventSheet(dayN, i) {
  const d = DAYS[dayN - 1];
  const evs = flat(d).filter((e) => !e.br || branchFilter === 'all' || e.br === branchFilter);
  const idx = evs.findIndex((e) => e.i === i);
  const e = evs[idx];
  if (!e) return;
  const k = KIND[e.k];
  const p = e.img ? PHOTOS[e.img] : null;
  const prev = evs[idx - 1];
  const next = evs[idx + 1];
  const html = `
    ${p ? `${photo(e.img, { city: d.city })}<p class="ph-credit">사진 ${esc(p.by)} · ${esc(p.lic)}</p>` : '<div style="height:30px"></div>'}
    <div class="sheet-head k-${e.k}">
      <p style="font-size:12.5px;color:var(--muted);font-weight:700">${d.n}일차 · ${fmtDate(d.date, d.dow)} · ${esc(e.period)}</p>
      <div class="row" style="margin-top:8px"><span class="ev-kind">${icon(k.icon)} ${k.label}</span><span class="when">${timeLabel(e)}</span></div>
      <h2 id="sheetTitle">${esc(e.t)}</h2>
      <div class="ev-tags">${e.br ? `<span class="tag-s branch-${e.br}">${esc(BRANCH[e.br].label)} · ${esc(BRANCH[e.br].desc)}</span>` : ''}${e.st ? `<span class="tag-s status">${esc(e.st)}</span>` : ''}</div>
    </div>
    ${e.d ? `<div class="sheet-sec"><p>${esc(e.d)}</p></div>` : ''}
    ${e.n ? `<div class="sheet-sec note-box">${icon('bag')}<span>${esc(e.n)}</span></div>` : ''}
    ${e.tt ? `<div class="sheet-sec tip-box"><div class="h">${icon('bulb')}<span>${esc(e.tt)}</span></div><p>${esc(e.tp)}</p></div>` : ''}
    ${e.gallery ? `<div class="sheet-sec gallery">${e.gallery.map((g) => `<button type="button" data-photo="${g}" aria-label="${esc(PHOTOS[g].alt)} 크게 보기">${photo(g, { city: d.city })}</button>`).join('')}</div>` : ''}
    ${e.map ? `<div class="sheet-sec actions"><a class="btn" href="${mapUrl(e.map)}" target="_blank" rel="noopener">${icon('pin')} 지도에서 보기</a><button class="btn ghost" type="button" data-copy="${esc(e.map)}">${icon('copy')} 장소명 복사</button></div>` : ''}
    <div class="sheet-nav">
      <button type="button" data-sheet-ev="${prev ? prev.i : ''}" ${prev ? '' : 'disabled'}>이전<strong>${prev ? `${prev.s} ${esc(prev.t)}` : '—'}</strong></button>
      <button type="button" class="next" data-sheet-ev="${next ? next.i : ''}" ${next ? '' : 'disabled'}>다음<strong>${next ? `${next.s} ${esc(next.t)}` : '—'}</strong></button>
    </div>`;
  openSheet(html, { day: dayN, i });
}

function photoSheet(key) {
  const p = PHOTOS[key];
  openSheet(`<div class="lightbox" style="padding-top:34px">
    <img src="${p.src}" alt="${esc(p.alt)}" referrerpolicy="no-referrer" class="is-loaded">
    <h2 id="sheetTitle" style="font-size:20px;margin-top:14px">${esc(p.alt)}</h2>
    <p style="font-size:13px;color:var(--muted);margin-top:6px">사진 ${esc(p.by)} · ${esc(p.lic)} · <a href="${p.page}" target="_blank" rel="noopener" style="text-decoration:underline">원본 보기</a></p>
  </div>`);
}

const LANG_LABEL = { 'zh-HK': '中文(香港) · 홍콩', th: 'ภาษาไทย · 태국어', ko: '한국어', en: 'English' };

/* 현지에서 보여줄 문장: 현지어를 크게, 영어·한국어 뜻은 작게 */
function phraseHTML(p, label = '') {
  const sub = [p.lang === 'en' ? '' : p.en, p.lang === 'ko' ? '' : p.ko].filter(Boolean).join('\n');
  return `<div class="phrase">
    ${label ? `<p class="eyebrow" style="letter-spacing:.04em;text-transform:none;margin-bottom:6px">${esc(label)}</p>` : ''}
    <p class="lang-tag">${esc(LANG_LABEL[p.lang] || '')}</p>
    <p class="local" lang="${p.lang}">${esc(p.local)}</p>
    ${p.lang !== 'en' ? `<p class="en" lang="en">${esc(p.en)}</p>` : ''}
    ${p.lang !== 'ko' ? `<p class="ko">${esc(p.ko)}</p>` : ''}
    <div class="row"><button class="btn small ghost" type="button" data-big="${esc(p.local)}" data-big-lang="${p.lang}" data-big-sub="${esc(sub)}">크게 보기</button>&nbsp;<button class="btn small ghost" type="button" data-copy="${esc(p.local)}">${icon('copy')} 복사</button></div>
  </div>`;
}

function bigSheet(text, sub, lang = '') {
  openSheet(`<div style="padding:40px 4px 10px">
    ${lang && LANG_LABEL[lang] ? `<p class="lang-tag">${esc(LANG_LABEL[lang])}</p>` : ''}
    <p id="sheetTitle" ${lang ? `lang="${lang}"` : ''} style="font-size:clamp(28px,8vw,44px);font-weight:800;line-height:1.35;letter-spacing:-.01em;white-space:pre-line">${esc(text)}</p>
    ${sub ? `<p style="margin-top:18px;font-size:17px;color:var(--muted);white-space:pre-line">${esc(sub)}</p>` : ''}
    <div class="actions" style="margin-top:24px"><button class="btn" type="button" data-copy="${esc(text)}">${icon('copy')} 복사</button></div>
  </div>`);
}

function creditsSheet() {
  openSheet(`<div style="padding-top:34px">
    <h2 id="sheetTitle" style="font-size:22px">사진 출처와 라이선스</h2>
    <p style="font-size:13.5px;color:var(--muted);margin:8px 0 12px">Wikimedia Commons의 자유 라이선스 사진이에요. 이름을 누르면 원본과 라이선스 전문을 볼 수 있어요.</p>
    <ul class="credits">${Object.entries(PHOTOS).map(([k, p]) => `<li>${photo(k)}<div><a href="${p.page}" target="_blank" rel="noopener">${esc(p.alt)}</a><br><span>${esc(p.by)} · ${esc(p.lic)}</span></div></li>`).join('')}</ul>
  </div>`);
}

/* 시트 끌어내려 닫기 */
(() => {
  let y0 = null; let dy = 0; let t0 = 0;
  const start = (e) => {
    if (innerWidth >= 600) return;
    const onGrip = e.target.closest('.sheet-grip');
    if (!onGrip && sheetBody.scrollTop > 0) return;
    y0 = e.touches[0].clientY; dy = 0; t0 = performance.now();
  };
  const move = (e) => {
    if (y0 === null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { sheet.style.setProperty('--drag', '0px'); return; }
    sheet.classList.add('is-dragging');
    sheet.style.setProperty('--drag', `${dy}px`);
    if (e.cancelable) e.preventDefault();
  };
  const end = () => {
    if (y0 === null) return;
    sheet.classList.remove('is-dragging');
    const v = dy / Math.max(1, performance.now() - t0);
    if (dy > 120 || v > 0.6) { Haptic.tap(); requestClose(); } else sheet.style.setProperty('--drag', '0px');
    y0 = null;
  };
  sheet.addEventListener('touchstart', start, { passive: true });
  sheet.addEventListener('touchmove', move, { passive: false });
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
})();

/* ---------- 복사·토스트 ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-on'), 1800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* 무시 */ }
    ta.remove();
  }
  Haptic.success();
  toast('복사했어요');
}

/* ==========================================================================
   입력 이벤트
   ========================================================================== */
document.addEventListener('click', (e) => {
  const t = e.target;
  const a = t.closest('a[href^="#"]');
  if (a) {
    const morph = a.dataset.morph;
    if (morph && document.startViewTransition && !reduceMotion.matches) {
      const img = $('img', a);
      if (img) { img.style.viewTransitionName = 'hero-media'; morphDay = +morph; }
    }
    const f = a.dataset.focus;
    if (f) pendingFocus = f;
    if (a.getAttribute('href') === location.hash && route?.page === 'day' && pendingFocus) {
      e.preventDefault();
      const tm = pendingFocus; pendingFocus = null; focusEventAt(tm);
    }
    Haptic.tap();
    return;
  }
  if (t.closest('[data-close]')) { requestClose(); return; }
  const ev = t.closest('[data-ev]');
  if (ev && route?.page === 'day') { Haptic.tap(); eventSheet(route.n, +ev.dataset.ev); return; }
  const sev = t.closest('[data-sheet-ev]');
  if (sev && sev.dataset.sheetEv !== '' && sheetCtx) { Haptic.select(); eventSheet(sheetCtx.day, +sev.dataset.sheetEv); return; }
  const ph = t.closest('[data-photo]');
  if (ph) { Haptic.tap(); photoSheet(ph.dataset.photo); return; }
  const cp = t.closest('[data-copy]');
  if (cp) { copy(cp.dataset.copy); return; }
  const big = t.closest('[data-big]');
  if (big) { bigSheet(big.dataset.big, big.dataset.bigSub, big.dataset.bigLang); return; }
  if (t.closest('[data-credits]')) { creditsSheet(); return; }
  const stop = t.closest('.stop[data-focus]');
  if (stop) { Haptic.select(); focusEventAt(stop.dataset.focus); return; }
  const fl = t.closest('[data-filter]');
  if (fl) {
    Haptic.select();
    $$('[data-filter]', view).forEach((x) => x.setAttribute('aria-pressed', String(x === fl)));
    applyFilter(fl.dataset.filter);
    return;
  }
  const ck = t.closest('[data-check]');
  if (ck) {
    const key = ck.dataset.check;
    const on = !checked.has(key);
    if (on) checked.add(key); else checked.delete(key);
    store.set('checks', [...checked]);
    ck.classList.toggle('is-done', on);
    ck.setAttribute('aria-pressed', String(on));
    if (on) Haptic.success(); else Haptic.tap();
    return;
  }
  const br = t.closest('[data-branch]');
  if (br) { Haptic.select(); setBranch(br.dataset.branch); return; }
  if (t.closest('[data-jump-now]')) { Haptic.tap(); const li = $('.ev.is-now', view); if (li) focusEventAt(li.dataset.s); return; }
  const hs = t.closest('[data-haptic]');
  if (hs) {
    Haptic.on = !Haptic.on; store.set('haptic', Haptic.on);
    hs.setAttribute('aria-checked', String(Haptic.on));
    Haptic.success();
    toast(Haptic.on ? '진동 피드백을 켰어요' : '진동 피드백을 껐어요');
    return;
  }
  if (t.closest('[data-lock]') && window.TRIP_LOCK) {
    window.TRIP_LOCK.forget();
    Haptic.success();
    location.replace(location.pathname);
    return;
  }
  if (t.closest('[data-install-btn]') && deferredInstall) {
    deferredInstall.prompt();
    deferredInstall.userChoice.finally(() => { deferredInstall = null; $('[data-install]')?.setAttribute('hidden', ''); });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheetOpen) { requestClose(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-ev]')) { e.preventDefault(); e.target.click(); return; }
  if (sheetOpen || route?.page !== 'day' || e.target.closest('input, textarea') || e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === 'ArrowRight' && route.n < DAYS.length) location.hash = `#/day/${route.n + 1}`;
  if (e.key === 'ArrowLeft' && route.n > 1) location.hash = `#/day/${route.n - 1}`;
});

/* 좌우 스와이프로 날짜 이동 */
(() => {
  let sx = 0; let sy = 0; let st = 0; let active = false;
  view.addEventListener('touchstart', (e) => {
    active = false;
    if (route?.page !== 'day' || sheetOpen || e.touches.length !== 1) return;
    if (e.target.closest('.stops, .day-strip-scroller, .gallery, input')) return;
    const x = e.touches[0].clientX;
    if (x < 24 || x > innerWidth - 24) return; // 시스템 뒤로 가기 제스처와 겹치지 않게
    sx = x; sy = e.touches[0].clientY; st = performance.now(); active = true;
  }, { passive: true });
  view.addEventListener('touchend', (e) => {
    if (!active) return;
    active = false;
    const dx = e.changedTouches[0].clientX - sx;
    const dy = e.changedTouches[0].clientY - sy;
    const dt = performance.now() - st;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6 || dt > 700) return;
    const n = route.n + (dx < 0 ? 1 : -1);
    if (n < 1 || n > DAYS.length) {
      Haptic.edge();
      if (!reduceMotion.matches) view.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx < 0 ? -14 : 14}px)` }, { transform: 'translateX(0)' }], { duration: 320, easing: 'cubic-bezier(.34,1.4,.5,1)' });
      return;
    }
    Haptic.swipe();
    location.hash = `#/day/${n}`;
  }, { passive: true });
})();

/* ---------- 시작 ---------- */
buildRail();
addEventListener('hashchange', onRoute);
addEventListener('resize', () => { if (route?.page === 'home') layoutBoard(); onScroll(); });
onRoute();
updateClockBadge();
setInterval(updateClockBadge, 30000);

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  // 잠금 해제를 기다리는 동안 load 이벤트가 이미 지나갔을 수 있어요
  const registerSW = () => navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 캐시 없이도 동작 */ });
  if (document.readyState === 'complete') registerSW(); else addEventListener('load', registerSW);
}
