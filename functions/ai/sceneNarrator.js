// functions/ai/sceneNarrator.js

const { generateWithHuggingFace } = require("./huggingFaceClient");
const { SYSTEM_PROMPT } = require("./prompts/systemPrompt");
const {
  buildPromptMemory,
  buildNarrationUserPrompt
} = require("./promptMemoryBuilder");

function sanitizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

async function narrateScene({
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
  try {
    const memory = buildPromptMemory({
      mode: event ? "action_result" : "scene",
      player,
      zone,
      scene,
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
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildNarrationUserPrompt(memory),
      jsonMode: true,
      maxTokens: 260,
      temperature: 0.6
    });

    if (!result.success || !result.parsed) {
      return {
        ok: false,
        reason: result.error || result.message || "AI narration failed"
      };
    }

    const parsed = result.parsed;

    return {
      ok: true,
      data: {
        scene_title: sanitizeText(parsed.scene_title, scene?.scene_title || ""),
        scene_text: sanitizeText(parsed.scene_text, scene?.scene_text || ""),
        event_summary: sanitizeText(parsed.event_summary, event?.summary || "")
      },
      model: result.model
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.message
    };
  }
}

module.exports = {
  narrateScene
};