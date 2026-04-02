const db = require("../config/db");

async function getAlivePlayerByUserId(connection, userId) {
  const [rows] = await connection.query(
    `
      SELECT
        p.id,
        p.user_id,
        p.character_name,
        p.race_id,
        p.race_subtype_id,
        p.level,
        p.day_survived,
        p.current_hour,
        p.hp,
        p.max_hp,
        p.energy,
        p.max_energy,
        p.hunger,
        p.attack_stat,
        p.defense_stat,
        p.speed_stat,
        p.intelligence_stat,
        p.current_zone_id,
        p.is_alive
      FROM players p
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
        p.character_name,
        p.race_id,
        p.race_subtype_id,
        p.level,
        p.day_survived,
        p.current_hour,
        p.hp,
        p.max_hp,
        p.energy,
        p.max_energy,
        p.hunger,
        p.attack_stat,
        p.defense_stat,
        p.speed_stat,
        p.intelligence_stat,
        p.current_zone_id,
        p.is_alive
      FROM players p
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
      LIMIT 1
    `,
    [zoneId]
  );

  return rows[0] || null;
}

async function getPlayerActionCount(connection, playerId, actionKey) {
  const [rows] = await connection.query(
    `
      SELECT count
      FROM player_action_logs
      WHERE player_id = ?
        AND action_key = ?
      LIMIT 1
    `,
    [playerId, actionKey]
  );

  return Number(rows[0]?.count || 0);
}

async function getPlayerTraits(connection, playerId) {
  const [rows] = await connection.query(
    `
      SELECT
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

  return rows[0] || {
    aggressive: 0,
    intelligence: 0,
    stealth: 0,
    survival: 0
  };
}

async function getEligibleSkillsForPlayer(connection, player) {
  const [rows] = await connection.query(
    `
      SELECT
        s.id,
        s.name,
        s.skill_key,
        s.description,
        s.skill_type,
        s.target_type,
        s.race_id,
        s.race_subtype_id,
        s.unlock_level,
        s.energy_cost,
        s.cooldown_turns,
        s.base_power,
        s.scaling_stat,
        s.effect_kind,
        s.effect_value,
        s.is_active,
        s.unlock_type,
        s.unlock_value,
        s.unlock_action_key,
        s.unlock_zone_tag
      FROM skills s
      WHERE s.is_active = 1
        AND (s.race_id IS NULL OR s.race_id = ?)
        AND (s.race_subtype_id IS NULL OR s.race_subtype_id = ?)
      ORDER BY s.id ASC
    `,
    [player.race_id, player.race_subtype_id]
  );

  return rows;
}

async function evaluateSkillUnlock(connection, player, zone, skill) {
  const unlockType = String(skill.unlock_type || "none").toLowerCase();
  const unlockValue = skill.unlock_value == null ? null : Number(skill.unlock_value);

  if (unlockType === "none") {
    return {
      unlock: true,
      reason: "Unlocked by default"
    };
  }

  if (unlockType === "level") {
    const neededLevel = unlockValue || Number(skill.unlock_level || 1);
    const unlock = Number(player.level || 0) >= neededLevel;

    return {
      unlock,
      reason: unlock
        ? `Unlocked by reaching level ${neededLevel}`
        : `Requires level ${neededLevel}`
    };
  }

  if (unlockType === "action_count") {
    const actionKey = String(skill.unlock_action_key || "").trim().toLowerCase();
    const neededCount = unlockValue || 1;
    const currentCount = actionKey
      ? await getPlayerActionCount(connection, player.id, actionKey)
      : 0;

    return {
      unlock: currentCount >= neededCount,
      reason:
        currentCount >= neededCount
          ? `Unlocked by using ${actionKey} ${neededCount} times`
          : `Use ${actionKey} ${neededCount} times`
    };
  }

  if (unlockType === "survival") {
    const neededDays = unlockValue || 1;
    const currentDays = Number(player.day_survived || 0);

    return {
      unlock: currentDays >= neededDays,
      reason:
        currentDays >= neededDays
          ? `Unlocked by surviving ${neededDays} days`
          : `Survive ${neededDays} days`
    };
  }

  if (unlockType === "zone") {
    const neededTag = String(skill.unlock_zone_tag || "").trim().toLowerCase();
    const currentTag = String(zone?.environment_tag || "").trim().toLowerCase();

    return {
      unlock: !!neededTag && currentTag === neededTag,
      reason:
        !!neededTag && currentTag === neededTag
          ? `Unlocked in zone tag ${neededTag}`
          : `Enter zone tag ${neededTag}`
    };
  }

  if (unlockType === "stat_threshold") {
    const statKey = String(skill.scaling_stat || "none");
    const neededValue = unlockValue || 1;
    const currentValue = Number(player[statKey] || 0);

    return {
      unlock: statKey !== "none" && currentValue >= neededValue,
      reason:
        statKey !== "none" && currentValue >= neededValue
          ? `Unlocked by ${statKey} reaching ${neededValue}`
          : `Reach ${neededValue} ${statKey}`
    };
  }

  return {
    unlock: false,
    reason: "Unlock rule not yet satisfied"
  };
}

async function syncPlayerSkillsForPlayer(connection, playerId) {
  const player = await getPlayerById(connection, playerId);

  if (!player) {
    throw new Error("Player not found");
  }

  const zone = player.current_zone_id
    ? await getZoneById(connection, player.current_zone_id)
    : null;

  const eligibleSkills = await getEligibleSkillsForPlayer(connection, player);

  for (const skill of eligibleSkills) {
    const unlockState = await evaluateSkillUnlock(connection, player, zone, skill);

    await connection.query(
      `
        INSERT INTO player_skills (
          player_id,
          skill_id,
          skill_level,
          is_unlocked,
          unlock_reason,
          current_cooldown
        )
        VALUES (?, ?, 1, ?, ?, 0)
        ON DUPLICATE KEY UPDATE
          is_unlocked = CASE
            WHEN is_unlocked = 1 THEN 1
            ELSE VALUES(is_unlocked)
          END,
          unlock_reason = CASE
            WHEN is_unlocked = 1 THEN unlock_reason
            ELSE VALUES(unlock_reason)
          END,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        player.id,
        skill.id,
        unlockState.unlock ? 1 : 0,
        unlockState.reason
      ]
    );
  }

  return getPlayerSkillsSummary(connection, player.id);
}

