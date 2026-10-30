#!/usr/bin/env node
/**
 * AI News Dashboard updater.
 * Collects AI news from RSS feeds and Telegram public channels,
 * categorizes them, deduplicates, and writes data/news.json.
 *
 * Sources are collected resiliently: a failing source is skipped
 * without breaking the whole update.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "linkedom";
import { CATEGORY_RULES, DEFAULT_CATEGORY, MAX_PER_CATEGORY, categorize, isAiNews } from "./news-rules.mjs";
import { fetchWithRetry, mapWithConcurrency } from "./retry.mjs";
import { seedTelegramCache, mergeTelegramPosts, markTelegramPostsStale } from "./telegram-cache.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_PATH = resolve(ROOT, "data", "news.json");
const TELEGRAM_CACHE_PATH = resolve(ROOT, "data", "telegram-cache.json");
const TELEGRAM_CONCURRENCY = 2;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// ---------------------------------------------------------------- sources

const RSS_FEEDS = [
  { url: "https://habr.com/ru/rss/hubs/artificial_intelligence/all/?fl=ru", source: "Хабр · ИИ", aiFocused: true },
  { url: "https://habr.com/ru/rss/hubs/machine_learning/all/?fl=ru", source: "Хабр · Машинное обучение", aiFocused: true },
  { url: "https://habr.com/ru/rss/all/all/?fl=ru", source: "Хабр" },
  { url: "https://vc.ru/rss", source: "vc.ru" },
  { url: "https://www.cnews.ru/inc/rss/news.xml", source: "CNews" },
  { url: "https://www.ixbt.com/export/news.rss", source: "iXBT" },
  { url: "https://naked-science.ru/feed", source: "Naked Science" },
  { url: "https://tass.ru/rss/v2.xml", source: "ТАСС" },
  { url: "https://www.interfax.ru/rss.asp", source: "Интерфакс" },
  { url: "https://ria.ru/export/rss2/archive/index.xml", source: "РИА Новости" },
  { url: "https://www.vedomosti.ru/rss/news", source: "Ведомости" },
];

const TELEGRAM_CHANNELS = [
  { channel: "neurobureau", source: "Neuro Bureau", aiFocused: true },
  { channel: "GPTMainNews", source: "GPTMain News", aiFocused: true },
  { channel: "hiaimedia", source: "Hi, AI", aiFocused: true },
  { channel: "gptpublic", source: "ChatGPT · Нейросети", aiFocused: true },
  { channel: "neuraldvig", source: "Нейродвиж", aiFocused: true },
  { channel: "chatgpt_try", source: "TryChatGPT.ru", aiFocused: true },
  { channel: "ai_newz", source: "эйай ньюз", aiFocused: true },
  { channel: "StableDiffusionBest", source: "Stable Diffusion News", aiFocused: true },
  { channel: "AI_Chad", source: "Chad GPT", aiFocused: true },
  { channel: "neuro_channel", source: "Нейросети · Инструменты", aiFocused: true },
  { channel: "ml_product", source: "ML Product", aiFocused: true },
];

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
      aiFocused: Boolean(meta.aiFocused),
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
    const text = textEl.textContent.replace(/\u00a0/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 60) continue; // skip short posts / service messages

    const linkEl = msg.querySelector("a.tgme_widget_message_date");
    const link = linkEl ? linkEl.getAttribute("href") : `https://t.me/${meta.channel}`;

    const timeEl = msg.querySelector("time[datetime]");
    const date = timeEl ? new Date(timeEl.getAttribute("datetime")) : null;

    const paragraphs = text.split(/\n+/).map((part) => part.trim()).filter(Boolean);
    const title = summarize(paragraphs[0] || text, 115).replace(/…$/, "");
    const summaryText = paragraphs.length > 1 ? paragraphs.slice(1).join(" ") : text;

    posts.push({
      title,
      summary: summarize(summaryText, 220),
      link,
      source: meta.source,
      type: "telegram",
      sourceUrl: `https://t.me/${meta.channel}`,
      date: date && !isNaN(date.getTime()) ? date.toISOString() : null,
      aiFocused: Boolean(meta.aiFocused),
    });
  }
  return posts;
}

// ---------------------------------------------------------- categorize

function dedupeKey(news) {
  const url = (news.link || "").split("?")[0].replace(/\/$/, "");
  const title = news.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 60);
  return url + "|" + title;
}

// ---------------------------------------------------------------- main

async function main() {
  console.log("Collecting AI news…");

  const rssTasks = [];
  for (const f of RSS_FEEDS) {
    rssTasks.push(
      fetchText(f.url)
        .then((xml) => ({ ok: true, data: parseRss(xml, f, "site"), meta: f }))
        .catch((e) => ({ ok: false, error: String(e.message || e), meta: f }))
    );
  }
  const cachedTelegram = existsSync(TELEGRAM_CACHE_PATH)
    ? JSON.parse(readFileSync(TELEGRAM_CACHE_PATH, "utf-8"))
    : { channels: {} };
  if (!existsSync(TELEGRAM_CACHE_PATH) && existsSync(OUT_PATH)) {
    try {
      const previous = JSON.parse(readFileSync(OUT_PATH, "utf-8"));
      cachedTelegram.channels = seedTelegramCache(previous, TELEGRAM_CHANNELS, dedupeKey).channels;
      console.log(`Seeded Telegram cache from previous dashboard data (${Object.keys(cachedTelegram.channels).length} channels)`);
    } catch (error) {
      console.warn(`Could not seed Telegram cache: ${error.message}`);
    }
  }
  const [rssResults, telegramResults] = await Promise.all([
    Promise.allSettled(rssTasks),
    mapWithConcurrency(TELEGRAM_CHANNELS, TELEGRAM_CONCURRENCY, async (channel) => {
      try {
        const html = await fetchWithRetry(`https://t.me/s/${channel.channel}`, undefined, fetchText);
        const posts = parseTelegram(html, channel);
        const previousPosts = cachedTelegram.channels[channel.channel]?.posts || [];
        const retainedPosts = mergeTelegramPosts(posts, previousPosts, dedupeKey);
        const fetchedAt = new Date().toISOString();
        cachedTelegram.channels[channel.channel] = { fetchedAt, posts: retainedPosts };
        return { ok: true, data: retainedPosts, meta: channel };
      } catch (error) {
        const cached = cachedTelegram.channels[channel.channel];
        return {
          ok: false,
          error: String(error.message || error),
          meta: channel,
          data: cached?.posts || [],
          staleSince: cached?.fetchedAt || null,
        };
      }
    }),
  ]);
  writeFileSync(TELEGRAM_CACHE_PATH, JSON.stringify(cachedTelegram, null, 2), "utf-8");
  const results = [...rssResults, ...telegramResults.map((result) => ({ status: "fulfilled", value: result }))];

  let all = [];
  const failed = [];
  const staleTelegram = [];
  for (const r of results) {
    const v = r.value;
    if (v && v.ok) {
      all.push(...v.data);
      console.log(`  ✓ ${v.meta.source}: ${v.data.length} items`);
    } else if (v) {
      failed.push(v.meta.source);
      console.warn(`  ✗ ${v.meta.source}: ${v.error}`);
      if (v.meta.channel) {
        const cachedPosts = markTelegramPostsStale(v.data);
        all.push(...cachedPosts);
        staleTelegram.push({ channel: v.meta.channel, fetchedAt: v.staleSince, count: v.data.length });
        if (v.data.length) console.log(`    keeping ${v.data.length} cached items${v.staleSince ? ` from ${v.staleSince}` : ""}`);
      }
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

  // Limit each tab independently; fresh items stay first within each category.
  const categories = {};
  for (const id of [...CATEGORY_RULES.map((c) => c.id), DEFAULT_CATEGORY]) {
    categories[id] = deduped
      .filter((n) => n.category === id)
      .slice(0, MAX_PER_CATEGORY)
      .map(({ title, summary, link, source, type, sourceUrl, date, category, stale }) => ({
        title,
        summary,
        link,
        source,
        type,
        sourceUrl,
        date,
        category,
        ...(stale ? { stale: true } : {}),
      }));
  }

  const total = Object.values(categories).reduce((sum, list) => sum + list.length, 0);

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
    staleTelegram,
    total,
    categories: CATEGORY_RULES.map(({ id, label }) => ({
      id,
      label,
      items: categories[id] || [],
    })).concat(
      categories[DEFAULT_CATEGORY].length
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
