// functions/playEngine.js

const db = require("../config/db");
const { ALLOWED_ACTION_KEYS, resolvePlayAction } = require("./actionResolver");
const {
  syncPlayerSkillsForPlayer,
  getPlayerSkillsSummary,
  processSkillCooldowns
} = require("./skillEngine");
const { narrateScene } = require("./ai/sceneNarrator");
const { enhanceChoiceTexts } = require("./ai/choiceTextEnhancer");
const {
  buildSceneActions,
  inferActionSetType,
  getDefaultActionText: getSceneActionDefaultText
} = require("./sceneActionBuilder");

const DEFAULT_ACTIONS = buildSceneActions({
  type: "neutral",
  player: null,
  zone: null,
  skills: []
}).map(({ slot, ...action }) => action);

async function playAction(userId, payload) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const actionKey = String(payload?.action_key || "").trim().toLowerCase();

    if (!actionKey) {
      await connection.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: "action_key is required"
        }
      };
    }

    if (!ALLOWED_ACTION_KEYS.includes(actionKey)) {
      await connection.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: "Invalid action_key",
          allowed_actions: ALLOWED_ACTION_KEYS
        }
      };
    }

    const player = await getAlivePlayerByUserId(connection, userId);

    if (!player) {
      await connection.rollback();
      return {
        status: 404,
        body: {
          success: false,
          message: "No active living player found for this user"
        }
      };
    }

    const currentScene = await getCurrentSceneByPlayerId(connection, player.id);

    if (!currentScene) {
      await connection.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: "No active scene found. Start the game first."
        }
      };
    }

    const currentZone = await getResolvedCurrentZone(
      connection,
      player,
      currentScene.zone_id
    );

    if (!currentZone) {
      await connection.rollback();
      return {
        status: 404,
        body: {
          success: false,
          message: "Current zone not found"
        }
      };
    }

    await syncPlayerSkillsForPlayer(connection, player.id);
    const currentSkills = await getPlayerSkillsSummary(connection, player.id);

    const resolution = await resolvePlayAction(connection, {
      player,
      currentScene,
      currentZone,
      actionKey,
      payload,
      skills: currentSkills
    });

    if (resolution?.event?.skill_error) {
      await connection.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: resolution.event.summary || "Skill action failed"
        }
      };
    }

    const updatedPlayer = await applyPlayerChanges(connection, player, resolution);

    await ensurePlayerTraitsRow(connection, updatedPlayer.id);
    await logPlayerAction(connection, updatedPlayer.id, actionKey);

    await applyTraitGrowth(
      connection,
      updatedPlayer.id,
      resolution?.behaviorTracking?.traitChanges || {}
    );

    await processSkillCooldowns(
      connection,
      updatedPlayer.id,
      resolution?.skillUsage?.player_skill_id || null,
      resolution?.skillUsage?.cooldown_turns || 0
    );

    const nextZone = await resolveNextZone(
      connection,
      resolution,
      currentZone,
      updatedPlayer
    );

    if (Number(updatedPlayer.current_zone_id || 0) !== Number(nextZone.id)) {
      await connection.query(
        `
        UPDATE players
        SET current_zone_id = ?
        WHERE id = ?
        `,
        [nextZone.id, updatedPlayer.id]
      );
      updatedPlayer.current_zone_id = nextZone.id;
    }

    await syncPlayerSkillsForPlayer(connection, updatedPlayer.id);

    const finalPlayer = await getPlayerById(connection, updatedPlayer.id);
    const traits = await getPlayerTraits(connection, updatedPlayer.id);
    const actionLogs = await getPlayerActionLogs(connection, updatedPlayer.id);
    const skills = await getPlayerSkillsSummary(connection, updatedPlayer.id);

    const baseNextScene = buildContinuationBaseScene({
      previousScene: currentScene,
      player: finalPlayer,
      zone: nextZone,
      event: resolution?.event || null,
      actionKey,
      resolution,
      skills
    });

    const aiWorldContext = await buildAiWorldContext(connection, {
      player: finalPlayer,
      zone: nextZone,
      currentScene,
      nextBaseScene: baseNextScene,
      actionKey,
      event: resolution?.event || null
    });

    const aiPresentation = await buildAiPresentation({
      player: finalPlayer,
      zone: nextZone,
      scene: baseNextScene,
      previousScene: formatScene(currentScene),
      currentSceneSnapshot: formatScene(currentScene),
      actionKey,
      event: resolution?.event || null,
      traits,
      actionLogs,
      skills,
      sceneHistory: aiWorldContext.sceneHistory,
      zoneNpcs: aiWorldContext.zoneNpcs,
      playerNpcMemory: aiWorldContext.playerNpcMemory
    });

    const savedScene = await createSceneFromAiResult(
      connection,
      finalPlayer,
      nextZone,
      aiPresentation
    );

    await saveSceneHistoryEntry(connection, {
      player: finalPlayer,
      zone: nextZone,
      currentScene,
      savedScene,
      actionKey,
      event: aiPresentation.event || resolution?.event || null
    });

    await upsertSceneAiCache(connection, {
      playerId: finalPlayer.id,
      playerSceneId: savedScene.id,
      sourceSceneUpdatedAt: savedScene.updated_at,
      baseScene: baseNextScene,
      aiResult: aiPresentation
    });

    const aiMeta = await getSceneAiMetaBySceneId(connection, savedScene.id);

    await connection.commit();

    return {
      status: 200,
      body: {
        success: true,
        message: "Action resolved successfully",
        data: {
          event: aiPresentation.event || resolution?.event || null,
          player: formatPlayer(finalPlayer),
          zone: formatZone(nextZone),
          current_scene: formatScene(savedScene),
          traits: formatTraits(traits),
          action_logs: actionLogs,
          skills,
          scene_history_preview: aiWorldContext.sceneHistory,
          zone_npcs: aiWorldContext.zoneNpcs,
          player_npc_memory: aiWorldContext.playerNpcMemory,
          ai: aiMeta
        }
      }
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {}

    return {
      status: 500,
      body: {
        success: false,
        message: "Failed to resolve action",
        error: error.message
      }
    };
  } finally {
    connection.release();
  }
}

