// ── Config ──────────────────────────────────────────────────────────────────
const UNSPLASH_ACCESS_KEY = 'oOEF298YzIVrddPb5UuQVpT9tSIqVggfaLnlBdU6W1Q';
const SUPABASE_URL = 'https://sagbrkjfdqxqndrfekkp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhZ2Jya2pmZHF4cW5kcmZla2twIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MTkzNjgsImV4cCI6MjA5MDI5NTM2OH0.R3X09rKRcUES59xnLP_dsQacq6b5gg2QiTIfbTOeTxI';

// ── App URLs — update to your Netlify URL when deployed ─────────────────────
const BASE_URL = 'file:///Users/perfectackah/MindMap-1';
const DASHBOARD_URL = `${BASE_URL}/dashboard/dashboard.html`;
const AR_URL = `${BASE_URL}/ar/ar.html`;

// ── Brain state config ───────────────────────────────────────────────────────
const STATES = [
  { name: 'Thriving',  min: 55, color: '#1D9E75' },
  { name: 'Healthy',   min: 35, color: '#378ADD' },
  { name: 'Sluggish',  min: 15, color: '#8a6a44' },
  { name: 'Rotting',   min:  0, color: '#666666' },
];

const LEARNING_CATS = new Set(['learning', 'productivity', 'news']);

// ── Clock ────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const h24 = now.getHours();
  const h12 = h24 % 12 || 12;
  const m = String(now.getMinutes()).padStart(2, '0');
  const ampm = h24 < 12 ? 'AM' : 'PM';
  document.getElementById('clock').innerHTML = `<span id="time-digits">${h12}:${m}</span><span id="ampm">${ampm}</span>`;

  const greet = h24 < 12 ? 'Good morning' : h24 < 17 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting').textContent = greet;
}
updateClock();
setInterval(updateClock, 10_000);

// ── Unsplash background ──────────────────────────────────────────────────────
async function loadBackground() {
  const cache = await chrome.storage.local.get('unsplash_cache');
  const today = new Date().toDateString();

  let photo = cache.unsplash_cache;
  if (!photo || photo.date !== today) {
    try {
      const res = await fetch(
        `https://api.unsplash.com/photos/random?orientation=landscape&client_id=${UNSPLASH_ACCESS_KEY}`
      );
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      photo = {
        date: today,
        url: data.urls.regular,
        photographer: data.user.name,
        photographerLink: data.user.links.html + '?utm_source=mindmap&utm_medium=referral',
        unsplashLink: data.links.html + '?utm_source=mindmap&utm_medium=referral',
      };
      await chrome.storage.local.set({ unsplash_cache: photo });
    } catch (err) {
      console.warn('Unsplash fetch failed:', err);
      return;
    }
  }

  const bg = document.getElementById('bg');
  const img = new Image();
  img.onload = () => {
    bg.style.backgroundImage = `url(${photo.url})`;
    bg.classList.add('loaded');
  };
  img.src = photo.url;

  document.getElementById('photo-credit').innerHTML =
    `Photo by <a href="${photo.photographerLink}" target="_blank">${photo.photographer}</a> on ` +
    `<a href="${photo.unsplashLink}" target="_blank">Unsplash</a>`;
}

// ── Supabase auth ────────────────────────────────────────────────────────────
async function getSession() {
  const stored = await chrome.storage.local.get('supabase_session');
  const session = stored.supabase_session;

  if (session?.access_token) {
    const expired = session.expires_at && session.expires_at * 1000 < Date.now() + 60_000;
    if (!expired) return session;

    if (session.refresh_token) {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
          body: JSON.stringify({ refresh_token: session.refresh_token }),
        });
        const refreshed = await res.json();
        if (refreshed.access_token) {
          await chrome.storage.local.set({ supabase_session: refreshed });
          return refreshed;
        }
      } catch (err) {
        console.warn('Token refresh failed:', err);
      }
    }
  }

  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  await chrome.storage.local.set({ supabase_session: data });
  return data;
}

// ── Brain score ──────────────────────────────────────────────────────────────
async function loadBrainScore() {
  try {
    const session = await getSession();
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/events?select=category,duration&created_at=gte.${since}`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );
    const events = await res.json();

    let total = 0, learning = 0;
    for (const ev of events) {
      const dur = ev.duration || 0;
      total += dur;
      if (LEARNING_CATS.has(ev.category)) learning += dur;
    }

    const pct = total > 0 ? Math.round((learning / total) * 100) : 0;
    const state = STATES.find(s => pct >= s.min) ?? STATES[STATES.length - 1];

    document.getElementById('score-num').textContent = pct;
    document.getElementById('score-num').style.color = state.color;
    document.getElementById('state-name').textContent = state.name;
    document.getElementById('state-name').style.color = state.color;
    document.getElementById('state-sub').textContent =
      total > 0 ? `${pct}% learning this week` : 'No data yet';

    document.getElementById('brain-widget').classList.add('loaded');
  } catch (err) {
    console.warn('Brain score failed:', err);
    document.getElementById('state-name').textContent = 'Unavailable';
    document.getElementById('brain-widget').classList.add('loaded');
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('brain-widget').addEventListener('click', () => {
  chrome.tabs.create({ url: DASHBOARD_URL });
});
document.getElementById('ar-widget').addEventListener('click', () => {
  chrome.tabs.create({ url: AR_URL });
});
loadBackground();
loadBrainScore();
