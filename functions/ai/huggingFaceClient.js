const { OpenAI } = require("openai");

const client = new OpenAI({
  baseURL: "https://router.huggingface.co/v1",
  apiKey: process.env.HF_TOKEN
});

const MODEL =
  process.env.HF_MODEL ||
  "mistralai/Mistral-7B-Instruct-v0.2:featherless-ai";

function extractTextContent(content) {
  if (!content) return "";

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.type === "text") return item.text || "";
        return "";
      })
      .join("\n")
      .trim();
  }

  if (typeof content === "object") {
    if (typeof content.text === "string") {
      return content.text;
    }
  }

  return String(content || "").trim();
}

function stripCodeFences(text = "") {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function tryParseJson(text = "") {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractBalancedJsonObject(text = "") {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}

function extractBalancedJsonArray(text = "") {
  const start = text.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}

function safeJsonParse(text = "") {
  const cleaned = stripCodeFences(String(text || "").trim());

  let parsed = tryParseJson(cleaned);
  if (parsed) return parsed;

  const objectBlock = extractBalancedJsonObject(cleaned);
  if (objectBlock) {
    parsed = tryParseJson(objectBlock);
    if (parsed) return parsed;
  }

  const arrayBlock = extractBalancedJsonArray(cleaned);
  if (arrayBlock) {
    parsed = tryParseJson(arrayBlock);
    if (parsed) return parsed;
  }

  return null;
}

async function generateWithHuggingFace({
  systemPrompt = "You are a dark fantasy RPG AI. Return JSON when requested.",
  userPrompt = "",
  jsonMode = false,
  maxTokens = 300,
  temperature = 0.7
}) {
  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: userPrompt
        }
      ],
      max_tokens: maxTokens,
      temperature
    });

    const rawContent = response?.choices?.[0]?.message?.content;
    const rawText = extractTextContent(rawContent);
    const parsed = jsonMode ? safeJsonParse(rawText) : null;

    if (jsonMode && !parsed) {
      console.error("HF JSON PARSE FAILED");
      console.error("MODEL:", MODEL);
      console.error("RAW TEXT:");
      console.error(rawText);
    }

    return {
      success: true,
      model: MODEL,
      rawText,
      parsed
    };
  } catch (error) {
    console.error("HF ROUTER ERROR:", error);

    return {
      success: false,
      message: "HF router request failed",
      error:
        error?.error?.message ||
        error?.message ||
        "Unknown error"
    };
  }
}

module.exports = {
  generateWithHuggingFace
};