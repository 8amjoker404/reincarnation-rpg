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

function containsAny(text = "", words = []) {
  const value = String(text || "").toLowerCase();
  return words.some((word) => value.includes(String(word).toLowerCase()));
}

function textMatchesActionKey(key, text) {
  const value = sanitizeText(text).toLowerCase();

  if (!value) {
    return false;
  }

  const allowedMap = {
    observe: [
      "observe",
      "scan",
      "watch",
      "study",
      "inspect",
      "sense",
      "read",
      "survey",
      "look",
      "search"
    ],
    move: [
      "move",
      "advance",
      "step",
      "go",
      "slip",
      "creep",
      "reposition",
      "cross",
      "approach",
      "push forward",
      "head"
    ],
    hide: [
      "hide",
      "blend",
      "conceal",
      "cover",
      "shadow",
      "stay low",
      "vanish",
      "melt",
      "duck",
      "keep low"
    ],
    rest: [
      "rest",
      "recover",
      "pause",
      "breathe",
      "catch your breath",
      "regain",
      "heal",
      "steady yourself",
      "recover strength",
      "regather"
    ],
    attack: [
      "attack",
      "strike",
      "lunge",
      "claw",
      "bite",
      "ambush",
      "hit",
      "slash",
      "pounce",
      "rush",
      "assault"
    ],
    use_skill: [
      "skill",
      "ability",
      "technique",
      "power",
      "spell",
      "art",
      "channel",
      "cast",
      "invoke",
      "activate",
      "use "
    ]
  };

  const blockedMap = {
    observe: [
      "attack",
      "strike",
      "lunge",
      "bite",
      "slash",
      "rest",
      "recover",
      "heal",
      "hide",
      "blend",
      "conceal",
      "cast",
      "invoke"
    ],
    move: [
      "attack",
      "strike",
      "lunge",
      "bite",
      "slash",
      "rest",
      "recover",
      "heal",
      "cast",
      "invoke"
    ],
    hide: [
      "attack",
      "strike",
      "lunge",
      "bite",
      "slash",
      "rest",
      "recover",
      "heal",
      "cast",
      "invoke"
    ],
    rest: [
      "attack",
      "strike",
      "lunge",
      "bite",
      "slash",
      "ambush",
      "pounce",
      "rush",
      "move",
      "advance",
      "creep",
      "hide",
      "blend",
      "conceal",
      "cast",
      "invoke"
    ],
    attack: [
      "rest",
      "recover",
      "heal",
      "pause",
      "catch your breath"
    ],
    use_skill: []
  };

  const allowed = allowedMap[key] || [];
  const blocked = blockedMap[key] || [];

  const hasAllowed = containsAny(value, allowed);
  const hasBlocked = containsAny(value, blocked);

  return hasAllowed && !hasBlocked;
}

function getSafeFallbackText(choice = {}) {
  const key = String(choice?.key || "").trim().toLowerCase();

  const fallbackMap = {
    observe: "Scan the darkness",
    move: "Move carefully ahead",
    hide: "Blend into the shadows",
    rest: "Catch your breath",
    attack: "Strike at the threat",
    use_skill: choice?.text || "Use a skill"
  };

  return fallbackMap[key] || choice?.text || "Take action";
}

function mapEnhancedChoices(originalActions = [], enhancedTexts = []) {
  const base = normalizeChoiceArray(originalActions);

  if (base.length !== 4 || !Array.isArray(enhancedTexts) || enhancedTexts.length !== 4) {
    return null;
  }

  return base.map((choice, index) => {
    const candidateText = sanitizeText(enhancedTexts[index], choice.text);

    return {
      ...choice,
      text: textMatchesActionKey(choice.key, candidateText)
        ? candidateText
        : sanitizeText(choice.text, getSafeFallbackText(choice))
    };
  });
}

async function enhanceChoiceTexts({
  player,
  zone,
  scene,
  event = null,
  actionLogs = [],
  traits = null,
  skills = [],
  currentSceneSnapshot = null,
  sceneHistory = [],
  chosenAction = null,
  backendResult = null,
  zoneNpcs = [],
  playerNpcMemory = []
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
      skills,
      currentSceneSnapshot,
      sceneHistory,
      chosenAction,
      backendResult,
      zoneNpcs,
      playerNpcMemory
    });

    const result = await generateWithHuggingFace({
      userPrompt: buildChoiceEnhancerUserPrompt(memory),
      jsonMode: false,
      maxTokens: 140,
      temperature: 0.2
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