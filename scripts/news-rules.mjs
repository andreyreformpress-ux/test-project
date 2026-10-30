export const MAX_PER_CATEGORY = 20;
export const DEFAULT_CATEGORY = "misc";

export const CATEGORY_RULES = [
  {
    id: "models",
    label: "Модели и релизы",
    patterns: [
      /(?:представил[аи]?|выпустил[аи]?|запустил[аи]?|обновил[аи]?|релиз|вышла|вышел|доступна|доступен|обучил[аи]?).{0,55}(?:модел|нейросет|llm|gpt|claude|gemini|llama|mistral|deepseek|gigachat|гигачат|yandexgpt)/i,
      /(?:модел|нейросет).{0,45}(?:релиз|выпуск|обновлен|верси|параметр|вес)/i,
      /(?<![\p{L}\p{N}])(?:gpt|claude|gemini|llama|mistral|deepseek|yandexgpt|gigachat)(?![\p{L}\p{N}]).{0,55}(?:выпуст|представ|релиз|обнов|модел|нейросет)/iu,
      /(?:открыт(?:ые|ых) веса|open weights|open-weight|большая языковая модель)/i,
    ],
  },
  {
    id: "business",
    label: "Бизнес и инвестиции",
    patterns: [
      /(?:инвестиц|финансирован|раунд|привлек\w*|вложил\w*|купил\w*|приобрел\w*|приобрёл\w*|поглотил\w*|стартап|оценк[а-я]* компании|выручк[а-я]*|доход[а-я]*|миллиардн(?:ый|ая|ое) сделк)/i,
      /(?:компани|стартап|сервис|платформ).{0,60}(?:инвестиц|финансирован|раунд|купил|приобрел|оценк|выручк|прибыл)/i,
      /\b(?:ipo|funding|investment round|acquisition|valuation|raises? \$|billion investment)\b/i,
    ],
  },
  {
    id: "research",
    label: "Исследования",
    patterns: [
      /(?:учен(?:ые|ые)|учёные|исследовател|научн(?:ая|ое|ый)|лаборатори).{0,65}(?:открыли|выявили|обнаружили|доказали|показали|опубликовали|исследован|эксперимент|результат)/i,
      /(?:исследован|эксперимент|научн(?:ая|ое|ый) работ|препринт|публикац|arxiv|бенчмарк|датасет|обучени с подкреплением|интерпретируемост|ученые установили|учёные установили)/i,
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
      /(?:как|зачем|почему|опыт|практик|гид|гайд|обзор|инструкция).{0,60}(?:нейросет|ии|искусственн(?:ого интеллекта|ым интеллектом)|gpt|claude|midjourney|stable diffusion|hugging ?face|comfyui)/i,
      /(?:нейросет|ии|искусственн(?:ого интеллекта|ым интеллектом)|gpt|claude|midjourney|stable diffusion|hugging ?face|comfyui).{0,60}(?:генерац|создани|настройк|запустить|использовани|инструмент|промпт|автоматизац)/i,
    ],
  },
];

const AI_PATTERNS = [
  /искусственн(?:ый интеллект|ого интеллекта|ому интеллекту|ым интеллектом)/i,
  /нейросет|нейронн(?:ая сеть|ые сети|ой сети)|машинн(?:ое обучение|ого обучения)/i,
  /(?<![\p{L}\p{N}])ии(?![\p{L}\p{N}])/iu,
  /(?<![\p{L}\p{N}])(?:ai|gpt|chatgpt|llm|openai|anthropic|claude|gemini|deepseek|yandexgpt|gigachat|llama|mistral)(?![\p{L}\p{N}])/iu,
  /генеративн(?:ый|ая|ое) (?:ии|модел|нейросет)|языков(?:ая модель|ой модели)|компьютерное зрение/i,
  /алгоритм(?: машинного обучения| ии)|обучени(?:е|я) с подкреплением/i,
];

export function isAiNews(news) {
  const text = news.aiFocused ? `${news.title} ${news.summary}` : news.title;
  return Boolean(news.aiFocused) || AI_PATTERNS.some((pattern) => pattern.test(text));
}

export function categorize(news) {
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
