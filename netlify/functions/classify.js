const fs = require("fs");
const path = require("path");

const VALID_CATEGORIES = [
  "learning",
  "entertainment",
  "social media",
  "productivity",
  "news",
  "other",
];

const DEFAULT_MODEL = "gemini-2.5-flash";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function parseEnvFile(contents) {
  const env = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadLocalEnv() {
  const files = [
    path.resolve(__dirname, "../../.env.local"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../../extension/.env"),
  ];

  const env = {};

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    Object.assign(env, parseEnvFile(fs.readFileSync(file, "utf8")));
  }

  return env;
}

function getConfig() {
  const localEnv = loadLocalEnv();

  return {
    apiKey: process.env.GEMINI_API_KEY || localEnv.GEMINI_API_KEY || "",
    model: process.env.GEMINI_MODEL || localEnv.GEMINI_MODEL || DEFAULT_MODEL,
  };
}

function buildPrompt(url, title) {
  return `Classify this website into exactly one category.
URL: ${url}
Title: ${title}

Categories: learning, entertainment, social media, productivity, news, other

Rules:
- "learning" = tutorials, courses, documentation, educational videos, Wikipedia
- "entertainment" = YouTube (non-educational), Netflix, gaming, memes
- "social media" = Twitter/X, Instagram, Reddit, Facebook, TikTok, LinkedIn
- "productivity" = email, coding, Google Docs, project management tools
- "news" = news articles, journalism, blogs about current events
- "other" = anything that doesn't fit above

Reply with only the category word, nothing else.`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return json(400, { error: "Invalid JSON body" });
  }

  const url = String(payload.url || "").trim();
  const title = String(payload.title || "").trim();

  if (!url || !title) {
    return json(400, { error: "Both url and title are required" });
  }

  const { apiKey, model } = getConfig();
  if (!apiKey) {
    return json(500, {
      error: "Missing GEMINI_API_KEY in Netlify environment or local .env",
    });
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(url, title) }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 1024,
          },
        }),
      },
    );

    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      return json(502, {
        error: `Gemini request failed with ${geminiRes.status}`,
        details: data,
      });
    }

    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const answerPart = parts.find((part) => !part.thought) ?? parts[parts.length - 1];
    const raw = String(answerPart?.text || "").trim().toLowerCase();
    const category = VALID_CATEGORIES.find((item) => raw.includes(item)) || "other";

    return json(200, {
      category,
      raw,
      model,
      usage: data?.usageMetadata || null,
    });
  } catch (error) {
    return json(500, {
      error: "Classification request failed",
      details: error.message,
    });
  }
};