async function createSceneFromAiResult(connection, player, zone, aiPresentation) {
  const finalScene = sanitizeSceneForStorage(aiPresentation?.scene, zone);

  await connection.query(
    `
    INSERT INTO player_current_scene (
      player_id,
      zone_id,
      scene_title,
      scene_text,
      environment_tag,
      danger_level,
      option_1,
      option_1_key,
      option_2,
      option_2_key,
      option_3,
      option_3_key,
      option_4,
      option_4_key
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      zone_id = VALUES(zone_id),
      scene_title = VALUES(scene_title),
      scene_text = VALUES(scene_text),
      environment_tag = VALUES(environment_tag),
      danger_level = VALUES(danger_level),
      option_1 = VALUES(option_1),
      option_1_key = VALUES(option_1_key),
      option_2 = VALUES(option_2),
      option_2_key = VALUES(option_2_key),
      option_3 = VALUES(option_3),
      option_3_key = VALUES(option_3_key),
      option_4 = VALUES(option_4),
      option_4_key = VALUES(option_4_key),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      player.id,
      zone.id,
      finalScene.scene_title,
      finalScene.scene_text,
      finalScene.environment_tag,
      finalScene.danger_level,
      finalScene.actions[0].text,
      finalScene.actions[0].key,
      finalScene.actions[1].text,
      finalScene.actions[1].key,
      finalScene.actions[2].text,
      finalScene.actions[2].key,
      finalScene.actions[3].text,
      finalScene.actions[3].key
    ]
  );

  const savedScene = await getCurrentSceneByPlayerId(connection, player.id);

  if (!savedScene) {
    throw new Error("Failed to save current scene");
  }

  return savedScene;
}

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

function buildContinuationBaseScene({
  previousScene,
  player,
  zone,
  event,
  actionKey,
  resolution,
  skills = []
}) {
  const eventSummary =
    cleanString(event?.summary) ||
    cleanString(resolution?.event?.summary) ||
    "The world reacts to your choice.";

  const titlePrefix = getActionSceneTitlePrefix(actionKey);

  const actionType = inferActionSetType({
    actionKey,
    zone,
    dangerLevel:
      resolution?.nextScene?.danger_level || zone?.difficulty_level || 1
  });

  const generatedActions = buildSceneActions({
    type: actionType,
    player,
    zone,
    skills,
    actionKey
  });

  return sanitizeSceneForStorage(
    {
      scene_title: `${titlePrefix} — ${zone.name}`,
      scene_text:
        `${eventSummary} ` +
        `Now ${player.character_name || "you"} must decide what happens next in ${zone.name}.`,
      environment_tag: zone.environment_tag || zone.zone_type || "wild",
      danger_level: normalizeDangerLevel(
        resolution?.nextScene?.danger_level || zone.difficulty_level
      ),
      actions: generatedActions
    },
    zone
  );
}

function getActionSceneTitlePrefix(actionKey) {
  switch (actionKey) {
    case "observe":
      return "A Careful Reading";
    case "move":
      return "A Shift in the Path";
    case "hide":
      return "Silence Beneath Danger";
    case "rest":
      return "A Fragile Moment of Rest";
    case "attack":
      return "Violence Breaks the Stillness";
    case "use_skill":
      return "Power Answers Your Will";
    default:
      return "The Next Moment";
  }
}

async function buildAiWorldContext(
  connection,
  {
    player,
    zone,
    currentScene = null,
    nextBaseScene = null,
    actionKey = null,
    event = null
  }
) {
  const sceneHistory = await getRecentSceneHistory(connection, player.id, {
    min: 3,
    max: 10,
    preferred: 6
  });

  const zoneNpcs = await getZoneNpcs(connection, zone.id, {
    limit: 12
  });

  const playerNpcMemory = await getPlayerNpcMemory(connection, player.id, zone.id, {
    limit: 12
  });

  return {
    previousScene: currentScene ? formatScene(currentScene) : null,
    currentSceneSnapshot: currentScene
      ? {
          id: currentScene.id,
          zone_id: currentScene.zone_id,
          scene_title: currentScene.scene_title,
          scene_text: currentScene.scene_text,
          environment_tag: currentScene.environment_tag,
          danger_level: currentScene.danger_level,
          actions: formatScene(currentScene).actions
        }
      : nextBaseScene || null,
    chosenAction: actionKey || null,
    backendEvent: event || null,
    sceneHistory,
    zoneNpcs,
    playerNpcMemory
  };
}

async function getRecentSceneHistory(connection, playerId, options = {}) {
  const preferred = clampNumber(options.preferred, 6, 3, 10);

  const queries = [
    {
      sql: `
        SELECT
          id,
          player_id,
          zone_id,
          scene_title,
          scene_text,
          action_key,
          event_summary,
          created_at
        FROM player_scene_history
        WHERE player_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      values: [playerId, preferred]
    },
    {
      sql: `
        SELECT
          id,
          player_id,
          zone_id,
          title AS scene_title,
          description AS scene_text,
          action_key,
          summary AS event_summary,
          created_at
        FROM player_scene_history
        WHERE player_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      values: [playerId, preferred]
    },
    {
      sql: `
        SELECT
          id,
          player_id,
          zone_id,
          scene_title,
          scene_text,
          action_key,
          event_summary,
          created_at
        FROM scene_history
        WHERE player_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      values: [playerId, preferred]
    }
  ];

  const rows = await tryQueryVariants(connection, queries);

  return (rows || [])
    .map((row) => ({
      id: row.id || null,
      player_id: row.player_id || playerId,
      zone_id: row.zone_id || null,
      scene_title: cleanString(row.scene_title) || "Unknown scene",
      scene_text: cleanString(row.scene_text) || "",
      action_key: cleanString(row.action_key) || null,
      event_summary: cleanString(row.event_summary) || null,
      created_at: row.created_at || null
    }))
    .reverse();
}

