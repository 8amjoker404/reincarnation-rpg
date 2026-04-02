const {
  buildSceneActions,
  inferActionSetType
} = require("../sceneActionBuilder");

const {
  sanitizeSceneForStorage,
  normalizeDangerLevel,
  cleanString,
  executeFirstSuccessfulQuery,
  safeNumber
} = require("./utils");

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
  const sceneTitle =
    cleanString(savedScene?.scene_title) || cleanString(currentScene?.scene_title);
  const sceneText =
    cleanString(savedScene?.scene_text) || cleanString(currentScene?.scene_text);

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

module.exports = {
  getZoneById,
  getResolvedCurrentZone,
  getCurrentSceneByPlayerId,
  createSceneFromAiResult,
  saveSceneHistoryEntry,
  resolveNextZone,
  getSceneAiMetaBySceneId,
  upsertSceneAiCache,
  buildContinuationBaseScene,
  formatPlayer,
  formatZone,
  formatScene,
  formatTraits
};