const db = require("../config/db");
const { ALLOWED_ACTION_KEYS, resolvePlayAction } = require("./actionResolver");
const {
  syncPlayerSkillsForPlayer,
  getPlayerSkillsSummary,
  processSkillCooldowns
} = require("./skillEngine");

const {
  getAlivePlayerByUserId,
  getPlayerById,
  getPlayerTraits,
  getPlayerActionLogs,
  applyPlayerChanges,
  ensurePlayerTraitsRow,
  logPlayerAction,
  applyTraitGrowth
} = require("./playEngine/playerState");

const {
  getCurrentSceneByPlayerId,
  getResolvedCurrentZone,
  resolveNextZone,
  createSceneFromAiResult,
  saveSceneHistoryEntry,
  getSceneAiMetaBySceneId,
  upsertSceneAiCache,
  formatPlayer,
  formatZone,
  formatScene,
  formatTraits,
  buildContinuationBaseScene
} = require("./playEngine/sceneState");

const {
  buildAiWorldContext
} = require("./playEngine/worldContext");

const {
  buildAiPresentation
} = require("./playEngine/aiPresentation");

async function playAction(userId, payload) {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const actionKey = String(payload?.action_key || "").trim().toLowerCase();

    if (!actionKey) {
      await connection.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: "action_key is required"
        }
      };
    }

    if (!ALLOWED_ACTION_KEYS.includes(actionKey)) {
      await connection.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: "Invalid action_key",
          allowed_actions: ALLOWED_ACTION_KEYS
        }
      };
    }

    const player = await getAlivePlayerByUserId(connection, userId);

    if (!player) {
      await connection.rollback();
      return {
        status: 404,
        body: {
          success: false,
          message: "No active living player found for this user"
        }
      };
    }

    const currentScene = await getCurrentSceneByPlayerId(connection, player.id);

    if (!currentScene) {
      await connection.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: "No active scene found. Start the game first."
        }
      };
    }

    const currentZone = await getResolvedCurrentZone(
      connection,
      player,
      currentScene.zone_id
    );

    if (!currentZone) {
      await connection.rollback();
      return {
        status: 404,
        body: {
          success: false,
          message: "Current zone not found"
        }
      };
    }

    await syncPlayerSkillsForPlayer(connection, player.id);
    const currentSkills = await getPlayerSkillsSummary(connection, player.id);

    const resolution = await resolvePlayAction(connection, {
      player,
      currentScene,
      currentZone,
      actionKey,
      payload,
      skills: currentSkills
    });

    if (resolution?.event?.skill_error) {
      await connection.rollback();
      return {
        status: 400,
        body: {
          success: false,
          message: resolution.event.summary || "Skill action failed"
        }
      };
    }

    const updatedPlayer = await applyPlayerChanges(connection, player, resolution);

    await ensurePlayerTraitsRow(connection, updatedPlayer.id);
    await logPlayerAction(connection, updatedPlayer.id, actionKey);

    await applyTraitGrowth(
      connection,
      updatedPlayer.id,
      resolution?.behaviorTracking?.traitChanges || {}
    );

    await processSkillCooldowns(
      connection,
      updatedPlayer.id,
      resolution?.skillUsage?.player_skill_id || null,
      resolution?.skillUsage?.cooldown_turns || 0
    );

    const nextZone = await resolveNextZone(
      connection,
      resolution,
      currentZone,
      updatedPlayer
    );

    if (Number(updatedPlayer.current_zone_id || 0) !== Number(nextZone.id)) {
      await connection.query(
        `
        UPDATE players
        SET current_zone_id = ?
        WHERE id = ?
        `,
        [nextZone.id, updatedPlayer.id]
      );
      updatedPlayer.current_zone_id = nextZone.id;
    }

    await syncPlayerSkillsForPlayer(connection, updatedPlayer.id);

    const finalPlayer = await getPlayerById(connection, updatedPlayer.id);
    const traits = await getPlayerTraits(connection, updatedPlayer.id);
    const actionLogs = await getPlayerActionLogs(connection, updatedPlayer.id);
    const skills = await getPlayerSkillsSummary(connection, updatedPlayer.id);

    const baseNextScene = buildContinuationBaseScene({
      previousScene: currentScene,
      player: finalPlayer,
      zone: nextZone,
      event: resolution?.event || null,
      actionKey,
      resolution,
      skills
    });

    const aiWorldContext = await buildAiWorldContext(connection, {
      player: finalPlayer,
      zone: nextZone,
      currentScene,
      nextBaseScene: baseNextScene,
      actionKey,
      event: resolution?.event || null
    });

    const aiPresentation = await buildAiPresentation({
      player: finalPlayer,
      zone: nextZone,
      scene: baseNextScene,
      previousScene: formatScene(currentScene),
      currentSceneSnapshot: formatScene(currentScene),
      actionKey,
      event: resolution?.event || null,
      traits,
      actionLogs,
      skills,
      sceneHistory: aiWorldContext.sceneHistory,
      zoneNpcs: aiWorldContext.zoneNpcs,
      playerNpcMemory: aiWorldContext.playerNpcMemory
    });

    const savedScene = await createSceneFromAiResult(
      connection,
      finalPlayer,
      nextZone,
      aiPresentation
    );

    await saveSceneHistoryEntry(connection, {
      player: finalPlayer,
      zone: nextZone,
      currentScene,
      savedScene,
      actionKey,
      event: aiPresentation.event || resolution?.event || null
    });

    await upsertSceneAiCache(connection, {
      playerId: finalPlayer.id,
      playerSceneId: savedScene.id,
      sourceSceneUpdatedAt: savedScene.updated_at,
      baseScene: baseNextScene,
      aiResult: aiPresentation
    });

    const aiMeta = await getSceneAiMetaBySceneId(connection, savedScene.id);

    await connection.commit();

    return {
      status: 200,
      body: {
        success: true,
        message: "Action resolved successfully",
        data: {
          event: aiPresentation.event || resolution?.event || null,
          player: formatPlayer(finalPlayer),
          zone: formatZone(nextZone),
          current_scene: formatScene(savedScene),
          traits: formatTraits(traits),
          action_logs: actionLogs,
          skills,
          scene_history_preview: aiWorldContext.sceneHistory,
          zone_npcs: aiWorldContext.zoneNpcs,
          player_npc_memory: aiWorldContext.playerNpcMemory,
          ai: aiMeta
        }
      }
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {}

    return {
      status: 500,
      body: {
        success: false,
        message: "Failed to resolve action",
        error: error.message
      }
    };
  } finally {
    connection.release();
  }
}

module.exports = {
  playAction
};