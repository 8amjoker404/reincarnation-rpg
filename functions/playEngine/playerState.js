const { safeNumber } = require("./utils");

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

module.exports = {
  getAlivePlayerByUserId,
  getPlayerById,
  applyPlayerChanges,
  ensurePlayerTraitsRow,
  logPlayerAction,
  applyTraitGrowth,
  getPlayerTraits,
  getPlayerActionLogs
};