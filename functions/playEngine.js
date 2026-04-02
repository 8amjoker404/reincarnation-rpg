// backend/functions/playEngine.js
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
  { text: "Observe your surroundings", key: "observe" },
  { text: "Move carefully", key: "move" },
  { text: "Hide and listen", key: "hide" },
  { text: "Use a skill", key: "use_skill" }
];

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

    let zone = null;

    if (player.current_zone_id) {
      zone = await getZoneById(connection, player.current_zone_id);
    }

    if (!zone) {
      zone = await getStarterZone(connection);

      if (!zone) {
        return {
          status: 500,
          body: {
            success: false,
            message: "No valid starter zone found"
          }
        };
      }

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

    let currentScene = await getCurrentSceneByPlayerId(connection, player.id);

    if (!currentScene) {
      currentScene = await createStarterScene(connection, player, zone);
    }

    await syncPlayerSkillsForPlayer(connection, player.id);

    const traits = await getPlayerTraits(connection, player.id);
    const actionLogs = await getPlayerActionLogs(connection, player.id);
    const skills = await getPlayerSkillsSummary(connection, player.id);
    const freshPlayer = await getPlayerById(connection, player.id);

    const formattedPlayer = formatPlayer(freshPlayer);
    const formattedZone = formatZone(zone);
    const formattedTraits = formatTraits(traits);

    const enhanced = await buildEnhancedPlayPresentation({
      player: freshPlayer,
      zone,
      scene: currentScene,
      event: null,
      actionLogs,
      traits,
      skills
    });

    return {
      status: 200,
      body: {
        success: true,
        message: "Current play state fetched successfully",
        data: {
          player: formattedPlayer,
          zone: formattedZone,
          current_scene: enhanced.scene,
          traits: formattedTraits,
          action_logs: actionLogs,
          skills,
          ai: enhanced.ai
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

    let currentScene = await getCurrentSceneByPlayerId(connection, player.id);

    if (!currentScene) {
      const fallbackZone = player.current_zone_id
        ? await getZoneById(connection, player.current_zone_id)
        : await getStarterZone(connection);

      if (!fallbackZone) {
        await connection.rollback();
        return {
          status: 500,
          body: {
            success: false,
            message: "No valid zone found to create current scene"
          }
        };
      }

      currentScene = await createStarterScene(connection, player, fallbackZone);
    }

    const currentZone = await getZoneById(connection, currentScene.zone_id);

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
          message: resolution.event.summary
        }
      };
    }

    const updatedPlayer = await applyPlayerChanges(connection, player, resolution);

    await ensurePlayerTraitsRow(connection, updatedPlayer.id);
    await logPlayerAction(connection, updatedPlayer.id, actionKey);
    await applyTraitGrowth(
      connection,
      updatedPlayer.id,
      resolution.behaviorTracking?.traitChanges || {}
    );

    await processSkillCooldowns(
      connection,
      updatedPlayer.id,
      resolution.skillUsage?.player_skill_id || null,
      resolution.skillUsage?.cooldown_turns || 0
    );

    const nextZone = resolution.nextZone?.id ? resolution.nextZone : currentZone;

    const savedScene = await saveNextScene(
      connection,
      updatedPlayer.id,
      nextZone,
      resolution.nextScene
    );

    await syncPlayerSkillsForPlayer(connection, updatedPlayer.id);

    await connection.commit();

    const finalPlayer = await getPlayerById(connection, updatedPlayer.id);
    const finalZone = await getZoneById(connection, nextZone.id);
    const traits = await getPlayerTraits(connection, updatedPlayer.id);
    const actionLogs = await getPlayerActionLogs(connection, updatedPlayer.id);
    const skills = await getPlayerSkillsSummary(connection, updatedPlayer.id);

    const enhanced = await buildEnhancedPlayPresentation({
      player: finalPlayer,
      zone: finalZone,
      scene: savedScene,
      event: resolution.event,
      actionLogs,
      traits,
      skills
    });

    return {
      status: 200,
      body: {
        success: true,
        message: "Action resolved successfully",
        data: {
          event: enhanced.event,
          player: formatPlayer(finalPlayer),
          zone: formatZone(finalZone),
          current_scene: enhanced.scene,
          traits: formatTraits(traits),
          action_logs: actionLogs,
          skills,
          ai: enhanced.ai
        }
      }
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}

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

async function buildEnhancedPlayPresentation({
  player,
  zone,
  scene,
  event = null,
  actionLogs = [],
  traits = null,
  skills = []
}) {
  const baseScene = formatScene(scene);
  const baseEvent = event ? { ...event } : null;

  const narrationResult = await narrateScene({
    player,
    zone,
    scene: baseScene,
    event: baseEvent,
    actionLogs,
    traits,
    skills
  });

  const choiceResult = await enhanceChoiceTexts({
    player,
    zone,
    scene: baseScene,
    event: baseEvent,
    actionLogs,
    traits,
    skills
  });

  const finalScene = {
    ...baseScene,
    actions: Array.isArray(baseScene.actions) ? [...baseScene.actions] : []
  };

  if (narrationResult.ok) {
    finalScene.scene_title = narrationResult.data.scene_title || finalScene.scene_title;
    finalScene.scene_text = narrationResult.data.scene_text || finalScene.scene_text;
  }

  if (choiceResult.ok && Array.isArray(choiceResult.data) && choiceResult.data.length === 4) {
    finalScene.actions = finalScene.actions.map((action, index) => ({
      ...action,
      text: choiceResult.data[index]?.text || action.text,
      key: choiceResult.data[index]?.key || action.key
    }));
  }

  const finalEvent = baseEvent
    ? {
        ...baseEvent,
        summary:
          narrationResult.ok && narrationResult.data.event_summary
            ? narrationResult.data.event_summary
            : baseEvent.summary
      }
    : null;

  return {
    scene: addChoiceDisplayFields(finalScene),
    event: finalEvent,
    ai: {
      narration_applied: narrationResult.ok,
      choice_text_applied: choiceResult.ok,
      narration_model: narrationResult.ok ? narrationResult.model : null,
      choice_model: choiceResult.ok ? choiceResult.model : null,
      narration_error: narrationResult.ok ? null : narrationResult.reason,
      choice_error: choiceResult.ok ? null : choiceResult.reason
    }
  };
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
        p.is_alive,
        r.name AS race_name,
        r.description AS race_description,
        rs.name AS subtype_name,
        rs.description AS subtype_description
      FROM players p
      INNER JOIN races r ON r.id = p.race_id
      INNER JOIN race_subtypes rs ON rs.id = p.race_subtype_id
      WHERE p.user_id = ?
        AND p.is_alive = 1
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
      WHERE id = ?
        AND is_active = 1
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
      WHERE is_active = 1
        AND is_safe_zone = 1
      ORDER BY id ASC
      LIMIT 1
    `
  );

  if (safeRows.length) return safeRows[0];

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

async function createStarterScene(connection, player, zone) {
  const sceneTitle = `Awakening in ${zone.name}`;
  const sceneText = `${player.character_name} awakens in ${zone.name}. Instinct says survive before all else.`;

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
      sceneTitle,
      sceneText,
      zone.environment_tag || null,
      zone.difficulty_level || "low",
      DEFAULT_ACTIONS[0].text,
      DEFAULT_ACTIONS[0].key,
      DEFAULT_ACTIONS[1].text,
      DEFAULT_ACTIONS[1].key,
      DEFAULT_ACTIONS[2].text,
      DEFAULT_ACTIONS[2].key,
      DEFAULT_ACTIONS[3].text,
      DEFAULT_ACTIONS[3].key
    ]
  );

  return getCurrentSceneByPlayerId(connection, player.id);
}

async function applyPlayerChanges(connection, player, resolution) {
  const nextZoneId = resolution.nextZone.id || player.current_zone_id;

  const nextHp = clamp(
    Number(player.hp || 0) + Number(resolution.statChanges?.hp || 0),
    0,
    Number(player.max_hp || player.hp || 0)
  );

  const nextEnergy = clamp(
    Number(player.energy || 0) + Number(resolution.statChanges?.energy || 0),
    0,
    Number(player.max_energy || player.energy || 0)
  );

  const nextHunger = Math.max(
    0,
    Number(player.hunger || 0) + Number(resolution.statChanges?.hunger || 0)
  );

  const isAlive = nextHp > 0 ? 1 : 0;

  await connection.query(
    `
      UPDATE players
      SET
        current_zone_id = ?,
        hp = ?,
        energy = ?,
        hunger = ?,
        is_alive = ?
      WHERE id = ?
    `,
    [nextZoneId, nextHp, nextEnergy, nextHunger, isAlive, player.id]
  );

  return {
    ...player,
    current_zone_id: nextZoneId,
    hp: nextHp,
    energy: nextEnergy,
    hunger: nextHunger,
    is_alive: isAlive
  };
}

async function saveNextScene(connection, playerId, zone, nextScene) {
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
      playerId,
      zone.id,
      nextScene.scene_title,
      nextScene.scene_text,
      nextScene.environment_tag || null,
      nextScene.danger_level || "low",
      nextScene.actions[0].text,
      nextScene.actions[0].key,
      nextScene.actions[1].text,
      nextScene.actions[1].key,
      nextScene.actions[2].text,
      nextScene.actions[2].key,
      nextScene.actions[3].text,
      nextScene.actions[3].key
    ]
  );

  return getCurrentSceneByPlayerId(connection, playerId);
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

async function getPlayerTraits(connection, playerId) {
  await ensurePlayerTraitsRow(connection, playerId);

  const [rows] = await connection.query(
    `
      SELECT
        id,
        player_id,
        aggressive,
        intelligence,
        stealth,
        survival,
        created_at,
        updated_at
      FROM player_traits
      WHERE player_id = ?
      LIMIT 1
    `,
    [playerId]
  );

  return rows[0] || null;
}

async function applyTraitGrowth(connection, playerId, traitChanges) {
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
    [
      Number(traitChanges.aggressive || 0),
      Number(traitChanges.intelligence || 0),
      Number(traitChanges.stealth || 0),
      Number(traitChanges.survival || 0),
      playerId
    ]
  );
}

async function logPlayerAction(connection, playerId, actionKey) {
  await connection.query(
    `
      INSERT INTO player_action_logs (
        player_id,
        action_key,
        count
      )
      VALUES (?, ?, 1)
      ON DUPLICATE KEY UPDATE
        count = count + 1,
        updated_at = CURRENT_TIMESTAMP
    `,
    [playerId, actionKey]
  );
}

async function getPlayerActionLogs(connection, playerId) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        player_id,
        action_key,
        count,
        created_at,
        updated_at
      FROM player_action_logs
      WHERE player_id = ?
      ORDER BY count DESC, action_key ASC
    `,
    [playerId]
  );

  return rows;
}

