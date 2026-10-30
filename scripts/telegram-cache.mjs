export function seedTelegramCache(previous, channels, dedupeKey) {
  const cache = { channels: {} };
  const sourceToChannel = new Map(channels.map((channel) => [channel.source, channel.channel]));

  for (const item of previous.categories.flatMap((category) => category.items || [])) {
    const channel = sourceToChannel.get(item.source);
    if (!channel || item.type !== "telegram") continue;
    const entry = cache.channels[channel] || { fetchedAt: previous.updatedAt, posts: [] };
    entry.posts.push(item);
    cache.channels[channel] = entry;
  }

  for (const entry of Object.values(cache.channels)) {
    const seen = new Set();
    entry.posts = entry.posts.filter((post) => {
      const key = dedupeKey(post);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return cache;
}

export function mergeTelegramPosts(freshPosts, cachedPosts, dedupeKey, limit = 50) {
  const merged = new Map([...cachedPosts, ...freshPosts].map((post) => {
    const { stale, ...freshPost } = post;
    return [dedupeKey(freshPost), freshPost];
  }));
  return [...merged.values()]
    .sort((a, b) => {
      const dateA = Date.parse(a.date || "") || 0;
      const dateB = Date.parse(b.date || "") || 0;
      if (dateA && dateB) return dateB - dateA;
      if (dateA) return -1;
      if (dateB) return 1;
      return 0;
    })
    .slice(0, limit);
}

export function markTelegramPostsStale(posts) {
  return posts.map((post) => ({ ...post, aiFocused: true, stale: true }));
}
