const { resolvePlayerSkillUse } = require("./skillEngine");
const {
  buildSceneActions,
  inferActionSetType
} = require("./sceneActionBuilder");

const ALLOWED_ACTION_KEYS = [
  "observe",
  "move",
  "rest",
  "hide",
  "attack",
  "use_skill"
];

async function resolvePlayAction(connection, context) {
  const { actionKey } = context;

  if (!ALLOWED_ACTION_KEYS.includes(actionKey)) {
    throw new Error("Invalid action key");
  }

  let resolution;

  switch (actionKey) {
    case "observe":
      resolution = await handleObserve(context);
      break;
    case "move":
      resolution = await handleMove(connection, context);
      break;
    case "rest":
      resolution = await handleRest(context);
      break;
    case "hide":
      resolution = await handleHide(context);
      break;
    case "attack":
      resolution = await handleAttack(context);
      break;
    case "use_skill":
      resolution = await handleUseSkill(connection, context);
      break;
    default:
      throw new Error("Unsupported action key");
  }

  return enrichBehaviorTracking(actionKey, resolution);
}

function enrichBehaviorTracking(actionKey, resolution) {
  const traitChanges = {
    aggressive: 0,
    intelligence: 0,
    stealth: 0,
    survival: 0
  };

  if (actionKey === "attack") traitChanges.aggressive = 1;
  if (actionKey === "observe") traitChanges.intelligence = 1;
  if (actionKey === "hide") traitChanges.stealth = 1;
  if (actionKey === "rest") traitChanges.survival = 1;
  if (actionKey === "move") traitChanges.survival = 1;

  return {
    ...resolution,
    behaviorTracking: {
      actionKey,
      traitChanges
    },
    event: {
      ...resolution.event,
      trait_changes: traitChanges
    }
  };
}

function buildActionSet(type = "neutral", context = {}) {
  return buildSceneActions({
    type,
    player: context.player || null,
    zone: context.currentZone || context.zone || null,
    skills: context.skills || [],
    actionKey: context.actionKey || null
  });
}

async function handleObserve(context) {
  const { currentZone } = context;

  return {
    statChanges: {
      energy: -1,
      hp: 0,
      hunger: 0
    },
    nextZone: currentZone,
    nextScene: {
      scene_title: `You Study ${currentZone.name}`,
      scene_text:
        "You slow down and read the land. Tracks, sound, scent, and movement begin to make more sense.",
      environment_tag: currentZone.environment_tag || null,
      danger_level: currentZone.difficulty_level || "low",
      actions: buildActionSet("neutral", context)
    },
    event: {
      action: "observe",
      summary: "You studied the area more carefully."
    }
  };
}

