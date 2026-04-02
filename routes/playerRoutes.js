const express = require("express");
const db = require("../config/db");
const { authenticateToken } = require("../middleware/authMiddleware");
const { getRandomActiveRaceAndSubtype } = require("../functions/randomRaceEngine");

const router = express.Router();

// POST /api/player/reincarnate
router.post("/reincarnate", authenticateToken, async (req, res, next) => {
  const connection = await db.getConnection();

  try {
    const userId = req.user.id;
    const {
      name,
      title,
      alignment_type,
      current_zone_id,
      death_reason,
      force_die_current
    } = req.body;

    const cleanName = name ? String(name).trim() : null;
    const cleanTitle = title ? String(title).trim() : "Nameless Being";
    const cleanAlignmentType = alignment_type
      ? String(alignment_type).trim().toLowerCase()
      : "neutral";

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "Character name is required and must be at least 2 characters long"
      });
    }

    await connection.beginTransaction();

    const [latestRows] = await connection.query(
      `
        SELECT *
        FROM players
        WHERE user_id = ?
        ORDER BY life_number DESC, id DESC
        LIMIT 1
      `,
      [userId]
    );

    const latestPlayer = latestRows[0] || null;

    if (!latestPlayer) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "No previous life found for this user. Create your first player first."
      });
    }

    if (Number(latestPlayer.is_alive) === 1 && Number(force_die_current) !== 1) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Your current player is still alive. Kill the current life first or pass force_die_current = 1."
      });
    }

    if (Number(latestPlayer.is_alive) === 1 && Number(force_die_current) === 1) {
      await connection.query(
        `
          UPDATE players
          SET
            is_alive = 0,
            hp = 0,
            died_at = NOW(),
            death_reason = ?
          WHERE id = ?
        `,
        [death_reason ? String(death_reason).trim() : "Forced reincarnation", latestPlayer.id]
      );
    } else if (Number(latestPlayer.is_alive) === 0 && !latestPlayer.died_at) {
      await connection.query(
        `
          UPDATE players
          SET
            died_at = NOW(),
            death_reason = COALESCE(?, death_reason, 'Unknown death')
          WHERE id = ?
        `,
        [death_reason ? String(death_reason).trim() : null, latestPlayer.id]
      );
    }

    const { race, subtype } = await getRandomActiveRaceAndSubtype();

    let finalZoneId = current_zone_id ? Number(current_zone_id) : null;

    if (finalZoneId) {
      const [zoneRows] = await connection.query(
        `
          SELECT id
          FROM zones
          WHERE id = ?
          LIMIT 1
        `,
        [finalZoneId]
      );

      if (!zoneRows.length) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: "Selected zone not found"
        });
      }
    } else {
      const [safeZones] = await connection.query(
        `
          SELECT id
          FROM zones
          WHERE is_safe_zone = 1
          ORDER BY id ASC
          LIMIT 1
        `
      );

      if (safeZones.length) {
        finalZoneId = safeZones[0].id;
      } else {
        const [zones] = await connection.query(
          `
            SELECT id
            FROM zones
            ORDER BY id ASC
            LIMIT 1
          `
        );

        if (!zones.length) {
          await connection.rollback();
          return res.status(500).json({
            success: false,
            message: "No zones found"
          });
        }

        finalZoneId = zones[0].id;
      }
    }

    const [lifeRows] = await connection.query(
      `
        SELECT COALESCE(MAX(life_number), 0) AS max_life_number
        FROM players
        WHERE user_id = ?
      `,
      [userId]
    );

    const nextLifeNumber = Number(lifeRows[0]?.max_life_number || 0) + 1;

    const [insertResult] = await connection.query(
      `
        INSERT INTO players (
          user_id,
          life_number,
          previous_player_id,
          character_name,
          race_id,
          race_subtype_id,
          level,
          year_survived,
          day_survived,
          current_hour,
          age_days,
          hp,
          max_hp,
          energy,
          max_energy,
          hunger,
          attack_stat,
          defense_stat,
          speed_stat,
          intelligence_stat,
          evolution_stage,
          title,
          alignment_type,
          current_zone_id,
          is_alive,
          reincarnated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        userId,
        nextLifeNumber,
        latestPlayer.id,
        cleanName,
        race.id,
        subtype.id,
        1,
        0,
        0,
        0,
        0,
        subtype.base_hp,
        subtype.base_hp,
        subtype.base_energy,
        subtype.base_energy,
        0,
        subtype.base_attack,
        subtype.base_defense,
        subtype.base_speed,
        subtype.base_intelligence,
        1,
        cleanTitle,
        cleanAlignmentType,
        finalZoneId,
        1
      ]
    );

    const newPlayerId = insertResult.insertId;

    const [reincarnationTableCheck] = await connection.query(
      `
        SHOW TABLES LIKE 'player_reincarnations'
      `
    );

    if (reincarnationTableCheck.length) {
      await connection.query(
        `
          INSERT INTO player_reincarnations (
            user_id,
            old_player_id,
            new_player_id,
            old_life_number,
            new_life_number,
            reincarnation_type,
            notes
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          userId,
          latestPlayer.id,
          newPlayerId,
          latestPlayer.life_number,
          nextLifeNumber,
          "random",
          death_reason ? String(death_reason).trim() : "Reincarnated into a new random life"
        ]
      );
    }

    const [timelineTableCheck] = await connection.query(
      `
        SHOW TABLES LIKE 'timeline_logs'
      `
    );

    if (timelineTableCheck.length) {
      await connection.query(
        `
          INSERT INTO timeline_logs (
            player_id,
            event_type,
            title,
            description
          )
          VALUES (?, ?, ?, ?)
        `,
        [
          newPlayerId,
          "reincarnation",
          "A New Life Begins",
          `Player reincarnated from life #${latestPlayer.life_number} into life #${nextLifeNumber} as ${race.name} / ${subtype.name}`
        ]
      );
    }

    await connection.commit();

    const [rows] = await db.query(
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
          p.created_at,
          p.updated_at,
          r.name AS race_name,
          r.description AS race_description,
          rs.name AS subtype_name,
          rs.description AS subtype_description,
          z.name AS zone_name,
          z.zone_type,
          z.difficulty_level,
          z.environment_tag,
          z.description AS zone_description,
          z.is_safe_zone
        FROM players p
        INNER JOIN races r ON r.id = p.race_id
        INNER JOIN race_subtypes rs ON rs.id = p.race_subtype_id
        LEFT JOIN zones z ON z.id = p.current_zone_id
        WHERE p.id = ?
        ORDER BY p.id DESC
        LIMIT 1
      `,
      [newPlayerId]
    );

    const player = rows[0] || null;

    const hp = Number(player?.hp || 0);
    const maxHp = Number(player?.max_hp || 0);
    const energy = Number(player?.energy || 0);
    const maxEnergy = Number(player?.max_energy || 0);
    const hunger = Number(player?.hunger || 0);

    const hpPercent = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
    const energyPercent = maxEnergy > 0 ? Math.round((energy / maxEnergy) * 100) : 0;

    let hp_state = "healthy";
    if (hp <= 0) hp_state = "dead";
    else if (hpPercent <= 20) hp_state = "critical";
    else if (hpPercent <= 50) hp_state = "injured";

    let energy_state = "full";
    if (energyPercent <= 20) energy_state = "exhausted";
    else if (energyPercent <= 50) energy_state = "tired";

    let hunger_state = "fine";
    if (hunger >= 80) hunger_state = "starving";
    else if (hunger >= 50) hunger_state = "hungry";

    const survival_state = {
      hp_state,
      energy_state,
      hunger_state,
      hp_percent: hpPercent,
      energy_percent: energyPercent,
      is_alive: Number(player?.is_alive) === 1,
      zone: player?.zone_name || null,
      safe_zone: Number(player?.is_safe_zone) === 1,
      time: {
        year: Number(player?.year_survived || 0),
        day: Number(player?.day_survived || 0),
        hour: Number(player?.current_hour || 0),
        age_days: Number(player?.age_days || 0)
      }
    };

    return res.status(201).json({
      success: true,
      message: "Player reincarnated successfully",
      data: {
        previous_player_id: latestPlayer.id,
        new_player_id: newPlayerId,
        life_number: nextLifeNumber,
        race: {
          id: race.id,
          name: race.name,
          description: race.description
        },
        subtype: {
          id: subtype.id,
          name: subtype.name,
          description: subtype.description
        },
        player,
        survival_state
      }
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

// GET /api/player/me
router.get("/me", authenticateToken, async (req, res, next) => {
  try {
    const [rows] = await db.query(
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
          p.created_at,
          p.updated_at,
          r.name AS race_name,
          r.description AS race_description,
          rs.name AS subtype_name,
          rs.description AS subtype_description,
          z.name AS zone_name,
          z.zone_type,
          z.difficulty_level,
          z.environment_tag,
          z.description AS zone_description,
          z.is_safe_zone
        FROM players p
        INNER JOIN races r ON r.id = p.race_id
        INNER JOIN race_subtypes rs ON rs.id = p.race_subtype_id
        LEFT JOIN zones z ON z.id = p.current_zone_id
        WHERE p.user_id = ?
        ORDER BY p.id DESC
        LIMIT 1
      `,
      [req.user.id]
    );

    const player = rows[0] || null;

    if (!player) {
      return res.status(404).json({
        success: false,
        message: "Player profile not found"
      });
    }

    const hp = Number(player.hp || 0);
    const maxHp = Number(player.max_hp || 0);
    const energy = Number(player.energy || 0);
    const maxEnergy = Number(player.max_energy || 0);
    const hunger = Number(player.hunger || 0);

    const hpPercent = maxHp > 0 ? Math.round((hp / maxHp) * 100) : 0;
    const energyPercent = maxEnergy > 0 ? Math.round((energy / maxEnergy) * 100) : 0;

    let hp_state = "healthy";
    if (hp <= 0) hp_state = "dead";
    else if (hpPercent <= 20) hp_state = "critical";
    else if (hpPercent <= 50) hp_state = "injured";

    let energy_state = "full";
    if (energyPercent <= 20) energy_state = "exhausted";
    else if (energyPercent <= 50) energy_state = "tired";

    let hunger_state = "fine";
    if (hunger >= 80) hunger_state = "starving";
    else if (hunger >= 50) hunger_state = "hungry";

    const survival_state = {
      hp_state,
      energy_state,
      hunger_state,
      hp_percent: hpPercent,
      energy_percent: energyPercent,
      is_alive: Number(player.is_alive) === 1,
      zone: player.zone_name || null,
      safe_zone: Number(player.is_safe_zone) === 1,
      time: {
        year: Number(player.year_survived || 0),
        day: Number(player.day_survived || 0),
        hour: Number(player.current_hour || 0),
        age_days: Number(player.age_days || 0)
      }
    };

    return res.status(200).json({
      success: true,
      message: "Player profile fetched successfully",
      data: {
        player,
        survival_state
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;