function formatPlayer(player) {
  return {
    id: player.id,
    user_id: player.user_id,
    character_name: player.character_name,
    title: player.title,
    alignment_type: player.alignment_type,
    life_number: player.life_number,
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
    is_alive: player.is_alive,
    race: {
      id: player.race_id,
      name: player.race_name,
      description: player.race_description
    },
    subtype: {
      id: player.race_subtype_id,
      name: player.subtype_name,
      description: player.subtype_description
    }
  };
}

function formatZone(zone) {
  return {
    id: zone.id,
    name: zone.name,
    zone_type: zone.zone_type,
    difficulty_level: zone.difficulty_level,
    environment_tag: zone.environment_tag,
    description: zone.description,
    is_safe_zone: Number(zone.is_safe_zone || 0),
    parent_zone_id: zone.parent_zone_id
  };
}

function formatScene(scene) {
  const actions = [
    { slot: 1, text: scene.option_1, key: scene.option_1_key },
    { slot: 2, text: scene.option_2, key: scene.option_2_key },
    { slot: 3, text: scene.option_3, key: scene.option_3_key },
    { slot: 4, text: scene.option_4, key: scene.option_4_key }
  ].map((action, index) => ({
    slot: index + 1,
    text: String(action?.text || DEFAULT_ACTIONS[index]?.text || "").trim(),
    key: String(action?.key || DEFAULT_ACTIONS[index]?.key || "").trim().toLowerCase()
  }));

  return {
    id: scene.id,
    player_id: scene.player_id,
    zone_id: scene.zone_id,
    scene_title: scene.scene_title,
    scene_text: scene.scene_text,
    environment_tag: scene.environment_tag,
    danger_level: scene.danger_level,
    actions,
    choice_1: actions[0]?.text || "",
    choice_1_key: actions[0]?.key || "",
    choice_2: actions[1]?.text || "",
    choice_2_key: actions[1]?.key || "",
    choice_3: actions[2]?.text || "",
    choice_3_key: actions[2]?.key || "",
    choice_4: actions[3]?.text || "",
    choice_4_key: actions[3]?.key || "",
    created_at: scene.created_at,
    updated_at: scene.updated_at
  };
}

function addChoiceDisplayFields(scene) {
  const actions = Array.isArray(scene?.actions) ? scene.actions : [];

  return {
    ...scene,
    choice_1: actions[0]?.text || "",
    choice_1_key: actions[0]?.key || "",
    choice_2: actions[1]?.text || "",
    choice_2_key: actions[1]?.key || "",
    choice_3: actions[2]?.text || "",
    choice_3_key: actions[2]?.key || "",
    choice_4: actions[3]?.text || "",
    choice_4_key: actions[3]?.key || ""
  };
}

function formatTraits(traits) {
  return {
    id: traits.id,
    player_id: traits.player_id,
    aggressive: Number(traits.aggressive || 0),
    intelligence: Number(traits.intelligence || 0),
    stealth: Number(traits.stealth || 0),
    survival: Number(traits.survival || 0),
    created_at: traits.created_at,
    updated_at: traits.updated_at
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

module.exports = {
  getCurrentPlayState,
  playAction
};