async function handleMove(connection, context) {
  const { currentZone } = context;

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
      WHERE is_active = 1
        AND parent_zone_id = ?
      ORDER BY RAND()
      LIMIT 1
    `,
    [currentZone.id]
  );

  const nextZone = rows[0] || currentZone;
  const actionType =
    Number(nextZone.is_safe_zone || 0) === 1 ? "safe" : "neutral";

  return {
    statChanges: {
      energy: -2,
      hp: 0,
      hunger: 1
    },
    nextZone,
    nextScene: {
      scene_title:
        nextZone.id === currentZone.id
          ? `You Reposition in ${currentZone.name}`
          : `You Move Into ${nextZone.name}`,
      scene_text:
        nextZone.id === currentZone.id
          ? "You shift your path and footing, but remain within the same area."
          : "You push forward and enter a new stretch of the world.",
      environment_tag: nextZone.environment_tag || null,
      danger_level: nextZone.difficulty_level || "low",
      actions: buildActionSet(actionType, {
        ...context,
        currentZone: nextZone
      })
    },
    event: {
      action: "move",
      summary:
        nextZone.id === currentZone.id
          ? "You moved within the current area."
          : `You moved into ${nextZone.name}.`
    }
  };
}

async function handleRest(context) {
  const { player, currentZone } = context;

  const healAmount = Math.max(
    2,
    Math.floor(Number(player.max_hp || 100) * 0.08)
  );
  const energyAmount = Math.max(
    4,
    Math.floor(Number(player.max_energy || 50) * 0.2)
  );
  const actionType =
    Number(currentZone.is_safe_zone || 0) === 1 ? "safe" : "neutral";

  return {
    statChanges: {
      hp: healAmount,
      energy: energyAmount,
      hunger: 2
    },
    nextZone: currentZone,
    nextScene: {
      scene_title: `You Rest in ${currentZone.name}`,
      scene_text:
        "You lower your guard just enough to recover. The pause helps, even if the world remains cruel.",
      environment_tag: currentZone.environment_tag || null,
      danger_level:
        Number(currentZone.is_safe_zone || 0) === 1
          ? "low"
          : currentZone.difficulty_level || "medium",
      actions: buildActionSet(actionType, context)
    },
    event: {
      action: "rest",
      summary: "You rested and recovered some strength."
    }
  };
}

async function handleHide(context) {
  const { currentZone } = context;

  return {
    statChanges: {
      hp: 0,
      energy: -1,
      hunger: 0
    },
    nextZone: currentZone,
    nextScene: {
      scene_title: "You Hide Yourself",
      scene_text:
        "You pull your body low and reduce your presence. The immediate pressure drops.",
      environment_tag: currentZone.environment_tag || null,
      danger_level: "low",
      actions: buildActionSet("safe", context)
    },
    event: {
      action: "hide",
      summary: "You hid and reduced your visibility."
    }
  };
}

async function handleAttack(context) {
  const { currentZone } = context;
  const hpLoss = currentZone.difficulty_level === "high" ? -6 : 0;

  return {
    statChanges: {
      hp: hpLoss,
      energy: -3,
      hunger: 1
    },
    nextZone: currentZone,
    nextScene: {
      scene_title: "You Strike First",
      scene_text:
        "You choose force before hesitation can weaken you. The area becomes more tense after the clash.",
      environment_tag: currentZone.environment_tag || null,
      danger_level: "high",
      actions: buildActionSet("danger", context)
    },
    event: {
      action: "attack",
      summary:
        hpLoss < 0
          ? "You attacked and took some damage in return."
          : "You attacked and raised the danger around you."
    }
  };
}

async function handleUseSkill(connection, context) {
  const { player, payload, currentZone, skills = [] } = context;
  const skillResult = await resolvePlayerSkillUse(connection, player.id, payload);

  if (!skillResult.ok) {
    return {
      statChanges: {
        hp: 0,
        energy: 0,
        hunger: 0
      },
      nextZone: {
        id: player.current_zone_id
      },
      nextScene: {
        scene_title: "Your Skill Fails to Answer",
        scene_text: skillResult.message,
        environment_tag: currentZone?.environment_tag || null,
        danger_level: currentZone?.difficulty_level || "low",
        actions: buildSceneActions({
          type: "neutral",
          player,
          zone: currentZone,
          skills,
          actionKey: "use_skill"
        })
      },
      event: {
        action: "use_skill",
        summary: skillResult.message,
        skill_error: true
      },
      skillUsage: null
    };
  }

  const outcome = skillResult.outcome || {};

  const inferredType = inferActionSetType({
    actionKey: "use_skill",
    zone: outcome?.nextZone || currentZone,
    dangerLevel: outcome?.nextScene?.danger_level,
    explicitType: null
  });

  return {
    ...outcome,
    nextScene: {
      ...(outcome.nextScene || {}),
      actions: buildSceneActions({
        type: inferredType,
        player,
        zone: outcome?.nextZone || currentZone,
        skills,
        actionKey: "use_skill"
      })
    }
  };
}

module.exports = {
  ALLOWED_ACTION_KEYS,
  resolvePlayAction
};