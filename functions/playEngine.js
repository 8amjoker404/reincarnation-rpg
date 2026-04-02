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

const DEFAULT_ACTIONS = [
  { key: "observe", text: "Observe your surroundings" },
  { key: "move", text: "Move carefully" },
  { key: "hide", text: "Hide and listen" },
  { key: "rest", text: "Rest and recover" }
];

async function startGameScene(userId) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

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

    let currentScene = await getCurrentSceneByPlayerId(connection, player.id);

    if (currentScene) {
      await syncPlayerSkillsForPlayer(connection, player.id);

      const freshPlayer = await getPlayerById(connection, player.id);
      const zone = await getResolvedCurrentZone(connection, freshPlayer, currentScene.zone_id);
      const traits = await getPlayerTraits(connection, player.id);
      const actionLogs = await getPlayerActionLogs(connection, player.id);
      const skills = await getPlayerSkillsSummary(connection, player.id);
      const aiMeta = await getSceneAiMetaBySceneId(connection, currentScene.id);

      await connection.commit();

      return {
        status: 200,
        body: {
          success: true,
          message: "Current scene already exists",
          data: {
            player: formatPlayer(freshPlayer),
            zone: formatZone(zone),
            current_scene: formatScene(currentScene),
            traits: formatTraits(traits),
            action_logs: actionLogs,
            skills,
            ai: aiMeta
          }
        }
      };
    }

    let zone = await getResolvedCurrentZone(connection, player, player.current_zone_id);

    if (!zone) {
      zone = await getStarterZone(connection);

      if (!zone) {
        await connection.rollback();
        return {
          status: 500,
          body: {
            success: false,
            message: "No valid starter zone found"
          }
        };
      }
    }

    if (!player.current_zone_id || Number(player.current_zone_id) !== Number(zone.id)) {
      await connection.query(
        `
          UPDATE players
          SET current_zone_id = ?
          WHERE id = ?
        `,
        [zone.id, player.id]
      );
      player.current_zone_id = zone.id;
    }

    await syncPlayerSkillsForPlayer(connection, player.id);

    const freshPlayer = await getPlayerById(connection, player.id);
    const traits = await getPlayerTraits(connection, player.id);
    const actionLogs = await getPlayerActionLogs(connection, player.id);
    const skills = await getPlayerSkillsSummary(connection, player.id);

    const starterBaseScene = buildStartupBaseScene({
      player: freshPlayer,
      zone
    });

    const aiPresentation = await buildAiPresentation({
      player: freshPlayer,
      zone,
      scene: starterBaseScene,
      previousScene: null,
      actionKey: null,
      event: null,
      traits,
      actionLogs,
      skills
    });

    const savedScene = await createSceneFromAiResult(
      connection,
      freshPlayer,
      zone,
      aiPresentation
    );

    await upsertSceneAiCache(connection, {
      playerId: freshPlayer.id,
      playerSceneId: savedScene.id,
      sourceSceneUpdatedAt: savedScene.updated_at,
      baseScene: starterBaseScene,
      aiResult: aiPresentation
    });

    await connection.query(
      `
        UPDATE players
        SET has_started_scene = 1
        WHERE id = ?
      `,
      [freshPlayer.id]
    );

    const finalPlayer = await getPlayerById(connection, freshPlayer.id);
    const aiMeta = await getSceneAiMetaBySceneId(connection, savedScene.id);

    await connection.commit();

    return {
      status: 200,
      body: {
        success: true,
        message: "Game started successfully",
        data: {
          player: formatPlayer(finalPlayer),
          zone: formatZone(zone),
          current_scene: formatScene(savedScene),
          traits: formatTraits(traits),
          action_logs: actionLogs,
          skills,
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
        message: "Failed to start game",
        error: error.message
      }
    };
  } finally {
    connection.release();
  }
}

async function getCurrentPlayState(userId) {
  const connection = await db.getConnection();

  try {
    const player = await getAlivePlayerByUserId(connection, userId);

    if (!player) {
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
      return {
        status: 404,
        body: {
          success: false,
          message: "No active scene found. Start the game first."
        }
      };
    }

    await syncPlayerSkillsForPlayer(connection, player.id);

    const freshPlayer = await getPlayerById(connection, player.id);
    const zone = await getResolvedCurrentZone(connection, freshPlayer, currentScene.zone_id);
    const traits = await getPlayerTraits(connection, player.id);
    const actionLogs = await getPlayerActionLogs(connection, player.id);
    const skills = await getPlayerSkillsSummary(connection, player.id);
    const aiMeta = await getSceneAiMetaBySceneId(connection, currentScene.id);

    return {
      status: 200,
      body: {
        success: true,
        message: "Current play state fetched successfully",
        data: {
          player: formatPlayer(freshPlayer),
          zone: formatZone(zone),
          current_scene: formatScene(currentScene),
          traits: formatTraits(traits),
          action_logs: actionLogs,
          skills,
          ai: aiMeta
        }
      }
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        success: false,
        message: "Failed to fetch current play state",
        error: error.message
      }
    };
  } finally {
    connection.release();
  }
}

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

    let currentZone = await getResolvedCurrentZone(connection, player, currentScene.zone_id);

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

    const resolution = await resolvePlayAction(connection, {
      player,
      currentScene,
      currentZone,
      actionKey,
      payload
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

    const nextZone = await resolveNextZone(connection, resolution, currentZone, updatedPlayer);

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
      resolution
    });

    const aiPresentation = await buildAiPresentation({
      player: finalPlayer,
      zone: nextZone,
      scene: baseNextScene,
      previousScene: formatScene(currentScene),
      actionKey,
      event: resolution?.event || null,
      traits,
      actionLogs,
      skills
    });

    const savedScene = await createSceneFromAiResult(
      connection,
      finalPlayer,
      nextZone,
      aiPresentation
    );

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

