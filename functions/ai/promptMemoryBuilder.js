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
    ? skills.slice(0, 10).map((entry) => {
        const skill = entry?.skill || entry || {};

        return {
          id: skill?.id || entry?.skill_id || null,
          name: String(skill?.name || "").trim(),
          skill_key: String(skill?.skill_key || "").trim(),
          skill_type: String(skill?.skill_type || "").trim().toLowerCase(),
          description: String(skill?.description || "").trim(),
          is_unlocked: Boolean(entry?.is_unlocked)
        };
      })
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
          name: player.character_name || player.name || null,
          title: player.title || null,
          level: Number(player.level || 1),
          hp: Number(player.hp || 0),
          max_hp: Number(player.max_hp || 0),
          energy: Number(player.energy || 0),
          max_energy: Number(player.max_energy || 0),
          hunger: Number(player.hunger || 0),
          day_survived: Number(player.day_survived || 1),
          current_hour: Number(player.current_hour || 0),
          evolution_stage: Number(player.evolution_stage || 1),
          race_name: player.race_name || player?.race?.name || null,
          race_subtype_name: player.subtype_name || player?.subtype?.name || null
        }
      : null,

    zone: zone
      ? {
          id: zone.id || null,
          name: zone.name || null,
          description: zone.description || null,
          environment_tag: zone.environment_tag || null,
          difficulty_level: zone.difficulty_level || null,
          is_safe_zone: Number(zone.is_safe_zone || 0)
        }
      : null,

    scene: scene
      ? {
          scene_title: scene.scene_title || "",
          scene_text: scene.scene_text || "",
          danger_level: scene.danger_level || null,
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
You are writing narration for a dark fantasy reincarnation RPG.

Rules:
- Return ONLY valid JSON
- No markdown
- No code fences
- No explanations
- Do NOT generate choices
- Do NOT generate action keys
- Keep it short, immersive, tense, and survival-focused
- The player is usually still weak unless the context clearly shows otherwise

Return format:
{
  "scene_title": "string",
  "scene_text": "string",
  "event_summary": "string"
}

Notes:
- scene_title = short dramatic title
- scene_text = 2 to 5 sentences
- event_summary = one short summary sentence of what just happened
- If there is no event context, event_summary can be an empty string

Game context:
${JSON.stringify(memory, null, 2)}
  `.trim();
}

function buildChoiceEnhancerUserPrompt(memory) {
  const actions = normalizeActions(memory?.scene?.actions || []);

  return `
Rewrite the 4 player choice texts for a dark fantasy reincarnation RPG.

Return exactly one line.
Use this exact separator between each rewritten choice: ||

Rules:
- Return exactly 4 rewritten choice texts
- Keep the exact same order as the input choices
- Keep each rewritten text semantically faithful to its action key
- Never change the meaning of the action
- Never turn a non-attack action into an attack-sounding action
- Never turn rest into attack, move, hide, or observe
- Never turn hide into attack, move, rest, or observe
- Never turn move into rest, hide, attack, or observe
- Never turn observe into move, hide, rest, or attack
- Never turn use_skill into a normal physical action
- If a choice key is use_skill, the text must clearly sound like using a learned ability or special power
- Do not add numbering
- Do not add bullets
- Do not add labels
- Do not explain anything
- Do not mention consequences
- Each choice text must be short, vivid, and action-based
- Each choice text should be about 2 to 5 words
- Do not return JSON
- Do not repeat the separator more than needed

Action key meaning guide:
- observe = inspect, scan, study, watch, sense danger
- move = advance, reposition, creep forward, slip away, head deeper
- hide = conceal yourself, blend in, stay low, melt into cover
- rest = recover, catch breath, steady yourself, regain strength
- attack = strike, ambush, lunge, slash, rush the threat
- use_skill = activate a learned ability, channel power, cast a technique

Input choices:
${JSON.stringify(actions, null, 2)}

Scene context:
${JSON.stringify(
  {
    zone: memory?.zone || null,
    scene: {
      scene_title: memory?.scene?.scene_title || "",
      scene_text: memory?.scene?.scene_text || "",
      danger_level: memory?.scene?.danger_level || null,
      environment_tag: memory?.scene?.environment_tag || null
    },
    event: memory?.event || null
  },
  null,
  2
)}

Output example:
Scan the darkness || Move carefully ahead || Blend into the shadows || Catch your breath
  `.trim();
}

module.exports = {
  buildPromptMemory,
  buildNarrationUserPrompt,
  buildChoiceEnhancerUserPrompt
};