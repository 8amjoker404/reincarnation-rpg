// functions/ai/promptMemoryBuilder.js

function normalizeActionLogs(actionLogs = []) {
  return Array.isArray(actionLogs)
    ? actionLogs.slice(0, 10).map((log) => ({
        action_key: String(log?.action_key || "").trim().toLowerCase(),
        count: Number(log?.count || 0)
      }))
    : [];
}

function normalizeTraits(traits = null) {
  if (!traits || typeof traits !== "object") {
    return null;
  }

  return {
    aggressive: Number(traits.aggressive || 0),
    intelligence: Number(traits.intelligence || 0),
    stealth: Number(traits.stealth || 0),
    survival: Number(traits.survival || 0)
  };
}

function normalizeSkills(skills = []) {
  return Array.isArray(skills)
    ? skills.slice(0, 10).map((skill) => ({
        id: skill?.id || null,
        name: String(skill?.name || "").trim(),
        skill_type: String(skill?.skill_type || "").trim().toLowerCase(),
        description: String(skill?.description || "").trim()
      }))
    : [];
}

function normalizeActions(actions = []) {
  return Array.isArray(actions)
    ? actions.slice(0, 4).map((action) => ({
        key: String(action?.key || "").trim().toLowerCase(),
        text: String(action?.text || "").trim()
      }))
    : [];
}

function buildPromptMemory({
  mode = "scene",
  player = null,
  zone = null,
  scene = null,
  event = null,
  actionLogs = [],
  traits = null,
  skills = []
}) {
  return {
    mode,
    player: player
      ? {
          id: player.id || null,
          name: player.name || null,
          level: Number(player.level || 1),
          hp: Number(player.hp || 0),
          max_hp: Number(player.max_hp || 0),
          energy: Number(player.energy || 0),
          max_energy: Number(player.max_energy || 0),
          hunger: Number(player.hunger || 0),
          evolution_stage: player.evolution_stage || null,
          race_name: player.race_name || null,
          race_subtype_name: player.race_subtype_name || null
        }
      : null,

    zone: zone
      ? {
          id: zone.id || null,
          name: zone.name || null,
          description: zone.description || null,
          environment_tag: zone.environment_tag || null,
          danger_level: Number(zone.danger_level || 0)
        }
      : null,

    scene: scene
      ? {
          scene_title: scene.scene_title || "",
          scene_text: scene.scene_text || "",
          danger_level: Number(scene.danger_level || 0),
          environment_tag: scene.environment_tag || null,
          actions: normalizeActions(scene.actions || [])
        }
      : null,

    event: event
      ? {
          type: event.type || null,
          action: event.action || null,
          summary: event.summary || null,
          outcome: event.outcome || null
        }
      : null,

    traits: normalizeTraits(traits),
    recent_actions: normalizeActionLogs(actionLogs),
    unlocked_skills: normalizeSkills(skills)
  };
}

function buildNarrationUserPrompt(memory) {
  return `
You are writing the next short scene for a dark fantasy reincarnation RPG.

Important rules:
- Return ONLY valid JSON
- No markdown
- No code fences
- No explanation
- The world is harsh, reactive, mysterious, and survival-focused
- Keep the tone immersive and tense
- The player is weak unless the context clearly shows otherwise
- Make the scene feel alive, dangerous, and grounded
- Give exactly 4 actions
- Each action must use a backend-safe key
- Allowed action keys:
  observe, move, rest, hide, attack, use_skill

Return format:
{
  "title": "string",
  "scene": "string",
  "mood": "string",
  "choices": [
    { "key": "observe", "text": "string" },
    { "key": "move", "text": "string" },
    { "key": "rest", "text": "string" },
    { "key": "hide", "text": "string" }
  ]
}

Game context:
${JSON.stringify(memory, null, 2)}
  `.trim();
}

function buildChoiceEnhancerUserPrompt(memory) {
  const actions = normalizeActions(memory?.scene?.actions || []);

  return `
Rewrite the 4 player choice texts for a dark fantasy reincarnation RPG.

Return exactly one line.
Use this exact separator between each rewritten choice:
||

Rules:
- Return exactly 4 rewritten choice texts
- Keep the exact same order as the input choices
- Do not add numbering
- Do not add bullets
- Do not add labels
- Do not explain anything
- Do not mention consequences
- Each choice text must be short, vivid, and action-based
- Each choice text should be about 2 to 5 words
- Do not return JSON
- Do not repeat the separator more than needed

Input choices:
${JSON.stringify(actions, null, 2)}

Scene context:
${JSON.stringify(
  {
    zone: memory?.zone || null,
    scene: {
      scene_title: memory?.scene?.scene_title || "",
      scene_text: memory?.scene?.scene_text || "",
      danger_level: memory?.scene?.danger_level || 0,
      environment_tag: memory?.scene?.environment_tag || null
    },
    event: memory?.event || null
  },
  null,
  2
)}

Output example:
Scan the shadows || Slip into cover || Creep past the roots || Strike without warning
  `.trim();
}

module.exports = {
  buildPromptMemory,
  buildNarrationUserPrompt,
  buildChoiceEnhancerUserPrompt
};