async function getZoneNpcs(connection, zoneId, options = {}) {
  if (!zoneId) {
    return [];
  }

  const limit = clampNumber(options.limit, 8, 1, 20);

  const queries = [
    {
      sql: `
        SELECT
          zn.id,
          zn.zone_id,
          zn.npc_id,
          zn.presence_type,
          zn.presence_state,
          zn.notes AS zone_notes,
          n.name,
          n.npc_key,
          n.race,
          n.role,
          n.disposition,
          n.description
        FROM zone_npcs zn
        INNER JOIN npcs n ON n.id = zn.npc_id
        WHERE zn.zone_id = ?
        ORDER BY zn.id ASC
        LIMIT ?
      `,
      values: [zoneId, limit]
    },
    {
      sql: `
        SELECT
          zn.id,
          zn.zone_id,
          zn.npc_id,
          zn.presence_type,
          zn.presence_state,
          zn.notes AS zone_notes,
          n.name,
          n.npc_key,
          n.role,
          n.disposition,
          n.description
        FROM zone_npcs zn
        INNER JOIN npcs n ON n.id = zn.npc_id
        WHERE zn.zone_id = ?
        ORDER BY zn.id ASC
        LIMIT ?
      `,
      values: [zoneId, limit]
    }
  ];

  const rows = await tryQueryVariants(connection, queries);

  return (rows || []).map((row) => ({
    id: row.id || null,
    zone_id: row.zone_id || zoneId,
    npc_id: row.npc_id || null,
    name: cleanString(row.name) || "Unknown NPC",
    npc_key: cleanString(row.npc_key) || null,
    race: cleanString(row.race) || null,
    role: cleanString(row.role) || null,
    disposition: cleanString(row.disposition) || null,
    presence_type: cleanString(row.presence_type) || null,
    presence_state: cleanString(row.presence_state) || null,
    zone_notes: cleanString(row.zone_notes) || null,
    description: cleanString(row.description) || null
  }));
}

