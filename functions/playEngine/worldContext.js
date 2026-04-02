const {
  tryQueryVariants,
  clampNumber,
  cleanString
} = require("./utils");

const { formatScene } = require("./sceneState");

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

module.exports = {
  buildAiWorldContext,
  getRecentSceneHistory,
  getZoneNpcs,
  getPlayerNpcMemory
};