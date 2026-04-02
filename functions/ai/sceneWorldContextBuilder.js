// functions/ai/sceneWorldContextBuilder.js

function clampLimit(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function safeText(value) {
  return String(value || "").trim();
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeSceneHistoryRows(rows = []) {
  return Array.isArray(rows)
    ? rows.map((row) => ({
        id: row.id || null,
        scene_title: safeText(row.scene_title || row.title),
        scene_text: safeText(row.scene_text || row.description),
        action_key: safeText(row.action_key || row.chosen_action || "").toLowerCase(),
        event_summary: safeText(row.event_summary || row.summary),
        danger_level: safeNumber(row.danger_level, 0),
        zone_id: row.zone_id || null,
        created_at: row.created_at || null
      }))
    : [];
}

function normalizeZoneNpcs(zoneNpcRows = [], npcRows = []) {
  const npcMap = new Map();

  for (const npc of npcRows) {
    npcMap.set(String(npc.id), npc);
  }

  return zoneNpcRows.map((zoneNpc) => {
    const npc = npcMap.get(String(zoneNpc.npc_id)) || {};

    return {
      npc_id: zoneNpc.npc_id || npc.id || null,
      name: safeText(npc.name || zoneNpc.display_name),
      npc_key: safeText(npc.npc_key || npc.slug || ""),
      race: safeText(npc.race || npc.species || ""),
      role: safeText(zoneNpc.role || npc.role || ""),
      presence_state: safeText(zoneNpc.presence_state || "present"),
      disposition: safeText(zoneNpc.disposition || npc.disposition || ""),
      threat_level: safeNumber(zoneNpc.threat_level ?? npc.threat_level, 0),
      short_memory_hint: safeText(
        zoneNpc.short_memory_hint ||
        npc.short_memory_hint ||
        npc.description
      )
    };
  });
}

function normalizePlayerNpcMemoryRows(rows = []) {
  return Array.isArray(rows)
    ? rows.map((row) => ({
        id: row.id || null,
        npc_id: row.npc_id || null,
        npc_name: safeText(row.npc_name || row.name),
        relationship_state: safeText(row.relationship_state || row.stance || ""),
        familiarity: safeNumber(row.familiarity, 0),
        trust_score: safeNumber(row.trust_score, 0),
        fear_score: safeNumber(row.fear_score, 0),
        hostility_score: safeNumber(row.hostility_score, 0),
        last_interaction_summary: safeText(
          row.last_interaction_summary || row.memory_summary || row.notes
        ),
        last_seen_at: row.last_seen_at || row.updated_at || null
      }))
    : [];
}

async function getRecentSceneHistory(connection, playerId, limit = 6) {
  const safeLimit = clampLimit(limit, 3, 10, 6);

  const [rows] = await connection.query(
    `
    SELECT
      id,
      player_id,
      zone_id,
      scene_title,
      scene_text,
      action_key,
      event_summary,
      danger_level,
      created_at
    FROM player_scene_history
    WHERE player_id = ?
    ORDER BY id DESC
    LIMIT ?
    `,
    [playerId, safeLimit]
  );

  return normalizeSceneHistoryRows(rows).reverse();
}

async function getZoneNpcs(connection, zoneId, limit = 8) {
  const safeLimit = clampLimit(limit, 1, 12, 8);

  const [zoneNpcRows] = await connection.query(
    `
    SELECT
      id,
      zone_id,
      npc_id,
      role,
      presence_state,
      disposition,
      threat_level,
      short_memory_hint
    FROM zone_npcs
    WHERE zone_id = ?
    ORDER BY id ASC
    LIMIT ?
    `,
    [zoneId, safeLimit]
  );

  if (!zoneNpcRows.length) {
    return [];
  }

  const npcIds = zoneNpcRows
    .map((row) => row.npc_id)
    .filter(Boolean);

  if (!npcIds.length) {
    return normalizeZoneNpcs(zoneNpcRows, []);
  }

  const [npcRows] = await connection.query(
    `
    SELECT
      id,
      name,
      npc_key,
      race,
      role,
      disposition,
      threat_level,
      description,
      short_memory_hint
    FROM npcs
    WHERE id IN (?)
    `,
    [npcIds]
  );

  return normalizeZoneNpcs(zoneNpcRows, npcRows);
}

async function getPlayerNpcMemory(connection, playerId, zoneId = null, limit = 10) {
  const safeLimit = clampLimit(limit, 3, 12, 10);

  let rows;

  if (zoneId) {
    [rows] = await connection.query(
      `
      SELECT
        pnm.id,
        pnm.player_id,
        pnm.npc_id,
        pnm.zone_id,
        pnm.relationship_state,
        pnm.familiarity,
        pnm.trust_score,
        pnm.fear_score,
        pnm.hostility_score,
        pnm.last_interaction_summary,
        pnm.last_seen_at,
        pnm.updated_at,
        n.name AS npc_name
      FROM player_npc_memory pnm
      LEFT JOIN npcs n ON n.id = pnm.npc_id
      WHERE pnm.player_id = ?
        AND (pnm.zone_id = ? OR pnm.zone_id IS NULL)
      ORDER BY COALESCE(pnm.last_seen_at, pnm.updated_at) DESC, pnm.id DESC
      LIMIT ?
      `,
      [playerId, zoneId, safeLimit]
    );
  } else {
    [rows] = await connection.query(
      `
      SELECT
        pnm.id,
        pnm.player_id,
        pnm.npc_id,
        pnm.zone_id,
        pnm.relationship_state,
        pnm.familiarity,
        pnm.trust_score,
        pnm.fear_score,
        pnm.hostility_score,
        pnm.last_interaction_summary,
        pnm.last_seen_at,
        pnm.updated_at,
        n.name AS npc_name
      FROM player_npc_memory pnm
      LEFT JOIN npcs n ON n.id = pnm.npc_id
      WHERE pnm.player_id = ?
      ORDER BY COALESCE(pnm.last_seen_at, pnm.updated_at) DESC, pnm.id DESC
      LIMIT ?
      `,
      [playerId, safeLimit]
    );
  }

  return normalizePlayerNpcMemoryRows(rows);
}

async function buildAiWorldContext(
  connection,
  {
    playerId,
    zoneId,
    currentScene = null,
    chosenAction = null,
    backendResult = null,
    historyLimit = 6
  }
) {
  const [sceneHistory, zoneNpcs, playerNpcMemory] = await Promise.all([
    getRecentSceneHistory(connection, playerId, historyLimit),
    zoneId ? getZoneNpcs(connection, zoneId, 8) : Promise.resolve([]),
    getPlayerNpcMemory(connection, playerId, zoneId, 10)
  ]);

  return {
    currentSceneSnapshot: currentScene
      ? {
          id: currentScene.id || null,
          scene_title: currentScene.scene_title || "",
          scene_text: currentScene.scene_text || "",
          danger_level: currentScene.danger_level || 0,
          environment_tag: currentScene.environment_tag || ""
        }
      : null,
    sceneHistory,
    zoneNpcs,
    playerNpcMemory,
    chosenAction: chosenAction
      ? {
          action_key: String(chosenAction).trim().toLowerCase()
        }
      : null,
    backendResult: backendResult
      ? {
          type: backendResult.type || null,
          action: backendResult.action || null,
          summary: backendResult.summary || null,
          outcome: backendResult.outcome || null
        }
      : null
  };
}

module.exports = {
  buildAiWorldContext
};