async function getPlayerNpcMemory(connection, playerId, zoneId = null, options = {}) {
  const limit = clampNumber(options.limit, 8, 1, 20);

  const queries = [
    {
      sql: `
        SELECT
          pnm.id,
          pnm.player_id,
          pnm.npc_id,
          pnm.zone_id,
          pnm.relationship_type,
          pnm.memory_summary,
          pnm.last_interaction_summary,
          pnm.impression,
          pnm.last_seen_at,
          pnm.updated_at,
          n.name,
          n.npc_key,
          n.role
        FROM player_npc_memory pnm
        INNER JOIN npcs n ON n.id = pnm.npc_id
        WHERE pnm.player_id = ?
          AND (? IS NULL OR pnm.zone_id = ? OR pnm.zone_id IS NULL)
        ORDER BY COALESCE(pnm.last_seen_at, pnm.updated_at) DESC, pnm.id DESC
        LIMIT ?
      `,
      values: [playerId, zoneId, zoneId, limit]
    },
    {
      sql: `
        SELECT
          pnm.id,
          pnm.player_id,
          pnm.npc_id,
          pnm.zone_id,
          pnm.relationship_state AS relationship_type,
          pnm.memory_summary,
          pnm.last_interaction_summary,
          pnm.impression,
          pnm.last_seen_at,
          pnm.updated_at,
          n.name,
          n.npc_key,
          n.role
        FROM player_npc_memory pnm
        INNER JOIN npcs n ON n.id = pnm.npc_id
        WHERE pnm.player_id = ?
          AND (? IS NULL OR pnm.zone_id = ? OR pnm.zone_id IS NULL)
        ORDER BY COALESCE(pnm.last_seen_at, pnm.updated_at) DESC, pnm.id DESC
        LIMIT ?
      `,
      values: [playerId, zoneId, zoneId, limit]
    }
  ];

  const rows = await tryQueryVariants(connection, queries);

  return (rows || []).map((row) => ({
    id: row.id || null,
    player_id: row.player_id || playerId,
    npc_id: row.npc_id || null,
    zone_id: row.zone_id || null,
    npc_name: cleanString(row.name) || "Unknown NPC",
    npc_key: cleanString(row.npc_key) || null,
    role: cleanString(row.role) || null,
    relationship_type: cleanString(row.relationship_type) || null,
    memory_summary:
      cleanString(row.memory_summary) ||
      cleanString(row.last_interaction_summary) ||
      null,
    impression: cleanString(row.impression) || null,
    last_seen_at: row.last_seen_at || row.updated_at || null
  }));
}

