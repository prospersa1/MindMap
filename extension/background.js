try {
  importScripts("config.js"); // optional public API base URL for the extension
} catch (_) {
  // config.js is optional; localhost is used by default for local development.
}

const SUPABASE_URL = "https://sagbrkjfdqxqndrfekkp.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhZ2Jya2pmZHF4cW5kcmZla2twIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MTkzNjgsImV4cCI6MjA5MDI5NTM2OH0.R3X09rKRcUES59xnLP_dsQacq6b5gg2QiTIfbTOeTxI";

const VALID_CATEGORIES = [
  "learning",
  "entertainment",
  "social media",
  "productivity",
  "news",
  "other",
];

const DEFAULT_API_BASE_URL = "http://localhost:8888";

function getApiBaseUrl() {
  if (
    typeof MINDMAP_API_BASE_URL === "string" &&
    MINDMAP_API_BASE_URL.trim().length > 0
  ) {
    return MINDMAP_API_BASE_URL.trim().replace(/\/+$/, "");
  }

  return DEFAULT_API_BASE_URL;
}

// In-memory state
let activeTabId = null;
let activeStartTime = null;
const tabEventMap = {}; // tabId -> supabase event id

// Auth
async function getOrCreateSession() {
  const stored = await chrome.storage.local.get("supabase_session");
  if (stored.supabase_session) return stored.supabase_session;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
    },
    body: JSON.stringify({}),
  });

  const data = await res.json();
  await chrome.storage.local.set({ supabase_session: data });
  return data;
}

// Local keyword fallback used when the classification endpoint is unavailable.
function classifyLocally(url, title) {
  let domain = "";
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {}
  const text = (domain + " " + title).toLowerCase();

  const SOCIAL = /\b(twitter\.com|x\.com|instagram\.com|facebook\.com|tiktok\.com|linkedin\.com|reddit\.com|snapchat\.com|pinterest\.com|threads\.net)\b/;
  const NEWS = /\b(bbc\.(co\.uk|com)|cnn\.com|nytimes\.com|reuters\.com|theguardian\.com|washingtonpost\.com|bloomberg\.com|apnews\.com|aljazeera\.com|techcrunch\.com|theverge\.com|wired\.com)\b/;
  const LEARN = /\b(wikipedia\.org|stackoverflow\.com|github\.com|docs\.|coursera\.org|udemy\.com|khanacademy\.org|edx\.org|medium\.com|dev\.to|freecodecamp\.org|w3schools\.com|mdn\b|developer\.|learn\.|education)\b/;
  const PROD = /\b(gmail\.com|notion\.so|slack\.com|jira\.|linear\.app|figma\.com|docs\.google\.com|sheets\.google\.com|trello\.com|asana\.com|calendar\.google\.com|outlook\.(com|office\.com))\b/;
  const ENTERTAIN = /\b(netflix\.com|twitch\.tv|spotify\.com|soundcloud\.com|9gag\.com|imgur\.com|primevideo\.com|disneyplus\.com|hulu\.com)\b/;

  if (SOCIAL.test(domain)) return "social media";
  if (NEWS.test(domain)) return "news";
  if (ENTERTAIN.test(domain)) return "entertainment";
  if (PROD.test(domain)) return "productivity";
  if (LEARN.test(domain)) return "learning";

  if (/tutorial|course|lecture|documentation|how[ -]to|explained?|guide|learn\b/.test(text)) return "learning";
  if (/breaking news|headlines|politics|report\b/.test(text)) return "news";
  if (/\bgame\b|gaming|meme|funny|comedy/.test(text)) return "entertainment";

  return "other";
}

// Server-side categorization via Netlify Function.
async function classifyWithGemini(url, title) {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data?.error || `Classifier error ${res.status}`);
    }

    const match = VALID_CATEGORIES.find((item) => item === data?.category);
    return match ?? "other";
  } catch (err) {
    console.warn("Remote classification failed, using local fallback:", err);
    return classifyLocally(url, title);
  }
}

// Create event in Supabase, returns the new event's id
async function createEvent(tab) {
  const url = tab.url;
  if (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://")
  ) {
    return null;
  }

  let domain = "";
  try {
    domain = new URL(url).hostname;
  } catch (_) {
    return null;
  }

  const session = await getOrCreateSession();

  const res = await fetch(`${SUPABASE_URL}/rest/v1/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      url,
      title: tab.title,
      category: "uncategorized",
      duration: 0,
      domain,
      user_id: session.user?.id,
      created_at: new Date().toISOString(),
    }),
  });

  const [created] = await res.json();
  console.log("Event created:", created);

  if (created?.id) {
    classifyWithGemini(url, tab.title).then((category) => {
      patchEventCategory(created.id, category, session.access_token);
    });
  }

  return created?.id ?? null;
}

// Patch category once Gemini responds
async function patchEventCategory(eventId, category, token) {
  await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${eventId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ category }),
  });
  console.log(`Category set -> ${category} (event ${eventId})`);
}

// Patch duration + ended_at on an existing event
async function finalizeEvent(tabId) {
  if (!activeStartTime || !tabEventMap[tabId]) return;

  const duration = Math.round((Date.now() - activeStartTime) / 1000);
  const eventId = tabEventMap[tabId];
  const session = await getOrCreateSession();

  await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${eventId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      duration,
      ended_at: new Date().toISOString(),
    }),
  });

  console.log(`Finalized tab ${tabId}: ${duration}s`);
}

// Tab finishes loading
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  if (tabId === activeTabId && tabEventMap[tabId]) {
    await finalizeEvent(tabId);
    activeStartTime = Date.now();
  }

  const eventId = await createEvent(tab);
  if (eventId) {
    tabEventMap[tabId] = eventId;
    if (tabId === activeTabId) {
      activeStartTime = Date.now();
    }
  }
});

// User switches tabs
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (activeTabId !== null && activeTabId !== tabId) {
    await finalizeEvent(activeTabId);
  }
  activeTabId = tabId;
  activeStartTime = Date.now();
});

// Chrome window gains/loses focus
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (activeTabId !== null) {
      await finalizeEvent(activeTabId);
      activeStartTime = null;
    }
  } else {
    activeStartTime = Date.now();
  }
});
