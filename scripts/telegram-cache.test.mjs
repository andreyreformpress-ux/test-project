import test from "node:test";
import assert from "node:assert/strict";

import { markTelegramPostsStale, mergeTelegramPosts, seedTelegramCache } from "./telegram-cache.mjs";

const channels = [{ channel: "ai_news", source: "эйай ньюз" }];
const key = (post) => post.link;

test("seeds channel cache from the last published dashboard JSON", () => {
  const cache = seedTelegramCache({
    updatedAt: "2026-10-30T14:00:00.000Z",
    categories: [{ items: [
      { type: "telegram", source: "эйай ньюз", link: "https://t.me/ai_news/1", title: "Post" },
      { type: "site", source: "Example", link: "https://example.test/1", title: "Site" },
    ] }],
  }, channels, key);

  assert.equal(cache.channels.ai_news.fetchedAt, "2026-10-30T14:00:00.000Z");
  assert.equal(cache.channels.ai_news.posts.length, 1);
  assert.equal(cache.channels.ai_news.posts[0].title, "Post");
});

test("keeps cached posts while merging fresh channel posts without duplicates", () => {
  const posts = mergeTelegramPosts(
    [{ link: "post-2", date: "2026-10-30T15:00:00Z", title: "New" }],
    [{ link: "post-1", date: "2026-10-30T14:00:00Z", title: "Cached" }, { link: "post-2", title: "Old duplicate" }],
    key,
  );

  assert.deepEqual(posts.map((post) => post.title), ["New", "Cached"]);
});

test("marks retained posts stale without mutating the cache", () => {
  const cached = [{ title: "Cached", type: "telegram" }];
  const stale = markTelegramPostsStale(cached);

  assert.equal(stale[0].stale, true);
  assert.equal(stale[0].aiFocused, true);
  assert.equal(cached[0].stale, undefined);
});