async function saveSceneHistoryEntry(
  connection,
  {
    player,
    zone,
    currentScene,
    savedScene,
    actionKey,
    event
  }
) {
  const eventSummary = cleanString(event?.summary) || null;
  const sceneTitle = cleanString(savedScene?.scene_title) || cleanString(currentScene?.scene_title);
  const sceneText = cleanString(savedScene?.scene_text) || cleanString(currentScene?.scene_text);

  const insertVariants = [
    {
      sql: `
        INSERT INTO player_scene_history (
          player_id,
          zone_id,
          scene_title,
          scene_text,
          action_key,
          event_summary
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      values: [
        player.id,
        zone?.id || savedScene?.zone_id || currentScene?.zone_id || null,
        sceneTitle,
        sceneText,
        actionKey || null,
        eventSummary
      ]
    },
    {
      sql: `
        INSERT INTO player_scene_history (
          player_id,
          zone_id,
          title,
          description,
          action_key,
          summary
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      values: [
        player.id,
        zone?.id || savedScene?.zone_id || currentScene?.zone_id || null,
        sceneTitle,
        sceneText,
        actionKey || null,
        eventSummary
      ]
    }
  ];

  await executeFirstSuccessfulQuery(connection, insertVariants);
}

async function resolveNextZone(connection, resolution, currentZone, player) {
  if (resolution?.nextZone?.id) {
    const nextZone = await getZoneById(connection, resolution.nextZone.id);
    if (nextZone) {
      return nextZone;
    }
  }

  if (resolution?.nextZoneId) {
    const nextZone = await getZoneById(connection, resolution.nextZoneId);
    if (nextZone) {
      return nextZone;
    }
  }

  if (resolution?.player_updates?.current_zone_id) {
    const nextZone = await getZoneById(
      connection,
      resolution.player_updates.current_zone_id
    );
    if (nextZone) {
      return nextZone;
    }
  }

  if (player?.current_zone_id) {
    const zone = await getZoneById(connection, player.current_zone_id);
    if (zone) {
      return zone;
    }
  }

  return currentZone;
}

async function applyPlayerChanges(connection, player, resolution) {
  const updates = resolution?.player_updates || resolution?.playerUpdates || {};
  const mergedPlayer = {
    ...player,
    ...updates
  };

  await connection.query(
    `
    UPDATE players
    SET
      hp = ?,
      max_hp = ?,
      energy = ?,
      max_energy = ?,
      hunger = ?,
      level = ?,
      year_survived = ?,
      day_survived = ?,
      current_hour = ?,
      age_days = ?,
      attack_stat = ?,
      defense_stat = ?,
      speed_stat = ?,
      intelligence_stat = ?,
      evolution_stage = ?,
      title = ?,
      alignment_type = ?,
      current_zone_id = ?,
      is_alive = ?
    WHERE id = ?
    `,
    [
      safeNumber(mergedPlayer.hp, player.hp),
      safeNumber(mergedPlayer.max_hp, player.max_hp),
      safeNumber(mergedPlayer.energy, player.energy),
      safeNumber(mergedPlayer.max_energy, player.max_energy),
      safeNumber(mergedPlayer.hunger, player.hunger),
      safeNumber(mergedPlayer.level, player.level),
      safeNumber(mergedPlayer.year_survived, player.year_survived),
      safeNumber(mergedPlayer.day_survived, player.day_survived),
      safeNumber(mergedPlayer.current_hour, player.current_hour),
      safeNumber(mergedPlayer.age_days, player.age_days),
      safeNumber(mergedPlayer.attack_stat, player.attack_stat),
      safeNumber(mergedPlayer.defense_stat, player.defense_stat),
      safeNumber(mergedPlayer.speed_stat, player.speed_stat),
      safeNumber(mergedPlayer.intelligence_stat, player.intelligence_stat),
      safeNumber(mergedPlayer.evolution_stage, player.evolution_stage),
      mergedPlayer.title || player.title || null,
      mergedPlayer.alignment_type || player.alignment_type || null,
      safeNumber(mergedPlayer.current_zone_id, player.current_zone_id),
      typeof mergedPlayer.is_alive === "undefined"
        ? player.is_alive
        : mergedPlayer.is_alive
          ? 1
          : 0,
      player.id
    ]
  );

  const freshPlayer = await getPlayerById(connection, player.id);

  if (!freshPlayer) {
    throw new Error("Failed to refresh updated player");
  }

  return freshPlayer;
}

async function ensurePlayerTraitsRow(connection, playerId) {
  await connection.query(
    `
    INSERT INTO player_traits (
      player_id,
      aggressive,
      intelligence,
      stealth,
      survival
    )
    VALUES (?, 0, 0, 0, 0)
    ON DUPLICATE KEY UPDATE
      player_id = VALUES(player_id)
    `,
    [playerId]
  );
}

async function logPlayerAction(connection, playerId, actionKey) {
  await connection.query(
    `
    INSERT INTO player_action_logs (player_id, action_key, count)
    VALUES (?, ?, 1)
    ON DUPLICATE KEY UPDATE
      count = count + 1
    `,
    [playerId, actionKey]
  );
}

async function applyTraitGrowth(connection, playerId, traitChanges) {
  const aggressive = safeNumber(traitChanges.aggressive, 0);
  const intelligence = safeNumber(traitChanges.intelligence, 0);
  const stealth = safeNumber(traitChanges.stealth, 0);
  const survival = safeNumber(traitChanges.survival, 0);

  await connection.query(
    `
    UPDATE player_traits
    SET
      aggressive = aggressive + ?,
      intelligence = intelligence + ?,
      stealth = stealth + ?,
      survival = survival + ?
    WHERE player_id = ?
    `,
    [aggressive, intelligence, stealth, survival, playerId]
  );
}

async function getAlivePlayerByUserId(connection, userId) {
  const [rows] = await connection.query(
    `
    SELECT
      p.id,
      p.user_id,
      p.life_number,
      p.character_name,
      p.race_id,
      p.race_subtype_id,
      p.level,
      p.year_survived,
      p.day_survived,
      p.current_hour,
      p.age_days,
      p.hp,
      p.max_hp,
      p.energy,
      p.max_energy,
      p.hunger,
      p.attack_stat,
      p.defense_stat,
      p.speed_stat,
      p.intelligence_stat,
      p.evolution_stage,
      p.title,
      p.alignment_type,
      p.current_zone_id,
      p.has_started_scene,
      p.is_alive,
      r.name AS race_name,
      r.description AS race_description,
      rs.name AS subtype_name,
      rs.description AS subtype_description
    FROM players p
    INNER JOIN races r ON r.id = p.race_id
    INNER JOIN race_subtypes rs ON rs.id = p.race_subtype_id
    WHERE p.user_id = ? AND p.is_alive = 1
    ORDER BY p.id DESC
    LIMIT 1
    `,
    [userId]
  );

  return rows[0] || null;
}

async function getPlayerById(connection, playerId) {
  const [rows] = await connection.query(
    `
    SELECT
      p.id,
      p.user_id,
      p.life_number,
      p.character_name,
      p.race_id,
      p.race_subtype_id,
      p.level,
      p.year_survived,
      p.day_survived,
      p.current_hour,
      p.age_days,
      p.hp,
      p.max_hp,
      p.energy,
      p.max_energy,
      p.hunger,
      p.attack_stat,
      p.defense_stat,
      p.speed_stat,
      p.intelligence_stat,
      p.evolution_stage,
      p.title,
      p.alignment_type,
      p.current_zone_id,
      p.has_started_scene,
      p.is_alive,
      r.name AS race_name,
      r.description AS race_description,
      rs.name AS subtype_name,
      rs.description AS subtype_description
    FROM players p
    INNER JOIN races r ON r.id = p.race_id
    INNER JOIN race_subtypes rs ON rs.id = p.race_subtype_id
    WHERE p.id = ?
    LIMIT 1
    `,
    [playerId]
  );

  return rows[0] || null;
}

async function getZoneById(connection, zoneId) {
  const [rows] = await connection.query(
    `
    SELECT
      id,
      name,
      zone_type,
      difficulty_level,
      environment_tag,
      description,
      is_safe_zone,
      parent_zone_id
    FROM zones
    WHERE id = ? AND is_active = 1
    LIMIT 1
    `,
    [zoneId]
  );

  return rows[0] || null;
}

async function getResolvedCurrentZone(connection, player, fallbackZoneId = null) {
  if (fallbackZoneId) {
    const zone = await getZoneById(connection, fallbackZoneId);
    if (zone) {
      return zone;
    }
  }

  if (player?.current_zone_id) {
    const zone = await getZoneById(connection, player.current_zone_id);
    if (zone) {
      return zone;
    }
  }

  return null;
}

async function getCurrentSceneByPlayerId(connection, playerId) {
  const [rows] = await connection.query(
    `
    SELECT
      id,
      player_id,
      zone_id,
      scene_title,
      scene_text,
      environment_tag,
      danger_level,
      option_1,
      option_1_key,
      option_2,
      option_2_key,
      option_3,
      option_3_key,
      option_4,
      option_4_key,
      created_at,
      updated_at
    FROM player_current_scene
    WHERE player_id = ?
    LIMIT 1
    `,
    [playerId]
  );

  return rows[0] || null;
}

async function getPlayerTraits(connection, playerId) {
  const [rows] = await connection.query(
    `
    SELECT
      player_id,
      aggressive,
      intelligence,
      stealth,
      survival
    FROM player_traits
    WHERE player_id = ?
    LIMIT 1
    `,
    [playerId]
  );

  if (rows[0]) {
    return rows[0];
  }

  return {
    player_id: playerId,
    aggressive: 0,
    intelligence: 0,
    stealth: 0,
    survival: 0
  };
}

async function getPlayerActionLogs(connection, playerId) {
  const [rows] = await connection.query(
    `
    SELECT action_key, count
    FROM player_action_logs
    WHERE player_id = ?
    ORDER BY action_key ASC
    `,
    [playerId]
  );

  return rows;
}

async function getSceneAiMetaBySceneId(connection, playerSceneId) {
  const [rows] = await connection.query(
    `
    SELECT
      narration_applied,
      choice_text_applied,
      narration_model,
      choice_model,
      narration_error,
      choice_error,
      ai_event_summary
    FROM player_scene_ai_cache
    WHERE player_scene_id = ?
    LIMIT 1
    `,
    [playerSceneId]
  );

  if (!rows[0]) {
    return {
      narration_applied: false,
      choice_text_applied: false,
      narration_model: null,
      choice_model: null,
      narration_error: null,
      choice_error: null
    };
  }

  return {
    narration_applied: Number(rows[0].narration_applied || 0) === 1,
    choice_text_applied: Number(rows[0].choice_text_applied || 0) === 1,
    narration_model: rows[0].narration_model || null,
    choice_model: rows[0].choice_model || null,
    narration_error: rows[0].narration_error || null,
    choice_error: rows[0].choice_error || null,
    ai_event_summary: rows[0].ai_event_summary || null
  };
}

async function upsertSceneAiCache(
  connection,
  {
    playerId,
    playerSceneId,
    sourceSceneUpdatedAt,
    baseScene,
    aiResult
  }
) {
  const rawActionsJson = JSON.stringify(baseScene.actions || []);
  const aiActionsJson = JSON.stringify(aiResult.scene.actions || []);

  await connection.query(
    `
    INSERT INTO player_scene_ai_cache (
      player_id,
      player_scene_id,
      source_scene_updated_at,
      raw_scene_title,
      raw_scene_text,
      raw_actions_json,
      ai_scene_title,
      ai_scene_text,
      ai_actions_json,
      ai_event_summary,
      narration_applied,
      choice_text_applied,
      narration_model,
      choice_model,
      narration_error,
      choice_error
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      player_id = VALUES(player_id),
      source_scene_updated_at = VALUES(source_scene_updated_at),
      raw_scene_title = VALUES(raw_scene_title),
      raw_scene_text = VALUES(raw_scene_text),
      raw_actions_json = VALUES(raw_actions_json),
      ai_scene_title = VALUES(ai_scene_title),
      ai_scene_text = VALUES(ai_scene_text),
      ai_actions_json = VALUES(ai_actions_json),
      ai_event_summary = VALUES(ai_event_summary),
      narration_applied = VALUES(narration_applied),
      choice_text_applied = VALUES(choice_text_applied),
      narration_model = VALUES(narration_model),
      choice_model = VALUES(choice_model),
      narration_error = VALUES(narration_error),
      choice_error = VALUES(choice_error),
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      playerId,
      playerSceneId,
      sourceSceneUpdatedAt || null,
      baseScene.scene_title || null,
      baseScene.scene_text || null,
      rawActionsJson,
      aiResult.scene.scene_title || null,
      aiResult.scene.scene_text || null,
      aiActionsJson,
      aiResult.event?.summary || null,
      aiResult.ai.narration_applied ? 1 : 0,
      aiResult.ai.choice_text_applied ? 1 : 0,
      aiResult.ai.narration_model || null,
      aiResult.ai.choice_model || null,
      aiResult.ai.narration_error || null,
      aiResult.ai.choice_error || null
    ]
  );
}

function sanitizeSceneForStorage(scene, zone) {
  const fallbackActions = buildSceneActions({
    type: inferActionSetType({
      zone,
      dangerLevel: scene?.danger_level || zone?.difficulty_level || 1
    }),
    player: null,
    zone,
    skills: []
  });

  const actions = normalizeActions(scene?.actions || fallbackActions);

  return {
    scene_title: cleanString(scene?.scene_title) || `Scene in ${zone.name}`,
    scene_text:
      cleanString(scene?.scene_text) || "The world shifts around you.",
    environment_tag:
      cleanString(scene?.environment_tag) ||
      cleanString(zone?.environment_tag) ||
      cleanString(zone?.zone_type) ||
      "wild",
    danger_level: normalizeDangerLevel(
      scene?.danger_level || zone?.difficulty_level
    ),
    actions
  };
}

function normalizeActions(actions) {
  const normalized = Array.isArray(actions) ? actions : [];
  const finalActions = [];

  for (let i = 0; i < 4; i += 1) {
    const raw = normalized[i] || DEFAULT_ACTIONS[i] || DEFAULT_ACTIONS[0];
    const key = normalizeActionKey(
      raw.key || raw.action_key || DEFAULT_ACTIONS[i].key
    );

    finalActions.push({
      slot: i + 1,
      key,
      text:
        cleanString(raw.text || raw.label || raw.name) ||
        getSceneActionDefaultText(key)
    });
  }

  return finalActions;
}

function normalizeActionKey(key) {
  const normalized = String(key || "").trim().toLowerCase();

  if (ALLOWED_ACTION_KEYS.includes(normalized)) {
    return normalized;
  }

  return "observe";
}

function normalizeDangerLevel(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return 1;
  }

  if (num < 1) return 1;
  if (num > 10) return 10;

  return Math.floor(num);
}

function formatPlayer(player) {
  return {
    id: player.id,
    user_id: player.user_id,
    life_number: player.life_number,
    character_name: player.character_name,
    race_id: player.race_id,
    race_name: player.race_name,
    race_subtype_id: player.race_subtype_id,
    subtype_name: player.subtype_name,
    level: player.level,
    year_survived: player.year_survived,
    day_survived: player.day_survived,
    current_hour: player.current_hour,
    age_days: player.age_days,
    hp: player.hp,
    max_hp: player.max_hp,
    energy: player.energy,
    max_energy: player.max_energy,
    hunger: player.hunger,
    attack_stat: player.attack_stat,
    defense_stat: player.defense_stat,
    speed_stat: player.speed_stat,
    intelligence_stat: player.intelligence_stat,
    evolution_stage: player.evolution_stage,
    title: player.title,
    alignment_type: player.alignment_type,
    current_zone_id: player.current_zone_id,
    has_started_scene: Number(player.has_started_scene || 0) === 1,
    is_alive: Number(player.is_alive || 0) === 1
  };
}

function formatZone(zone) {
  if (!zone) {
    return null;
  }

  return {
    id: zone.id,
    name: zone.name,
    zone_type: zone.zone_type,
    difficulty_level: zone.difficulty_level,
    environment_tag: zone.environment_tag,
    description: zone.description,
    is_safe_zone: Number(zone.is_safe_zone || 0) === 1,
    parent_zone_id: zone.parent_zone_id
  };
}

function formatScene(scene) {
  return {
    id: scene.id,
    player_id: scene.player_id,
    zone_id: scene.zone_id,
    scene_title: scene.scene_title,
    scene_text: scene.scene_text,
    environment_tag: scene.environment_tag,
    danger_level: scene.danger_level,
    actions: [
      {
        slot: 1,
        key: scene.option_1_key,
        text: scene.option_1
      },
      {
        slot: 2,
        key: scene.option_2_key,
        text: scene.option_2
      },
      {
        slot: 3,
        key: scene.option_3_key,
        text: scene.option_3
      },
      {
        slot: 4,
        key: scene.option_4_key,
        text: scene.option_4
      }
    ],
    created_at: scene.created_at,
    updated_at: scene.updated_at
  };
}

function formatTraits(traits) {
  return {
    aggressive: safeNumber(traits?.aggressive, 0),
    intelligence: safeNumber(traits?.intelligence, 0),
    stealth: safeNumber(traits?.stealth, 0),
    survival: safeNumber(traits?.survival, 0)
  };
}

async function tryQueryVariants(connection, variants = []) {
  let lastError = null;

  for (const variant of variants) {
    try {
      const [rows] = await connection.query(variant.sql, variant.values || []);
      return rows || [];
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    return [];
  }

  return [];
}

async function executeFirstSuccessfulQuery(connection, variants = []) {
  let lastError = null;

  for (const variant of variants) {
    try {
      await connection.query(variant.sql, variant.values || []);
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    return false;
  }

  return false;
}

function clampNumber(value, fallback, min, max) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return fallback;
  }

  if (num < min) return min;
  if (num > max) return max;

  return Math.floor(num);
}

function cleanString(value) {
  const result = String(value || "").trim();
  return result || null;
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

module.exports = {
  playAction
};