import test from "node:test";
import assert from "node:assert/strict";

import { categorize, isAiNews } from "./news-rules.mjs";

test("does not treat a mention of Russia as AI", () => {
  assert.equal(isAiNews({ title: "Экономика России показала рост", summary: "" }), false);
});

test("recognizes AI mentions as AI news", () => {
  assert.equal(isAiNews({ title: "Российская нейросеть научилась искать дефекты", summary: "" }), true);
});

test("classifies a model release", () => {
  assert.equal(categorize({ title: "OpenAI выпустила новую модель GPT-5", summary: "" }), "models");
});

test("classifies AI investment news", () => {
  assert.equal(categorize({ title: "Стартап привлёк инвестиции на разработку нейросети", summary: "" }), "business");
});

test("classifies scientific AI findings", () => {
  assert.equal(categorize({ title: "Учёные обнаружили новый способ обучать нейросеть", summary: "" }), "research");
});

test("classifies AI regulation", () => {
  assert.equal(categorize({ title: "Суд запретил компании использовать ИИ без согласия клиентов", summary: "" }), "policy");
});

test("classifies tutorials and practical AI use as applications", () => {
  assert.equal(categorize({ title: "HuggingFace для начинающих: как выбрать и запустить модель", summary: "" }), "applications");
});

test("puts ambiguous stories in miscellaneous", () => {
  assert.equal(categorize({ title: "Российские компании обсуждают новые технологии", summary: "Искусственный интеллект меняет рынок." }), "misc");
});
