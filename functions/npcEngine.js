const db = require("../config/db");

function normalizeNpc(row) {
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    npc_type: row.npc_type,
    description: row.description || null,
    temperament: row.temperament,
    hostility_level: Number(row.hostility_level || 0),
    intelligence_level: Number(row.intelligence_level || 0),
    spawn_weight: Number(row.spawn_weight || 0),
    is_active: Number(row.is_active || 0) === 1
  };
}

function normalizeNpcMemory(row) {
  if (!row) return null;

  return {
    id: row.id,
    player_id: Number(row.player_id),
    npc_id: Number(row.npc_id),
    first_met_at: row.first_met_at || null,
    last_seen_at: row.last_seen_at || null,
    relationship_state: row.relationship_state || "unknown",
    familiarity_score: Number(row.familiarity_score || 0),
    threat_score: Number(row.threat_score || 0),
    memory_notes: row.memory_notes || null
  };
}

async function getZoneNpcs(connection, zoneId) {
  const [rows] = await connection.query(
    `
    SELECT
      n.id,
      n.name,
      n.npc_type,
      n.description,
      n.temperament,
      n.hostility_level,
      n.intelligence_level,
      n.is_active,
      zn.spawn_weight
    FROM zone_npcs zn
    INNER JOIN npcs n
      ON n.id = zn.npc_id
    WHERE zn.zone_id = ?
      AND n.is_active = 1
    ORDER BY zn.spawn_weight DESC, n.id ASC
    `,
    [zoneId]
  );

  return rows.map(normalizeNpc);
}

async function getZoneNpcByRandomWeight(connection, zoneId) {
  const [rows] = await connection.query(
    `
    SELECT
      n.id,
      n.name,
      n.npc_type,
      n.description,
      n.temperament,
      n.hostility_level,
      n.intelligence_level,
      n.is_active,
      zn.spawn_weight
    FROM zone_npcs zn
    INNER JOIN npcs n
      ON n.id = zn.npc_id
    WHERE zn.zone_id = ?
      AND n.is_active = 1
    ORDER BY RAND() * zn.spawn_weight DESC
    LIMIT 1
    `,
    [zoneId]
  );

  return rows[0] ? normalizeNpc(rows[0]) : null;
}

async function getPlayerNpcMemoriesForZone(connection, playerId, zoneId) {
  const [rows] = await connection.query(
    `
    SELECT
      pnm.id,
      pnm.player_id,
      pnm.npc_id,
      pnm.first_met_at,
      pnm.last_seen_at,
      pnm.relationship_state,
      pnm.familiarity_score,
      pnm.threat_score,
      pnm.memory_notes
    FROM player_npc_memory pnm
    INNER JOIN zone_npcs zn
      ON zn.npc_id = pnm.npc_id
    INNER JOIN npcs n
      ON n.id = pnm.npc_id
    WHERE pnm.player_id = ?
      AND zn.zone_id = ?
      AND n.is_active = 1
    ORDER BY pnm.last_seen_at DESC, pnm.id DESC
    `,
    [playerId, zoneId]
  );

  return rows.map(normalizeNpcMemory);
}

async function initializeNpcMemory(connection, playerId, npc) {
  if (!playerId || !npc?.id) return null;

  const baseThreat = Math.max(
    0,
    Math.min(
      100,
      Number(npc.hostility_level || 0) * 10 +
        (npc.temperament === "aggressive" ? 15 : 0) +
        (npc.temperament === "curious" ? 3 : 0)
    )
  );

  await connection.query(
    `
    INSERT INTO player_npc_memory (
      player_id,
      npc_id,
      first_met_at,
      last_seen_at,
      relationship_state,
      familiarity_score,
      threat_score,
      memory_notes
    )
    VALUES (?, ?, NOW(), NOW(), ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      last_seen_at = NOW()
    `,
    [
      playerId,
      npc.id,
      npc.temperament === "aggressive" ? "threat_detected" : "unknown",
      1,
      baseThreat,
      `First encounter with ${npc.name}.`
    ]
  );

  const [rows] = await connection.query(
    `
    SELECT
      id,
      player_id,
      npc_id,
      first_met_at,
      last_seen_at,
      relationship_state,
      familiarity_score,
      threat_score,
      memory_notes
    FROM player_npc_memory
    WHERE player_id = ?
      AND npc_id = ?
    LIMIT 1
    `,
    [playerId, npc.id]
  );

  return rows[0] ? normalizeNpcMemory(rows[0]) : null;
}

async function ensureZoneNpcEncounter(connection, playerId, zoneId) {
  const npc = await getZoneNpcByRandomWeight(connection, zoneId);

  if (!npc) {
    return {
      encountered_npc: null,
      npc_memory: null
    };
  }

  const npcMemory = await initializeNpcMemory(connection, playerId, npc);

  return {
    encountered_npc: npc,
    npc_memory: npcMemory
  };
}

module.exports = {
  getZoneNpcs,
  getZoneNpcByRandomWeight,
  getPlayerNpcMemoriesForZone,
  initializeNpcMemory,
  ensureZoneNpcEncounter
};