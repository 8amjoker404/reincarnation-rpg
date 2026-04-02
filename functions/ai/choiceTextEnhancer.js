// functions/ai/choiceTextEnhancer.js

const { generateWithHuggingFace } = require("./huggingFaceClient");
const {
  buildPromptMemory,
  buildChoiceEnhancerUserPrompt
} = require("./promptMemoryBuilder");

function normalizeChoiceArray(actions = []) {
  return Array.isArray(actions)
    ? actions
        .filter(Boolean)
        .slice(0, 4)
        .map((action) => ({
          key: String(action?.key || "").trim().toLowerCase(),
          text: String(action?.text || "").trim()
        }))
    : [];
}

function sanitizeText(text, fallback = "") {
  const cleaned = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

function stripWrappingQuotes(text = "") {
  const value = String(text || "").trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function parseChoiceTextResponse(rawText = "") {
  const cleaned = stripWrappingQuotes(
    String(rawText || "")
      .replace(/\r/g, "")
      .replace(/\n+/g, " ")
      .trim()
  );

  if (!cleaned) {
    return null;
  }

  const parts = cleaned
    .split("||")
    .map((part) => sanitizeText(part))
    .filter(Boolean);

  if (parts.length !== 4) {
    return null;
  }

  return parts;
}

function mapEnhancedChoices(originalActions = [], enhancedTexts = []) {
  const base = normalizeChoiceArray(originalActions);

  if (base.length !== 4 || !Array.isArray(enhancedTexts) || enhancedTexts.length !== 4) {
    return null;
  }

  return base.map((choice, index) => ({
    key: choice.key,
    text: sanitizeText(enhancedTexts[index], choice.text)
  }));
}

async function enhanceChoiceTexts({
  player,
  zone,
  scene,
  event = null,
  actionLogs = [],
  traits = null,
  skills = []
}) {
  const originalActions = normalizeChoiceArray(scene?.actions || []);

  try {
    if (originalActions.length !== 4) {
      return {
        ok: false,
        reason: "Scene does not contain exactly 4 actions",
        data: originalActions,
        model: null
      };
    }

    const memory = buildPromptMemory({
      mode: "choices",
      player,
      zone,
      scene: {
        ...scene,
        actions: originalActions
      },
      event,
      actionLogs,
      traits,
      skills
    });

    const result = await generateWithHuggingFace({
      userPrompt: buildChoiceEnhancerUserPrompt(memory),
      jsonMode: false,
      maxTokens: 120,
      temperature: 0.3
    });

    console.log("=== CHOICE ENHANCER RAW RESULT ===");
    console.log(JSON.stringify(result, null, 2));

    if (!result?.success) {
      return {
        ok: false,
        reason: result?.error || result?.message || "AI choice enhancement failed",
        data: originalActions,
        model: result?.model || null
      };
    }

    const parsedTexts = parseChoiceTextResponse(result?.rawText || "");
    const recoveredChoices = mapEnhancedChoices(originalActions, parsedTexts);

    if (!recoveredChoices) {
      return {
        ok: false,
        reason: "AI returned invalid choice text format",
        data: originalActions,
        model: result?.model || null
      };
    }

    return {
      ok: true,
      data: recoveredChoices,
      model: result?.model || null
    };
  } catch (error) {
    console.error("choiceTextEnhancer error:", error);

    return {
      ok: false,
      reason: error.message || "AI choice enhancement failed",
      data: originalActions,
      model: null
    };
  }
}

module.exports = {
  enhanceChoiceTexts
};