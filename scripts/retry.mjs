const TELEGRAM_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchWithRetry(url, attempts = TELEGRAM_RETRIES, fetcher, wait = sleep) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetcher(url, 30000);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        console.warn(`    retry ${attempt}/${attempts - 1} in ${delay}ms: ${error.message}`);
        await wait(delay);
      }
    }
  }
  throw lastError;
}

export async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
