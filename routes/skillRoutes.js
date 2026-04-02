const express = require("express");
const router = express.Router();

const { authenticateToken } = require("../middleware/authMiddleware");
const { getMySkillsForUser } = require("../functions/skillEngine");
const { playAction } = require("../functions/playEngine");

// GET /api/skills/me
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const result = await getMySkillsForUser(userId);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch player skills",
      error: error.message
    });
  }
});

// POST /api/skills/use
router.post("/use", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const payload = {
      action_key: "use_skill",
      skill_key: req.body?.skill_key
    };

    const result = await playAction(userId, payload);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to use skill",
      error: error.message
    });
  }
});

module.exports = router;