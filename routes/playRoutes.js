const express = require("express");
const router = express.Router();
const db = require("../config/db");

const { authenticateToken } = require("../middleware/authMiddleware");
const { playAction } = require("../functions/playEngine");
const {
  saveSceneHistory,
  extractEventSummaryFromActionResult
} = require("../helpers/sceneHistoryHelper");
const {
  getZoneNpcs,
  getPlayerNpcMemoriesForZone,
  ensureZoneNpcEncounter
} = require("../functions/npcEngine");

function buildSceneActions(scene) {
  if (!scene) return [];

  return [
    {
      slot: 1,
      key: scene.option_1_key || "observe",
      text: scene.option_1 || "Scan surroundings"
    },
    {
      slot: 2,
      key: scene.option_2_key || "move",
      text: scene.option_2 || "Move carefully"
    },
    {
      slot: 3,
      key: scene.option_3_key || "hide",
      text: scene.option_3 || "Hide presence"
    },
    {
      slot: 4,
      key: scene.option_4_key || "rest",
      text: scene.option_4 || "Recover strength"
    }
  ];
}

// api/start
router.post("/start", authenticateToken, async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const userId = req.user?.id;

    if (!userId) {
      await connection.rollback();
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    // =========================
    // 1. GET PLAYER
    // =========================
    const [players] = await connection.query(
      `
      SELECT p.*, r.name AS race_name, rs.name AS subtype_name
      FROM players p
      LEFT JOIN races r ON p.race_id = r.id
      LEFT JOIN race_subtypes rs ON p.race_subtype_id = rs.id
      WHERE p.user_id = ? AND p.is_alive = 1
      LIMIT 1
      `,
      [userId]
    );

    if (!players.length) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "No active player found"
      });
    }

    const player = players[0];

    // =========================
    // 2. CHECK IF SCENE EXISTS
    // =========================
    const [existingSceneRows] = await connection.query(
      `
      SELECT *
      FROM player_current_scene
      WHERE player_id = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [player.id]
    );

    const existingScene = existingSceneRows[0] || null;

    // =========================
    // 3. GET ZONE
    // =========================
    let [zones] = await connection.query(
      `SELECT * FROM zones WHERE id = ? LIMIT 1`,
      [player.current_zone_id]
    );

    let zone = zones[0];

    if (!zone) {
      const [fallback] = await connection.query(
        `SELECT * FROM zones WHERE is_active = 1 LIMIT 1`
      );

      zone = fallback[0];

      if (!zone) {
        throw new Error("No zone found");
      }

      await connection.query(
        `UPDATE players SET current_zone_id = ? WHERE id = ?`,
        [zone.id, player.id]
      );

      player.current_zone_id = zone.id;
    }

    // =========================
    // 4. IF ALREADY STARTED
    // =========================
    if (existingScene) {
      existingScene.actions = buildSceneActions(existingScene);

      const zoneNpcs = await getZoneNpcs(connection, zone.id);
      const npcMemories = await getPlayerNpcMemoriesForZone(
        connection,
        player.id,
        zone.id
      );

      await connection.commit();

      return res.json({
        success: true,
        message: "Game already started",
        data: {
          player,
          zone,
          current_scene: existingScene,
          npcs: {
            zone_npcs: zoneNpcs,
            encountered_npc: null,
            npc_memory: null,
            memories: npcMemories
          },
          ai: {
            narration_applied: false,
            choice_text_applied: false
          }
        }
      });
    }

    // =========================
    // 5. CREATE BASE SCENE
    // =========================
    const sceneTitle = `Awakening in ${zone.name}`;

    const sceneText = `${player.character_name} awakens in ${zone.name}.
The world feels dangerous. You are weak. Survival begins now.`;

    // =========================
    // 6. INSERT SCENE
    // =========================
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
      `,
      [
        player.id,
        zone.id,
        sceneTitle,
        sceneText,
        zone.environment_tag || "wild",
        "low",
        "Observe surroundings",
        "observe",
        "Move carefully",
        "move",
        "Hide quietly",
        "hide",
        "Rest briefly",
        "rest"
      ]
    );

    // =========================
    // 7. SAVE FIRST SCENE TO HISTORY
    // =========================
    await saveSceneHistory(connection, {
      player_id: player.id,
      zone_id: zone.id,
      scene_title: sceneTitle,
      scene_text: sceneText,
      event_summary: "The journey begins.",
      chosen_action_key: null,
      danger_level: "low",
      environment_tag: zone.environment_tag || "wild"
    });

    // =========================
    // 8. MARK STARTED
    // =========================
    await connection.query(
      `UPDATE players SET has_started_scene = 1 WHERE id = ?`,
      [player.id]
    );

    // =========================
    // 9. FETCH SCENE + NPC STATE
    // =========================
    const [createdSceneRows] = await connection.query(
      `
      SELECT *
      FROM player_current_scene
      WHERE player_id = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [player.id]
    );

    const createdScene = createdSceneRows[0] || null;

    if (createdScene) {
      createdScene.actions = buildSceneActions(createdScene);
    }

    const zoneNpcs = await getZoneNpcs(connection, zone.id);
    const npcEncounter = await ensureZoneNpcEncounter(
      connection,
      player.id,
      zone.id
    );
    const npcMemories = await getPlayerNpcMemoriesForZone(
      connection,
      player.id,
      zone.id
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Game started successfully",
      data: {
        player,
        zone,
        current_scene: createdScene,
        npcs: {
          zone_npcs: zoneNpcs,
          encountered_npc: npcEncounter.encountered_npc,
          npc_memory: npcEncounter.npc_memory,
          memories: npcMemories
        },
        ai: {
          narration_applied: false,
          choice_text_applied: false
        }
      }
    });
  } catch (error) {
    await connection.rollback();

    return res.status(500).json({
      success: false,
      message: "Failed to start game",
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// GET /api/play
router.get("/", authenticateToken, async (req, res) => {
  const connection = await db.getConnection();

  try {
    const userId = req.user.id;

    // =========================
    // 1. GET PLAYER
    // =========================
    const [players] = await connection.query(
      `
      SELECT p.*, r.name AS race_name, rs.name AS subtype_name
      FROM players p
      LEFT JOIN races r ON p.race_id = r.id
      LEFT JOIN race_subtypes rs ON p.race_subtype_id = rs.id
      WHERE p.user_id = ? AND p.is_alive = 1
      LIMIT 1
      `,
      [userId]
    );

    if (!players.length) {
      return res.status(404).json({
        success: false,
        message: "No active player found"
      });
    }

    const player = players[0];

    // =========================
    // 2. GET ZONE
    // =========================
    let [zones] = await connection.query(
      `SELECT * FROM zones WHERE id = ? LIMIT 1`,
      [player.current_zone_id]
    );

    let zone = zones[0] || null;

    if (!zone) {
      const [fallback] = await connection.query(
        `SELECT * FROM zones WHERE is_active = 1 LIMIT 1`
      );

      zone = fallback[0] || null;

      if (zone) {
        await connection.query(
          `UPDATE players SET current_zone_id = ? WHERE id = ?`,
          [zone.id, player.id]
        );

        player.current_zone_id = zone.id;
      }
    }

    // =========================
    // 3. GET CURRENT SCENE
    // =========================
    const [scenes] = await connection.query(
      `
      SELECT *
      FROM player_current_scene
      WHERE player_id = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [player.id]
    );

    let currentScene = scenes[0] || null;

    if (currentScene) {
      currentScene.actions = buildSceneActions(currentScene);
    }

    // =========================
    // 4. GET TRAITS
    // =========================
    const [traitsRows] = await connection.query(
      `SELECT * FROM player_traits WHERE player_id = ? LIMIT 1`,
      [player.id]
    );

    const traits = traitsRows[0] || {
      aggressive: 0,
      intelligence: 0,
      stealth: 0,
      survival: 0
    };

    // =========================
    // 5. GET ACTION LOGS
    // =========================
    const [actionLogs] = await connection.query(
      `SELECT action_key, count FROM player_action_logs WHERE player_id = ?`,
      [player.id]
    );

    // =========================
    // 6. GET PLAYER SKILLS
    // =========================
    const [skills] = await connection.query(
      `
      SELECT
        ps.id AS player_skill_id,
        ps.player_id,
        ps.skill_id,
        ps.skill_level,
        s.id,
        s.name,
        s.skill_key,
        s.description,
        s.energy_cost,
        s.cooldown_turns,
        s.effect_kind,
        s.effect_value,
        s.unlock_type,
        s.unlock_action_key,
        s.unlock_value
      FROM player_skills ps
      JOIN skills s ON ps.skill_id = s.id
      WHERE ps.player_id = ?
      `,
      [player.id]
    );

    // =========================
    // 7. RETURN ONLY UNLOCKED SKILLS
    // =========================
    const formattedSkills = skills
      .filter((skill) => {
        if (skill.unlock_type === "survival") {
          return player.day_survived >= skill.unlock_value;
        }

        if (skill.unlock_type === "action_count") {
          const log = actionLogs.find(
            (a) => a.action_key === skill.unlock_action_key
          );

          return !!(log && log.count >= skill.unlock_value);
        }

        return true;
      })
      .map((skill) => {
        return {
          player_skill_id: skill.player_skill_id,
          skill_id: skill.skill_id,
          skill_level: skill.skill_level,
          skill: {
            id: skill.id,
            name: skill.name,
            skill_key: skill.skill_key,
            description: skill.description,
            energy_cost: skill.energy_cost,
            cooldown_turns: skill.cooldown_turns,
            effect_kind: skill.effect_kind,
            effect_value: skill.effect_value
          }
        };
      });

    // =========================
    // 8. GET NPC STATE
    // =========================
    let zoneNpcs = [];
    let npcMemories = [];

    if (zone?.id) {
      zoneNpcs = await getZoneNpcs(connection, zone.id);
      npcMemories = await getPlayerNpcMemoriesForZone(
        connection,
        player.id,
        zone.id
      );
    }

    return res.json({
      success: true,
      message: "Current play state fetched successfully",
      data: {
        player,
        zone,
        current_scene: currentScene,
        traits,
        action_logs: actionLogs,
        skills: formattedSkills,
        npcs: {
          zone_npcs: zoneNpcs,
          encountered_npc: null,
          npc_memory: null,
          memories: npcMemories
        },
        ai: {
          narration_applied: false,
          choice_text_applied: false
        }
      }
    });
  } catch (error) {
    console.error("GET /play error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch current play state",
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// POST /api/play/action
router.post("/action", authenticateToken, async (req, res) => {
  const connection = await db.getConnection();

  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const [players] = await connection.query(
      `
      SELECT *
      FROM players
      WHERE user_id = ? AND is_alive = 1
      LIMIT 1
      `,
      [userId]
    );

    if (!players.length) {
      return res.status(404).json({
        success: false,
        message: "No active player found"
      });
    }

    const player = players[0];
    const chosenActionKey = String(req.body?.action_key || "").trim().toLowerCase();

    const [scenes] = await connection.query(
      `
      SELECT *
      FROM player_current_scene
      WHERE player_id = ?
      ORDER BY id DESC
      LIMIT 1
      `,
      [player.id]
    );

    const previousScene = scenes[0] || null;

    const result = await playAction(userId, req.body || {});

    if (
      result?.status >= 200 &&
      result?.status < 300 &&
      result?.body?.success &&
      previousScene
    ) {
      await saveSceneHistory(connection, {
        player_id: player.id,
        zone_id: previousScene.zone_id,
        scene_title: previousScene.scene_title,
        scene_text: previousScene.scene_text,
        event_summary: extractEventSummaryFromActionResult(result),
        chosen_action_key: chosenActionKey || null,
        danger_level: previousScene.danger_level || "low",
        environment_tag: previousScene.environment_tag || null
      });
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to resolve action",
      error: error.message
    });
  } finally {
    connection.release();
  }
});

module.exports = router;