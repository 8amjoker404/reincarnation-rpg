// backend/routes/playRoutes.js
const express = require("express");
const { authenticateToken } = require("../middleware/authMiddleware");
const { getCurrentPlayState, playAction } = require("../functions/playEngine");

const router = express.Router();

// GET /api/play
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const result = await getCurrentPlayState(userId);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to load play state",
      error: error.message
    });
  }
});

// POST /api/play/action
router.post("/action", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const result = await playAction(userId, req.body || {});
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to resolve play action",
      error: error.message
    });
  }
});

// GET /api/player/traits
router.get("/traits", authenticateToken, async (req, res, next) => {
  const connection = await db.getConnection();

  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const [playerRows] = await connection.query(
      `
        SELECT id, user_id, character_name, is_alive
        FROM players
        WHERE user_id = ?
          AND is_alive = 1
        ORDER BY id DESC
        LIMIT 1
      `,
      [userId]
    );

    if (!playerRows.length) {
      return res.status(404).json({
        success: false,
        message: "No active living player found for this user"
      });
    }

    const player = playerRows[0];

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
      [player.id]
    );

    const [traitRows] = await connection.query(
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
      [player.id]
    );

    return res.status(200).json({
      success: true,
      message: "Player traits fetched successfully",
      data: traitRows[0]
    });
  } catch (error) {
    next(error);
  } finally {
    connection.release();
  }
});

// GET /api/player/actions
router.get("/actions", authenticateToken, async (req, res, next) => {
  const connection = await db.getConnection();

  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const [playerRows] = await connection.query(
      `
        SELECT id, user_id, character_name, is_alive
        FROM players
        WHERE user_id = ?
          AND is_alive = 1
        ORDER BY id DESC
        LIMIT 1
      `,
      [userId]
    );

    if (!playerRows.length) {
      return res.status(404).json({
        success: false,
        message: "No active living player found for this user"
      });
    }

    const player = playerRows[0];

    const [actionRows] = await connection.query(
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
      [player.id]
    );

    return res.status(200).json({
      success: true,
      message: "Player action logs fetched successfully",
      data: actionRows
    });
  } catch (error) {
    next(error);
  } finally {
    connection.release();
  }
});

module.exports = router;