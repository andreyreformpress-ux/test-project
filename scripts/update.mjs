#!/usr/bin/env node
/**
 * AI News Dashboard updater.
 * Collects AI news from RSS feeds and Telegram public channels,
 * categorizes them, deduplicates, and writes data/news.json.
 *
 * Sources are collected resiliently: a failing source is skipped
 * without breaking the whole update.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "linkedom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(ROOT, "data", "news.json");
const MAX_NEWS = 20;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ---------------------------------------------------------------- sources

const RSS_FEEDS = [
  { url: "https://habr.com/ru/rss/hubs/artificial_intelligence/all/?fl=ru", source: "Хабр · ИИ" },
  { url: "https://habr.com/ru/rss/hubs/machine_learning/all/?fl=ru", source: "Хабр · Машинное обучение" },
  { url: "https://vc.ru/rss", source: "vc.ru" },
  { url: "https://www.cnews.ru/inc/rss/news.xml", source: "CNews" },
  { url: "https://www.ixbt.com/export/news.rss", source: "iXBT" },
];

const TELEGRAM_CHANNELS = [
  { channel: "neurobureau", source: "Neuro Bureau" },
  { channel: "ai_machinelearning", source: "AI • Машинное обучение" },
];

// ------------------------------------------------------------ categories

const CATEGORY_RULES = [
  {
    id: "models",
    label: "Модели и релизы",
    keywords: [
      "model", "gpt", "llm", "claude", "gemini", "llama", "mistral",
      "release", "launch", "benchmark", "open weights", "openweights",
      "openai", "anthropic", "deepmind", "модель", "релиз", "вес",
    ],
  },
  {
    id: "business",
    label: "Бизнес и инвестиции",
    keywords: [
      "funding", "investment", "raises", "billion", "ipo", "valuation",
      "revenue", "acquisition", "acquires", "startup", "инвестиц",
      "стартап", "окупац", "млрд", "миллиард", "оборот",
    ],
  },
  {
    id: "research",
    label: "Исследования",
    keywords: [
      "research", "paper", "study", "arxiv", "breakthrough",
      "reinforcement learning", "interpretability", "benchmark",
      "исследован", "статья", "прорыв",
    ],
  },
  {
    id: "policy",
    label: "Регулирование",
    keywords: [
      "regulation", "regulator", "law", "act", "policy", "eu", "senate",
      "congress", "copyright", "lawsuit", "ban", "safety",
      "закон", "запрет", "регул", "иск", "суд", "безопасн",
    ],
  },
];
const DEFAULT_CATEGORY = "misc";

// Generic news feeds are filtered so the dashboard remains about AI.
const AI_TERMS = [
  "искусственн", "нейросет", "нейронн", "машинн", "ии", "ai", "gpt", "chatgpt",
  "llm", "large language", "openai", "anthropic", "claude", "gemini", "deepseek",
  "yandexgpt", "гигачат", "кандинск", "генеративн", "робот", "алгоритм",
];

function isAiNews(news) {
  const text = `${news.title} ${news.summary}`.toLowerCase();
  return AI_TERMS.some((term) => text.includes(term));
}

// ------------------------------------------------------------ utilities

const stripTags = (html) =>
  String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const decodeEntities = (s) =>
  String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

const summarize = (text, maxLen = 220) => {
  const t = stripTags(text);
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastDot = cut.lastIndexOf(".");
  const lastSpace = cut.lastIndexOf(" ");
  return (lastDot > maxLen * 0.6 ? cut.slice(0, lastDot) : cut.slice(0, lastSpace)) + "…";
};

async function fetchText(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, text/html, */*" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- RSS

function parseRssDate(node) {
  const pubDate =
    pick(node, "pubDate") || pick(node, "published") || pick(node, "updated") || pick(node, "date");
  if (!pubDate) return null;
  const d = new Date(decodeEntities(pubDate));
  return isNaN(d.getTime()) ? null : d;
}

function pick(node, tag) {
  const el = node.getElementsByTagName(tag)[0];
  if (!el) return null;
  return el.textContent || null;
}

function parseRss(xml, meta, type) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) return [];

  const items = [...doc.getElementsByTagName("item")];
  const entries = [...doc.getElementsByTagName("entry")];
  const nodes = items.length ? items : entries;

  const news = [];
  for (const node of nodes) {
    const title = decodeEntities(pick(node, "title") || "");
    if (!title) continue;

    // link: RSS <link> text, Atom <link href>
    let link = null;
    const linkEl = node.getElementsByTagName("link")[0];
    if (linkEl) link = linkEl.getAttribute("href") || linkEl.textContent || null;

    const description =
      pick(node, "description") ||
      pick(node, "summary") ||
      pick(node, "content") ||
      "";

    const date = parseRssDate(node);
    news.push({
      title,
      summary: summarize(description),
      link: link || meta.url,
      source: meta.source,
      type, // "site" | "telegram"
      sourceUrl: meta.url,
      date: date ? date.toISOString() : null,
    });
  }
  return news;
}

