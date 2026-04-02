// functions/ai/promptMemoryBuilder.js

function normalizeTraits(traits = null) {
  if (!traits) {
    return {
      aggressive: 0,
      intelligence: 0,
      stealth: 0,
      survival: 0
    };
  }

  return {
    aggressive: Number(traits.aggressive || 0),
    intelligence: Number(traits.intelligence || 0),
    stealth: Number(traits.stealth || 0),
    survival: Number(traits.survival || 0)
  };
}

function normalizeActionLogs(actionLogs = []) {
  return Array.isArray(actionLogs)
    ? actionLogs.slice(0, 12).map((entry) => ({
        action_key: String(entry?.action_key || "").trim().toLowerCase(),
        count: Number(entry?.count || 0)
      }))
    : [];
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
          is_unlocked: Boolean(
            entry?.is_unlocked === undefined ? true : entry?.is_unlocked
          ),
          cooldown_remaining: Number(
            entry?.cooldown_remaining ??
            entry?.current_cooldown ??
            entry?.remaining_cooldown ??
            0
          ),
          energy_cost: Number(skill?.energy_cost ?? entry?.energy_cost ?? 0),
          hp_cost: Number(skill?.hp_cost ?? entry?.hp_cost ?? 0)
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

function normalizeSceneHistory(sceneHistory = []) {
  return Array.isArray(sceneHistory)
    ? sceneHistory.slice(-10).map((entry) => ({
        id: entry?.id || null,
        scene_title: String(entry?.scene_title || "").trim(),
        scene_text: String(entry?.scene_text || "").trim(),
        action_key: String(entry?.action_key || "").trim().toLowerCase(),
        event_summary: String(entry?.event_summary || "").trim(),
        danger_level: Number(entry?.danger_level || 0),
        zone_id: entry?.zone_id || null,
        created_at: entry?.created_at || null
      }))
    : [];
}

function normalizeZoneNpcs(zoneNpcs = []) {
  return Array.isArray(zoneNpcs)
    ? zoneNpcs.slice(0, 10).map((npc) => ({
        npc_id: npc?.npc_id || null,
        name: String(npc?.name || "").trim(),
        npc_key: String(npc?.npc_key || "").trim(),
        race: String(npc?.race || "").trim(),
        role: String(npc?.role || "").trim(),
        presence_state: String(npc?.presence_state || "").trim(),
        disposition: String(npc?.disposition || "").trim(),
        threat_level: Number(npc?.threat_level || 0),
        short_memory_hint: String(npc?.short_memory_hint || "").trim()
      }))
    : [];
}

function normalizePlayerNpcMemory(playerNpcMemory = []) {
  return Array.isArray(playerNpcMemory)
    ? playerNpcMemory.slice(0, 12).map((memory) => ({
        id: memory?.id || null,
        npc_id: memory?.npc_id || null,
        npc_name: String(memory?.npc_name || "").trim(),
        relationship_state: String(memory?.relationship_state || "").trim(),
        familiarity: Number(memory?.familiarity || 0),
        trust_score: Number(memory?.trust_score || 0),
        fear_score: Number(memory?.fear_score || 0),
        hostility_score: Number(memory?.hostility_score || 0),
        last_interaction_summary: String(
          memory?.last_interaction_summary || ""
        ).trim(),
        last_seen_at: memory?.last_seen_at || null
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
  skills = [],
  currentSceneSnapshot = null,
  sceneHistory = [],
  chosenAction = null,
  backendResult = null,
  zoneNpcs = [],
  playerNpcMemory = []
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

    current_scene_snapshot: currentSceneSnapshot
      ? {
          id: currentSceneSnapshot.id || null,
          scene_title: currentSceneSnapshot.scene_title || "",
          scene_text: currentSceneSnapshot.scene_text || "",
          danger_level: Number(currentSceneSnapshot.danger_level || 0),
          environment_tag: currentSceneSnapshot.environment_tag || null
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

    chosen_action: chosenAction
      ? {
          action_key: String(chosenAction.action_key || "").trim().toLowerCase()
        }
      : null,

    backend_result: backendResult
      ? {
          type: backendResult.type || null,
          action: backendResult.action || null,
          summary: backendResult.summary || null,
          outcome: backendResult.outcome || null
        }
      : null,

    traits: normalizeTraits(traits),
    recent_actions: normalizeActionLogs(actionLogs),
    unlocked_skills: normalizeSkills(skills),
    scene_history: normalizeSceneHistory(sceneHistory),
    zone_npcs: normalizeZoneNpcs(zoneNpcs),
    player_npc_memory: normalizePlayerNpcMemory(playerNpcMemory)
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
- The world must feel like a continuation, not a reset
- Respect scene history, recurring NPC presence, and remembered interactions
- If an NPC was recently seen or remembered, the world may hint at them again naturally
- If the environment was changed recently, the new scene should reflect that persistence
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
- Do not contradict backend_result
- Do not erase continuity from scene_history or player_npc_memory

Game context:
${JSON.stringify(memory, null, 2)}
  `.trim();
}

function buildChoiceEnhancerUserPrompt(memory) {
  const actions = normalizeActions(memory?.scene?.actions || []);
  const hasUseSkill = actions.some((action) => action.key === "use_skill");

  return `
Rewrite the 4 player choice texts for a dark fantasy reincarnation RPG.

Return exactly one line.
Use this exact separator between each rewritten choice: ||

Rules:
- Return exactly 4 rewritten choice texts
- Keep the exact same order as the input choices
- Keep each rewritten text semantically faithful to its action key
- Never change the meaning of the action
- Keep continuity with the current scene, scene history, active zone NPCs, and remembered NPC interactions
- If an NPC is clearly present in context, choices may reflect that presence without changing the action meaning
- Never turn a non-attack action into an attack-sounding action
- Never turn rest into attack, move, hide, or observe
- Never turn hide into attack, move, rest, or observe
- Never turn move into rest, hide, attack, or observe
- Never turn observe into move, hide, rest, or attack
- Never turn use_skill into a normal physical action
- Do not invent a skill option if one does not already exist in the input
- If no input choice has key "use_skill", do not make any option sound magical, supernatural, or like a special ability
- If a choice key is use_skill, the text must clearly sound like using a learned ability or named skill
- If the input use_skill text includes a skill name, preserve that skill identity
- Do not add numbering
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
- use_skill = activate a learned ability, channel power, cast a technique, use the named skill

Input choices:
${JSON.stringify(actions, null, 2)}

Has skill option in input: ${hasUseSkill ? "yes" : "no"}

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
    chosen_action: memory?.chosen_action || null,
    backend_result: memory?.backend_result || null,
    scene_history: memory?.scene_history || [],
    zone_npcs: memory?.zone_npcs || [],
    player_npc_memory: memory?.player_npc_memory || [],
    unlocked_skills: memory?.unlocked_skills || []
  },
  null,
  2
)}

Output example:
Scan the darkness || Edge around the roots || Melt into cover || Steady your breathing
  `.trim();
}

module.exports = {
  buildPromptMemory,
  buildNarrationUserPrompt,
  buildChoiceEnhancerUserPrompt
};