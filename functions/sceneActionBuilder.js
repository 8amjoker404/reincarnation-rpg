function cleanString(value) {
  const result = String(value || "").trim();
  return result || null;
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeSkillEntries(skills = []) {
  if (!Array.isArray(skills)) {
    return [];
  }

  return skills
    .map((entry) => {
      const skill = entry?.skill || entry || {};

      return {
        id: skill?.id || entry?.skill_id || null,
        player_skill_id: entry?.player_skill_id || entry?.id || null,
        name: cleanString(skill?.name || entry?.name) || null,
        skill_key: cleanString(skill?.skill_key || entry?.skill_key) || null,
        skill_type: String(skill?.skill_type || entry?.skill_type || "")
          .trim()
          .toLowerCase(),
        description:
          cleanString(skill?.description || entry?.description) || "",
        is_unlocked:
          entry?.is_unlocked === undefined ? true : Boolean(entry.is_unlocked),
        cooldown_remaining: safeNumber(
          entry?.cooldown_remaining ??
            entry?.current_cooldown ??
            entry?.remaining_cooldown ??
            0,
          0
        ),
        energy_cost: safeNumber(
          skill?.energy_cost ?? entry?.energy_cost ?? 0,
          0
        ),
        hp_cost: safeNumber(skill?.hp_cost ?? entry?.hp_cost ?? 0, 0)
      };
    })
    .filter((skill) => skill.name);
}

function isSkillUsable(skill, player = null) {
  if (!skill || !skill.is_unlocked) {
    return false;
  }

  if (Number(skill.cooldown_remaining || 0) > 0) {
    return false;
  }

  if (player) {
    const playerEnergy = safeNumber(player.energy, 0);
    const playerHp = safeNumber(player.hp, 0);

    if (Number(skill.energy_cost || 0) > playerEnergy) {
      return false;
    }

    if (Number(skill.hp_cost || 0) >= playerHp) {
      return false;
    }
  }

  return true;
}

function getDefaultActionText(actionKey) {
  switch (actionKey) {
    case "observe":
      return "Scan the darkness";
    case "move":
      return "Move carefully ahead";
    case "hide":
      return "Blend into the shadows";
    case "rest":
      return "Catch your breath";
    case "attack":
      return "Strike at the threat";
    case "use_skill":
      return "Use a skill";
    default:
      return "Continue forward";
  }
}

function getBaseActionsByType(type = "neutral") {
  if (type === "safe") {
    return [
      { key: "observe", text: getDefaultActionText("observe") },
      { key: "move", text: getDefaultActionText("move") },
      { key: "rest", text: getDefaultActionText("rest") },
      { key: "hide", text: getDefaultActionText("hide") }
    ];
  }

  if (type === "danger") {
    return [
      { key: "hide", text: getDefaultActionText("hide") },
      { key: "move", text: getDefaultActionText("move") },
      { key: "attack", text: getDefaultActionText("attack") },
      { key: "observe", text: getDefaultActionText("observe") }
    ];
  }

  return [
    { key: "observe", text: getDefaultActionText("observe") },
    { key: "move", text: getDefaultActionText("move") },
    { key: "hide", text: getDefaultActionText("hide") },
    { key: "rest", text: getDefaultActionText("rest") }
  ];
}

function inferActionSetType({
  explicitType = null,
  actionKey = null,
  zone = null,
  dangerLevel = null
}) {
  if (explicitType) {
    return explicitType;
  }

  const normalizedActionKey = String(actionKey || "").trim().toLowerCase();
  const safeZone = Number(zone?.is_safe_zone || 0) === 1;
  const danger = safeNumber(dangerLevel, null);

  if (normalizedActionKey === "attack") {
    return "danger";
  }

  if (normalizedActionKey === "hide") {
    return "safe";
  }

  if (normalizedActionKey === "rest") {
    return safeZone ? "safe" : "neutral";
  }

  if (normalizedActionKey === "move") {
    return safeZone ? "safe" : "neutral";
  }

  if (normalizedActionKey === "use_skill") {
    if (danger !== null && danger >= 6) {
      return "danger";
    }

    return safeZone ? "safe" : "neutral";
  }

  if (danger !== null && danger >= 6) {
    return "danger";
  }

  if (safeZone) {
    return "safe";
  }

  return "neutral";
}

function scoreSkillForScene(skill, { type = "neutral", zone = null, actionKey = null } = {}) {
  const text = `${skill.skill_type || ""} ${skill.description || ""} ${skill.name || ""}`
    .toLowerCase()
    .trim();

  let score = 0;

  const has = (words = []) => words.some((word) => text.includes(word));

  if (type === "danger") {
    if (has(["attack", "offense", "combat", "strike", "claw", "bite", "damage"])) {
      score += 5;
    }
    if (has(["stealth", "hide", "cloak", "shadow", "conceal", "escape"])) {
      score += 3;
    }
    if (has(["heal", "recover", "guard", "shield", "defense"])) {
      score += 2;
    }
  }

  if (type === "safe") {
    if (has(["heal", "recover", "rest", "regenerate", "guard", "shield"])) {
      score += 4;
    }
    if (has(["stealth", "hide", "cloak", "shadow", "conceal"])) {
      score += 3;
    }
    if (has(["sense", "vision", "observe", "scan", "detect"])) {
      score += 2;
    }
  }

  if (type === "neutral") {
    if (has(["sense", "vision", "observe", "scan", "detect"])) {
      score += 4;
    }
    if (has(["stealth", "hide", "cloak", "shadow", "conceal"])) {
      score += 3;
    }
    if (has(["move", "dash", "step", "mobility", "escape"])) {
      score += 2;
    }
  }

  if (String(actionKey || "").trim().toLowerCase() === "use_skill") {
    score += 2;
  }

  if (Number(zone?.is_safe_zone || 0) === 1 && has(["heal", "recover", "guard"])) {
    score += 1;
  }

  return score;
}

function pickBestSkillOption({
  skills = [],
  player = null,
  type = "neutral",
  zone = null,
  actionKey = null
}) {
  const normalizedSkills = normalizeSkillEntries(skills).filter((skill) =>
    isSkillUsable(skill, player)
  );

  if (!normalizedSkills.length) {
    return null;
  }

  let best = null;

  for (const skill of normalizedSkills) {
    const score = scoreSkillForScene(skill, {
      type,
      zone,
      actionKey
    });

    if (!best || score > best.score) {
      best = { skill, score };
    }
  }

  if (!best || best.score <= 0) {
    return null;
  }

  return {
    key: "use_skill",
    text: `Use ${best.skill.name}`,
    skill_id: best.skill.id,
    player_skill_id: best.skill.player_skill_id,
    skill_key: best.skill.skill_key,
    skill_name: best.skill.name
  };
}

function buildSceneActions({
  type = "neutral",
  player = null,
  zone = null,
  skills = [],
  actionKey = null
}) {
  const baseActions = getBaseActionsByType(type);
  const bestSkillOption = pickBestSkillOption({
    skills,
    player,
    type,
    zone,
    actionKey
  });

  if (!bestSkillOption) {
    return baseActions.map((action, index) => ({
      slot: index + 1,
      ...action
    }));
  }

  const finalActions = [...baseActions];
  finalActions[3] = bestSkillOption;

  return finalActions.map((action, index) => ({
    slot: index + 1,
    ...action
  }));
}

module.exports = {
  buildSceneActions,
  inferActionSetType,
  normalizeSkillEntries,
  getDefaultActionText
};