// ------------------------------------------------------------ Telegram

function parseTelegram(html, meta) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const messages = [...doc.querySelectorAll(".tgme_widget_message")];
  const posts = [];
  for (const msg of messages) {
    const textEl = msg.querySelector(".tgme_widget_message_text");
    if (!textEl) continue;
    const text = textEl.textContent.trim();
    if (text.length < 60) continue; // skip short posts / service messages

    const linkEl = msg.querySelector("a.tgme_widget_message_date");
    const link = linkEl ? linkEl.getAttribute("href") : `https://t.me/${meta.channel}`;

    const timeEl = msg.querySelector("time[datetime]");
    const date = timeEl ? new Date(timeEl.getAttribute("datetime")) : null;

    // First sentence-ish chunk as title
    const title = summarize(text, 100).replace(/…$/, "");

    posts.push({
      title,
      summary: summarize(text, 220),
      link,
      source: meta.source,
      type: "telegram",
      sourceUrl: `https://t.me/${meta.channel}`,
      date: date && !isNaN(date.getTime()) ? date.toISOString() : null,
    });
  }
  return posts;
}

// ---------------------------------------------------------- categorize

function categorize(news) {
  const haystack = `${news.title} ${news.summary}`.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const cat of CATEGORY_RULES) {
    let score = 0;
    for (const kw of cat.keywords) {
      if (haystack.includes(kw)) score += kw.length > 6 ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat.id;
    }
  }
  return best || DEFAULT_CATEGORY;
}

function dedupeKey(news) {
  const url = (news.link || "").split("?")[0].replace(/\/$/, "");
  const title = news.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 60);
  return url + "|" + title;
}

// ---------------------------------------------------------------- main

async function main() {
  console.log("Collecting AI news…");

  const tasks = [];
  for (const f of RSS_FEEDS) {
    tasks.push(
      fetchText(f.url)
        .then((xml) => ({ ok: true, data: parseRss(xml, f, "site"), meta: f }))
        .catch((e) => ({ ok: false, error: String(e.message || e), meta: f }))
    );
  }
  for (const t of TELEGRAM_CHANNELS) {
    tasks.push(
      fetchText(`https://t.me/s/${t.channel}`)
        .then((html) => ({ ok: true, data: parseTelegram(html, t), meta: t }))
        .catch((e) => ({ ok: false, error: String(e.message || e), meta: t }))
    );
  }

  const results = await Promise.allSettled(tasks);

  let all = [];
  const failed = [];
  for (const r of results) {
    const v = r.value;
    if (v && v.ok) {
      all.push(...v.data);
      console.log(`  ✓ ${v.meta.source}: ${v.data.length} items`);
    } else if (v) {
      failed.push(v.meta.source);
      console.warn(`  ✗ ${v.meta.source}: ${v.error}`);
    }
  }

  // Keep freshest items without a date too (they are usually newest at feed top)
  all.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  // Keep only AI-related entries, then deduplicate
  const seen = new Set();
  const deduped = [];
  for (const n of all.filter(isAiNews)) {
    const key = dedupeKey(n);
    if (seen.has(key)) continue;
    seen.add(key);
    n.category = categorize(n);
    deduped.push(n);
  }

  // Round-robin across categories so every tab has content
  const byCat = new Map();
  for (const cat of [...CATEGORY_RULES.map((c) => c.id), DEFAULT_CATEGORY]) byCat.set(cat, []);
  for (const n of deduped) byCat.get(n.category)?.push(n);

  const selected = [];
  let added = true;
  while (selected.length < MAX_NEWS && added) {
    added = false;
    for (const cat of byCat.values()) {
      if (selected.length >= MAX_NEWS) break;
      const n = cat.shift();
      if (n) {
        selected.push(n);
        added = true;
      }
    }
  }

  // Per-category list for the tabs: only the selected items, newest first
  const categories = {};
  for (const n of selected) {
    const { title, summary, link, source, type, sourceUrl, date } = n;
    (categories[n.category] ??= []).push({ title, summary, link, source, type, sourceUrl, date });
  }

  const output = {
    updatedAt: new Date().toISOString(),
    updatedAtLocal: new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date()),
    failedSources: failed,
    total: selected.length,
    categories: CATEGORY_RULES.map(({ id, label }) => ({
      id,
      label,
      items: categories[id] || [],
    })).concat(
      selected.some((n) => n.category === DEFAULT_CATEGORY)
        ? [{ id: DEFAULT_CATEGORY, label: "Разное", items: categories[DEFAULT_CATEGORY] || [] }]
        : []
    ),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2), "utf-8");
  console.log(
    `Wrote ${OUT_PATH}: ${output.total} news, ${output.categories.filter((c) => c.items.length).length} non-empty categories.` +
      (failed.length ? ` Failed sources: ${failed.join(", ")}` : "")
  );
}

main().catch((e) => {
  console.error("Updater failed:", e);
  process.exit(1);
});
