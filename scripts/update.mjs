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
const MAX_PER_CATEGORY = 20;

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

// ------------------------------------------------------------ categories

const CATEGORY_RULES = [
  {
    id: "models",
    label: "Модели и релизы",
    patterns: [
      /(?:нов(?:ая|ый|ую)|представил[аи]?|выпустил[аи]?|запустил[аи]?|обновил[аи]?|релиз|вышла|вышел|доступна|доступен|обучил[аи]?).{0,55}(?:модел|нейросет|llm|gpt|claude|gemini|llama|mistral|deepseek|gigachat|гигачат|yandexgpt)/i,
      /(?:модел|нейросет).{0,45}(?:gpt|claude|gemini|llama|mistral|deepseek|релиз|выпуск|обновлен|верси|параметр|вес)/i,
      /(?<![\p{L}\p{N}])(?:gpt|claude|gemini|llama|mistral|deepseek|yandexgpt|gigachat)(?![\p{L}\p{N}]).{0,55}(?:выпуст|представ|релиз|обнов|модел|нейросет)/iu,
      /(?:открыт(?:ые|ых) веса|open weights|open-weight|большая языковая модель)/i,
    ],
  },
  {
    id: "business",
    label: "Бизнес и инвестиции",
    patterns: [
      /(?:инвестиц|финансирован|раунд|привлек[лаи]?|вложил[аи]?|купил[аи]?|приобрел[аи]?|поглотил[аи]?|стартап|оценк[аи] компании|выручк[аи]|доход[аы]|миллиардн(?:ый|ая|ое) сделк)/i,
      /(?:компани|стартап|сервис|платформ).{0,60}(?:инвестиц|финансирован|раунд|купил|приобрел|оценк|выручк|прибыл)/i,
      /\b(?:ipo|funding|investment round|acquisition|valuation|raises? \$|billion investment)\b/i,
    ],
  },
  {
    id: "research",
    label: "Исследования",
    patterns: [
      /(?:учен(?:ые|ые)|исследовател|научн(?:ая|ое|ый)|лаборатори).{0,65}(?:открыли|выявили|обнаружили|доказали|разработали|создали|опубликовали|исследован|эксперимент)/i,
      /(?:исследован|эксперимент|научн(?:ая|ое|ый) работ|препринт|публикац|arxiv|бенчмарк|датасет|обучени с подкреплением|интерпретируемост)/i,
      /\b(?:arxiv|peer-reviewed|research paper|scientific study|reinforcement learning)\b/i,
    ],
  },
  {
    id: "policy",
    label: "Регулирование",
    patterns: [
      /(?:закон|законопроект|регулирован|регулятор|госдум|министерств|суд|иск против|штраф|запретил|запретят|авторск(?:ое право|их прав)|персональн(?:ые данные|ых данных)|лицензирован|заблокир|банит аккаунт)/i,
      /(?:власти|правительств|евросоюз|еврокомисс|роскомнадзор|ркн).{0,55}(?:ии|искусственн(?:ого интеллекта|ому интеллекту)|нейросет|законе|запрет|регулир)/i,
      /\b(?:eu ai act|ai regulation|copyright lawsuit|ai safety law|regulator)\b/i,
    ],
  },
  {
    id: "applications",
    label: "Применение и инструменты",
    patterns: [
      /(?:внедрил[аи]?|применя|использу|автоматизир|помогает|помощник|ассистент|инструмент|сервис на базе|приложени|робот для|роботизир|оператор|генератор).{0,70}(?:ии|искусственн(?:ого интеллекта|ым интеллектом)|нейросет|модел|gpt|claude|gemini|алгоритм)/i,
      /(?:ии|искусственн(?:ый интеллект|ого интеллекта)|нейросет|модел|gpt|claude|gemini).{0,70}(?:внедрил|применя|использу|автоматизир|помогает|помощник|ассистент|инструмент|сервис|приложени|робот)/i,
    ],
  },
];
const DEFAULT_CATEGORY = "misc";

// Boundaries prevent false matches such as "ии" inside "России" or "ai" in English words.
const AI_PATTERNS = [
  /искусственн(?:ый интеллект|ого интеллекта|ому интеллекту|ым интеллектом)/i,
  /нейросет|нейронн(?:ая сеть|ые сети|ой сети)|машинн(?:ое обучение|ого обучения)/i,
  /(?<![\p{L}\p{N}])ии(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:ai|gpt|chatgpt|llm|openai|anthropic|claude|gemini|deepseek|yandexgpt|gigachat|llama|mistral)(?![\p{L}\p{N}])/iu,
  /генеративн(?:ый|ая|ое) (?:ии|модел|нейросет)|языков(?:ая модель|ой модели)|компьютерное зрение/i,
  /алгоритм(?: машинного обучения| ии)|обучени(?:е|я) с подкреплением/i,
];

function isAiNews(news) {
  const text = news.aiFocused ? `${news.title} ${news.summary}` : news.title;
  return Boolean(news.aiFocused) || AI_PATTERNS.some((pattern) => pattern.test(text));
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

function categorize(news) {
  const title = news.title.toLowerCase();
  const summary = news.summary.toLowerCase();
  const titleMatches = [];
  const summaryMatches = [];
  for (const cat of CATEGORY_RULES) {
    if (cat.patterns.some((pattern) => pattern.test(title))) titleMatches.push(cat.id);
    else if (cat.patterns.some((pattern) => pattern.test(summary))) summaryMatches.push(cat.id);
  }
  if (titleMatches.length === 1) return titleMatches[0];
  if (titleMatches.length > 1) return DEFAULT_CATEGORY;
  if (summaryMatches.length === 1) return summaryMatches[0];
  return DEFAULT_CATEGORY;
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

  // Limit each tab independently; fresh items stay first within each category.
  const categories = {};
  for (const id of [...CATEGORY_RULES.map((c) => c.id), DEFAULT_CATEGORY]) {
    categories[id] = deduped
      .filter((n) => n.category === id)
      .slice(0, MAX_PER_CATEGORY)
      .map(({ title, summary, link, source, type, sourceUrl, date }) => ({
        title,
        summary,
        link,
        source,
        type,
        sourceUrl,
        date,
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
