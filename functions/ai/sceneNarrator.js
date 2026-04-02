// functions/ai/sceneNarrator.js

const { generateWithHuggingFace } = require("./huggingFaceClient");
const { SYSTEM_PROMPT } = require("./prompts/systemPrompt");
const {
  buildPromptMemory,
  buildSceneNarrationUserPrompt
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
  skills = []
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
      skills
    });

    const result = await generateWithHuggingFace({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildSceneNarrationUserPrompt(memory),
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