async function getPlayerSkillsSummary(connection, playerId) {
  const [rows] = await connection.query(
    `
      SELECT
        ps.id AS player_skill_id,
        ps.player_id,
        ps.skill_id,
        ps.skill_level,
        ps.is_unlocked,
        ps.unlock_reason,
        ps.current_cooldown,
        ps.created_at,
        ps.updated_at,
        s.name,
        s.skill_key,
        s.description,
        s.skill_type,
        s.target_type,
        s.energy_cost,
        s.cooldown_turns,
        s.base_power,
        s.scaling_stat,
        s.effect_kind,
        s.effect_value,
        s.unlock_type,
        s.unlock_value,
        s.unlock_action_key,
        s.unlock_zone_tag
      FROM player_skills ps
      INNER JOIN skills s ON s.id = ps.skill_id
      WHERE ps.player_id = ?
      ORDER BY ps.is_unlocked DESC, s.name ASC
    `,
    [playerId]
  );

  return rows.map((row) => ({
    player_skill_id: row.player_skill_id,
    player_id: row.player_id,
    skill_id: row.skill_id,
    skill_level: row.skill_level,
    is_unlocked: Number(row.is_unlocked) === 1,
    unlock_reason: row.unlock_reason,
    current_cooldown: Number(row.current_cooldown || 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
    skill: {
      id: row.skill_id,
      name: row.name,
      skill_key: row.skill_key,
      description: row.description,
      skill_type: row.skill_type,
      target_type: row.target_type,
      energy_cost: Number(row.energy_cost || 0),
      cooldown_turns: Number(row.cooldown_turns || 0),
      base_power: Number(row.base_power || 0),
      scaling_stat: row.scaling_stat,
      effect_kind: row.effect_kind,
      effect_value: Number(row.effect_value || 0),
      unlock_type: row.unlock_type,
      unlock_value: row.unlock_value,
      unlock_action_key: row.unlock_action_key,
      unlock_zone_tag: row.unlock_zone_tag
    }
  }));
}

async function getOwnedUnlockedSkillByKey(connection, playerId, skillKey) {
  const normalizedKey = String(skillKey || "").trim().toLowerCase();

  const [rows] = await connection.query(
    `
      SELECT
        ps.id AS player_skill_id,
        ps.player_id,
        ps.skill_id,
        ps.skill_level,
        ps.is_unlocked,
        ps.unlock_reason,
        ps.current_cooldown,
        s.name,
        s.skill_key,
        s.description,
        s.skill_type,
        s.target_type,
        s.energy_cost,
        s.cooldown_turns,
        s.base_power,
        s.scaling_stat,
        s.effect_kind,
        s.effect_value
      FROM player_skills ps
      INNER JOIN skills s ON s.id = ps.skill_id
      WHERE ps.player_id = ?
        AND ps.is_unlocked = 1
        AND LOWER(s.skill_key) = ?
      LIMIT 1
    `,
    [playerId, normalizedKey]
  );

  return rows[0] || null;
}

function getScalingBonus(player, scalingStat, skillLevel) {
  const levelBonus = Math.max(0, Number(skillLevel || 1) - 1);
  const statValue = Number(player[scalingStat] || 0);

  if (!scalingStat || scalingStat === "none") {
    return levelBonus;
  }

  return Math.floor(statValue * 0.35) + levelBonus;
}

function buildSkillOutcome({ player, zone, ownedSkill }) {
  const basePower = Number(ownedSkill.base_power || 0);
  const effectValue = Number(ownedSkill.effect_value || 0);
  const scalingBonus = getScalingBonus(
    player,
    ownedSkill.scaling_stat,
    ownedSkill.skill_level
  );
  const totalPower = basePower + effectValue + scalingBonus;

  const result = {
    statChanges: {
      hp: 0,
      energy: -Number(ownedSkill.energy_cost || 0),
      hunger: 0
    },
    nextZone: zone,
    nextScene: null,
    event: {
      action: "use_skill",
      summary: `You used ${ownedSkill.name}.`,
      skill: {
        player_skill_id: ownedSkill.player_skill_id,
        skill_id: ownedSkill.skill_id,
        name: ownedSkill.name,
        skill_key: ownedSkill.skill_key
      },
      effect_kind: ownedSkill.effect_kind,
      total_power: totalPower
    },
    skillUsage: {
      player_skill_id: ownedSkill.player_skill_id,
      cooldown_turns: Number(ownedSkill.cooldown_turns || 0)
    }
  };

  const danger = String(zone?.difficulty_level || "low").toLowerCase();
  const safeZone = Number(zone?.is_safe_zone || 0) === 1;

  if (ownedSkill.effect_kind === "damage") {
    result.nextScene = {
      scene_title: `You Unleash ${ownedSkill.name}`,
      scene_text: `The skill lands with force. Your instincts sharpen after the strike, and the area answers with tension.`,
      environment_tag: zone?.environment_tag || null,
      danger_level: danger === "low" ? "medium" : "high",
      actions: [
        { key: "observe", text: "Observe the reaction" },
        { key: "move", text: "Move before danger closes in" },
        { key: "hide", text: "Hide after the strike" },
        { key: "attack", text: "Attack again" }
      ]
    };
    return result;
  }

  if (ownedSkill.effect_kind === "heal") {
    result.statChanges.hp = totalPower;
    result.nextScene = {
      scene_title: `You Channel ${ownedSkill.name}`,
      scene_text: `Warm strength returns to your body. The skill closes some of your wounds and gives you room to breathe.`,
      environment_tag: zone?.environment_tag || null,
      danger_level: safeZone ? "low" : danger,
      actions: [
        { key: "observe", text: "Observe your surroundings" },
        { key: "rest", text: "Rest while strength returns" },
        { key: "move", text: "Move with fresh energy" },
        { key: "hide", text: "Hide and recover further" }
      ]
    };
    return result;
  }

  if (ownedSkill.effect_kind === "escape") {
    result.nextScene = {
      scene_title: `You Break Away with ${ownedSkill.name}`,
      scene_text: `The skill opens a brief path out of danger. Distance and timing shift in your favor.`,
      environment_tag: zone?.environment_tag || null,
      danger_level: "low",
      actions: [
        { key: "observe", text: "Observe from safety" },
        { key: "move", text: "Keep moving" },
        { key: "hide", text: "Hide after escaping" },
        { key: "rest", text: "Catch your breath" }
      ]
    };
    return result;
  }

  if (ownedSkill.effect_kind === "stealth") {
    result.nextScene = {
      scene_title: `You Fade with ${ownedSkill.name}`,
      scene_text: `Your presence dulls. Sight, scent, and sound betray you less than before.`,
      environment_tag: zone?.environment_tag || null,
      danger_level: "low",
      actions: [
        { key: "observe", text: "Observe from concealment" },
        { key: "move", text: "Slip to a better position" },
        { key: "attack", text: "Strike from stealth" },
        { key: "rest", text: "Wait silently" }
      ]
    };
    return result;
  }

  if (ownedSkill.effect_kind === "vision") {
    result.nextScene = {
      scene_title: `You See Further with ${ownedSkill.name}`,
      scene_text: `Details sharpen. Tracks, patterns, and weak points become easier to read.`,
      environment_tag: zone?.environment_tag || null,
      danger_level: danger,
      actions: [
        { key: "observe", text: "Study what you discovered" },
        { key: "move", text: "Move using your new insight" },
        { key: "hide", text: "Hide where the vision suggests" },
        { key: "attack", text: "Exploit a weak point" }
      ]
    };
    return result;
  }

  if (ownedSkill.effect_kind === "buff") {
    result.nextScene = {
      scene_title: `You Empower Yourself with ${ownedSkill.name}`,
      scene_text: `Power gathers around your body and instinct. You feel more ready for what comes next.`,
      environment_tag: zone?.environment_tag || null,
      danger_level: danger,
      actions: [
        { key: "attack", text: "Attack with momentum" },
        { key: "move", text: "Move with confidence" },
        { key: "observe", text: "Observe while empowered" },
        { key: "hide", text: "Hold the power in silence" }
      ]
    };
    return result;
  }

  result.nextScene = {
    scene_title: `You Use ${ownedSkill.name}`,
    scene_text: `The skill changes the flow of the moment, even if the world does not fully reveal its answer yet.`,
    environment_tag: zone?.environment_tag || null,
    danger_level: danger,
    actions: [
      { key: "observe", text: "Observe the aftermath" },
      { key: "move", text: "Move carefully" },
      { key: "hide", text: "Hide and think" },
      { key: "rest", text: "Steady yourself" }
    ]
  };

  return result;
}

async function resolvePlayerSkillUse(connection, playerId, payload = {}) {
  await syncPlayerSkillsForPlayer(connection, playerId);

  const player = await getPlayerById(connection, playerId);

  if (!player || Number(player.is_alive) !== 1) {
    throw new Error("Active player not found");
  }

  const zone = player.current_zone_id
    ? await getZoneById(connection, player.current_zone_id)
    : null;

  if (!zone) {
    throw new Error("Current zone not found");
  }

  const skillKey = String(payload.skill_key || "").trim().toLowerCase();

  if (!skillKey) {
    return {
      ok: false,
      status: 400,
      message: "skill_key is required"
    };
  }

  const ownedSkill = await getOwnedUnlockedSkillByKey(connection, player.id, skillKey);

  if (!ownedSkill) {
    return {
      ok: false,
      status: 404,
      message: "Player does not own this unlocked skill"
    };
  }

  if (Number(ownedSkill.current_cooldown || 0) > 0) {
    return {
      ok: false,
      status: 400,
      message: "Skill is on cooldown",
      data: {
        skill_key: ownedSkill.skill_key,
        current_cooldown: Number(ownedSkill.current_cooldown || 0)
      }
    };
  }

  const energyCost = Number(ownedSkill.energy_cost || 0);
  const currentEnergy = Number(player.energy || 0);

  if (currentEnergy < energyCost) {
    return {
      ok: false,
      status: 400,
      message: "Not enough energy to use this skill",
      data: {
        skill_key: ownedSkill.skill_key,
        energy_cost: energyCost,
        current_energy: currentEnergy
      }
    };
  }

  const outcome = buildSkillOutcome({
    player,
    zone,
    ownedSkill
  });

  return {
    ok: true,
    status: 200,
    outcome
  };
}

async function processSkillCooldowns(connection, playerId, usedPlayerSkillId = null, usedCooldownTurns = 0) {
  if (usedPlayerSkillId) {
    await connection.query(
      `
        UPDATE player_skills
        SET current_cooldown = ?
        WHERE id = ?
          AND player_id = ?
      `,
      [Number(usedCooldownTurns || 0), usedPlayerSkillId, playerId]
    );

    await connection.query(
      `
        UPDATE player_skills
        SET current_cooldown = current_cooldown - 1
        WHERE player_id = ?
          AND id != ?
          AND current_cooldown > 0
      `,
      [playerId, usedPlayerSkillId]
    );

    return;
  }

  await connection.query(
    `
      UPDATE player_skills
      SET current_cooldown = current_cooldown - 1
      WHERE player_id = ?
        AND current_cooldown > 0
    `,
    [playerId]
  );
}

async function getMySkillsForUser(userId) {
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

    const skills = await syncPlayerSkillsForPlayer(connection, player.id);

    return {
      status: 200,
      body: {
        success: true,
        message: "Player skills fetched successfully",
        data: skills
      }
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        success: false,
        message: "Failed to fetch player skills",
        error: error.message
      }
    };
  } finally {
    connection.release();
  }
}

module.exports = {
  getMySkillsForUser,
  getPlayerSkillsSummary,
  syncPlayerSkillsForPlayer,
  resolvePlayerSkillUse,
  processSkillCooldowns
};