/**
 * Required helper:
 * Takes AI output and writes the playable scene into player_current_scene.
 */
async function createSceneFromAiResult(connection, player, zone, aiPresentation) {
  const finalScene = sanitizeSceneForStorage(aiPresentation?.scene, zone);

  const [result] = await connection.query(
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

  let sceneId = result.insertId;

  if (!sceneId) {
    const existing = await getCurrentSceneByPlayerId(connection, player.id);
    sceneId = existing?.id || null;
  }

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
  actionKey = null,
  event = null,
  traits = null,
  actionLogs = [],
  skills = []
}) {
  const baseScene = sanitizeSceneForStorage(scene, zone);
  const baseEvent = event ? { ...event } : null;

  const narrationResult = await safeNarrateScene({
    player,
    zone,
    scene: baseScene,
    previousScene,
    actionKey,
    event: baseEvent,
    actionLogs,
    traits,
    skills
  });

  const choiceResult = await safeEnhanceChoiceTexts({
    player,
    zone,
    scene: baseScene,
    previousScene,
    actionKey,
    event: baseEvent,
    actionLogs,
    traits,
    skills
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

function buildStartupBaseScene({ player, zone }) {
  const raceName = player.subtype_name || player.race_name || "creature";

  return sanitizeSceneForStorage(
    {
      scene_title: `Awakening in ${zone.name}`,
      scene_text:
        `${player.character_name || "You"} awaken as a ${raceName} in ${zone.name}. ` +
        `The world feels unfamiliar, dangerous, and alive. ` +
        `Your instincts are raw, your body is weak, and every choice from here will shape survival.`,
      environment_tag: zone.environment_tag || zone.zone_type || "wild",
      danger_level: normalizeDangerLevel(zone.difficulty_level),
      actions: DEFAULT_ACTIONS
    },
    zone
  );
}

function buildContinuationBaseScene({
  previousScene,
  player,
  zone,
  event,
  actionKey,
  resolution
}) {
  const eventSummary =
    cleanString(event?.summary) ||
    cleanString(resolution?.event?.summary) ||
    "The world reacts to your choice.";

  const titlePrefix = getActionSceneTitlePrefix(actionKey);

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
      actions: normalizeActions(resolution?.nextScene?.actions || DEFAULT_ACTIONS)
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

async function getStarterZone(connection) {
  const [safeRows] = await connection.query(
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
      WHERE is_active = 1 AND is_safe_zone = 1
      ORDER BY id ASC
      LIMIT 1
    `
  );

  if (safeRows.length) {
    return safeRows[0];
  }

  const [fallbackRows] = await connection.query(
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
      WHERE is_active = 1
      ORDER BY id ASC
      LIMIT 1
    `
  );

  return fallbackRows[0] || null;
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
  const actions = normalizeActions(scene?.actions || DEFAULT_ACTIONS);

  return {
    scene_title: cleanString(scene?.scene_title) || `Scene in ${zone.name}`,
    scene_text:
      cleanString(scene?.scene_text) || "The world shifts around you.",
    environment_tag:
      cleanString(scene?.environment_tag) ||
      cleanString(zone?.environment_tag) ||
      cleanString(zone?.zone_type) ||
      "wild",
    danger_level: normalizeDangerLevel(scene?.danger_level || zone?.difficulty_level),
    actions
  };
}

function normalizeActions(actions) {
  const normalized = Array.isArray(actions) ? actions : [];

  const finalActions = [];

  for (let i = 0; i < 4; i += 1) {
    const raw = normalized[i] || DEFAULT_ACTIONS[i] || DEFAULT_ACTIONS[0];
    const key = normalizeActionKey(raw.key || raw.action_key || DEFAULT_ACTIONS[i].key);

    finalActions.push({
      slot: i + 1,
      key,
      text:
        cleanString(raw.text || raw.label || raw.name) ||
        getDefaultActionText(key)
    });
  }

  return finalActions;
}

function normalizeActionKey(key) {
  const normalized = String(key || "").trim().toLowerCase();

  if (ALLOWED_ACTION_KEYS.includes(normalized)) {
    return normalized;
  }

  return DEFAULT_ACTIONS.find((item) => item.key === normalized)?.key || "observe";
}

function getDefaultActionText(actionKey) {
  switch (actionKey) {
    case "observe":
      return "Observe your surroundings";
    case "move":
      return "Move carefully";
    case "hide":
      return "Hide and listen";
    case "rest":
      return "Rest and recover";
    case "attack":
      return "Attack the threat";
    case "use_skill":
      return "Use a skill";
    default:
      return "Continue forward";
  }
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

function cleanString(value) {
  const result = String(value || "").trim();
  return result || null;
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

module.exports = {
  startGameScene,
  getCurrentPlayState,
  playAction,
  createSceneFromAiResult,
  getAlivePlayerByUserId,
  getPlayerById,
  getZoneById,
  getStarterZone,
  getCurrentSceneByPlayerId
};