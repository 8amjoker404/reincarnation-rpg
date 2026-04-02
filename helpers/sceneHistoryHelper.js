const db = require("../config/db");

async function saveSceneHistory(connection, payload) {
  await connection.query(
    `
    INSERT INTO player_scene_history (
      player_id,
      zone_id,
      scene_title,
      scene_text,
      event_summary,
      chosen_action_key,
      danger_level,
      environment_tag
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.player_id,
      payload.zone_id || null,
      payload.scene_title || "Unknown Scene",
      payload.scene_text || "",
      payload.event_summary || null,
      payload.chosen_action_key || null,
      Number(payload.danger_level || 1),
      payload.environment_tag || null
    ]
  );
}

function extractEventSummaryFromActionResult(result) {
  return (
    result?.body?.data?.event?.summary ||
    result?.body?.data?.event?.event_summary ||
    result?.body?.data?.event_summary ||
    null
  );
}

function buildHistoryStory(historyRows = []) {
  if (!historyRows.length) {
    return {
      title: "No history yet",
      story: "This life has not formed any remembered story yet.",
      entries: []
    };
  }

  const intro = "The memory of this life unfolds like a survival chronicle.";
  const parts = historyRows.map((row, index) => {
    const sceneTitle = row.scene_title || "Unknown moment";
    const sceneText = row.scene_text || "";
    const eventSummary = row.event_summary
      ? ` ${row.event_summary}`
      : "";
    const actionText = row.chosen_action_key
      ? ` The creature chose to ${row.chosen_action_key}.`
      : "";

    return `Chapter ${index + 1}: ${sceneTitle}. ${sceneText}${actionText}${eventSummary}`.trim();
  });

  return {
    title: "Story of Past Events",
    story: `${intro}\n\n${parts.join("\n\n")}`,
    entries: historyRows.map((row, index) => ({
      chapter: index + 1,
      scene_title: row.scene_title,
      scene_text: row.scene_text,
      event_summary: row.event_summary,
      chosen_action_key: row.chosen_action_key,
      danger_level: row.danger_level,
      environment_tag: row.environment_tag,
      created_at: row.created_at
    }))
  };
}

async function getPlayerStoryHistory(userId) {
  const connection = await db.getConnection();

  try {
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
      return {
        status: 404,
        body: {
          success: false,
          message: "No active player found"
        }
      };
    }

    const player = players[0];

    const [historyRows] = await connection.query(
      `
      SELECT
        h.id,
        h.player_id,
        h.zone_id,
        h.scene_title,
        h.scene_text,
        h.event_summary,
        h.chosen_action_key,
        h.danger_level,
        h.environment_tag,
        h.created_at,
        z.name AS zone_name
      FROM player_scene_history h
      LEFT JOIN zones z ON z.id = h.zone_id
      WHERE h.player_id = ?
      ORDER BY h.created_at ASC, h.id ASC
      `,
      [player.id]
    );

    const storyData = buildHistoryStory(historyRows);

    return {
      status: 200,
      body: {
        success: true,
        message: "Player history fetched successfully",
        data: {
          player_id: player.id,
          total_memories: historyRows.length,
          ...storyData
        }
      }
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        success: false,
        message: "Failed to fetch player history",
        error: error.message
      }
    };
  } finally {
    connection.release();
  }
}

module.exports = {
  saveSceneHistory,
  extractEventSummaryFromActionResult,
  buildHistoryStory,
  getPlayerStoryHistory
};