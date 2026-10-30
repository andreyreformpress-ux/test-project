import test from "node:test";
import assert from "node:assert/strict";

import { fetchWithRetry, mapWithConcurrency } from "./retry.mjs";

test("retries Telegram fetches with exponential backoff and returns on success", async () => {
  let calls = 0;
  const delays = [];
  const result = await fetchWithRetry(
    "https://example.test/channel",
    3,
    async () => {
      calls += 1;
      if (calls < 3) throw new Error("temporary failure");
      return "ok";
    },
    async (delay) => delays.push(delay),
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [1500, 3000]);
});

test("throws the final fetch error after exhausting retries", async () => {
  let calls = 0;
  await assert.rejects(
    fetchWithRetry(
      "https://example.test/channel",
      3,
      async () => {
        calls += 1;
        throw new Error("network unavailable");
      },
      async () => {},
    ),
    /network unavailable/,
  );
  assert.equal(calls, 3);
});

test("limits concurrent channel requests while preserving result order", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return item * 2;
  });

  assert.equal(peak, 2);
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
});
