const { narrateScene } = require("../ai/sceneNarrator");
const { enhanceChoiceTexts } = require("../ai/choiceTextEnhancer");
const {
  sanitizeSceneForStorage,
  cleanString
} = require("./utils");

async function buildAiPresentation({
  player,
  zone,
  scene,
  previousScene = null,
  currentSceneSnapshot = null,
  actionKey = null,
  event = null,
  traits = null,
  actionLogs = [],
  skills = [],
  sceneHistory = [],
  zoneNpcs = [],
  playerNpcMemory = []
}) {
  const baseScene = sanitizeSceneForStorage(scene, zone);
  const baseEvent = event ? { ...event } : null;

  const narrationResult = await safeNarrateScene({
    player,
    zone,
    scene: baseScene,
    previousScene,
    currentSceneSnapshot,
    actionKey,
    event: baseEvent,
    actionLogs,
    traits,
    skills,
    sceneHistory,
    zoneNpcs,
    playerNpcMemory
  });

  const choiceResult = await safeEnhanceChoiceTexts({
    player,
    zone,
    scene: baseScene,
    previousScene,
    currentSceneSnapshot,
    actionKey,
    event: baseEvent,
    actionLogs,
    traits,
    skills,
    sceneHistory,
    zoneNpcs,
    playerNpcMemory
  });

  const finalScene = {
    ...baseScene,
    actions: [...baseScene.actions]
  };

  if (narrationResult.ok && narrationResult.data) {
    finalScene.scene_title =
      cleanString(narrationResult.data.scene_title) || finalScene.scene_title;

    finalScene.scene_text =
      cleanString(narrationResult.data.scene_text) || finalScene.scene_text;
  }

  if (choiceResult.ok && Array.isArray(choiceResult.data)) {
    finalScene.actions = finalScene.actions.map((action, index) => {
      const updatedText = cleanString(choiceResult.data[index]?.text);
      return {
        ...action,
        text: updatedText || action.text
      };
    });
  }

  const finalEvent = baseEvent
    ? {
        ...baseEvent,
        summary:
          cleanString(narrationResult.data?.event_summary) ||
          cleanString(baseEvent.summary) ||
          null
      }
    : null;

  return {
    scene: sanitizeSceneForStorage(finalScene, zone),
    event: finalEvent,
    ai: {
      narration_applied: narrationResult.ok,
      choice_text_applied: choiceResult.ok,
      narration_model: narrationResult.ok ? narrationResult.model || null : null,
      choice_model: choiceResult.ok ? choiceResult.model || null : null,
      narration_error: narrationResult.ok ? null : narrationResult.reason || null,
      choice_error: choiceResult.ok ? null : choiceResult.reason || null
    }
  };
}

async function safeNarrateScene(payload) {
  try {
    const result = await narrateScene(payload);

    if (!result || typeof result !== "object") {
      return {
        ok: false,
        reason: "Narration returned invalid response",
        model: null,
        data: null
      };
    }

    return {
      ok: !!result.ok,
      reason: result.reason || null,
      model: result.model || null,
      data: result.data || null
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.message,
      model: null,
      data: null
    };
  }
}

async function safeEnhanceChoiceTexts(payload) {
  try {
    const result = await enhanceChoiceTexts(payload);

    if (!result || typeof result !== "object") {
      return {
        ok: false,
        reason: "Choice enhancer returned invalid response",
        model: null,
        data: null
      };
    }

    return {
      ok: !!result.ok,
      reason: result.reason || null,
      model: result.model || null,
      data: Array.isArray(result.data) ? result.data : null
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.message,
      model: null,
      data: null
    };
  }
}

module.exports = {
  buildAiPresentation,
  safeNarrateScene,
  safeEnhanceChoiceTexts
};