const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authMiddleware");
const { getPlayerStoryHistory } = require("../helpers/sceneHistoryHelper");

// GET /api/history
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized"
      });
    }

    const result = await getPlayerStoryHistory(userId);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch history",
      error: error.message
    });
  }
});

module.exports = router;