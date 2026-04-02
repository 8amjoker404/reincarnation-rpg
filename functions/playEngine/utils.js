const { ALLOWED_ACTION_KEYS } = require("../actionResolver");
const {
  buildSceneActions,
  inferActionSetType,
  getDefaultActionText: getSceneActionDefaultText
} = require("../sceneActionBuilder");

const DEFAULT_ACTIONS = buildSceneActions({
  type: "neutral",
  player: null,
  zone: null,
  skills: []
}).map(({ slot, ...action }) => action);

function sanitizeSceneForStorage(scene, zone) {
  const fallbackActions = buildSceneActions({
    type: inferActionSetType({
      zone,
      dangerLevel: scene?.danger_level || zone?.difficulty_level || 1
    }),
    player: null,
    zone,
    skills: []
  });

  const actions = normalizeActions(scene?.actions || fallbackActions);

  return {
    scene_title: cleanString(scene?.scene_title) || `Scene in ${zone.name}`,
    scene_text:
      cleanString(scene?.scene_text) || "The world shifts around you.",
    environment_tag:
      cleanString(scene?.environment_tag) ||
      cleanString(zone?.environment_tag) ||
      cleanString(zone?.zone_type) ||
      "wild",
    danger_level: normalizeDangerLevel(
      scene?.danger_level || zone?.difficulty_level
    ),
    actions
  };
}

function normalizeActions(actions) {
  const normalized = Array.isArray(actions) ? actions : [];
  const finalActions = [];

  for (let i = 0; i < 4; i += 1) {
    const raw = normalized[i] || DEFAULT_ACTIONS[i] || DEFAULT_ACTIONS[0];
    const key = normalizeActionKey(
      raw.key || raw.action_key || DEFAULT_ACTIONS[i].key
    );

    finalActions.push({
      slot: i + 1,
      key,
      text:
        cleanString(raw.text || raw.label || raw.name) ||
        getSceneActionDefaultText(key)
    });
  }

  return finalActions;
}

function normalizeActionKey(key) {
  const normalized = String(key || "").trim().toLowerCase();

  if (ALLOWED_ACTION_KEYS.includes(normalized)) {
    return normalized;
  }

  return "observe";
}

function normalizeDangerLevel(value) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return 1;
  }

  if (num < 1) return 1;
  if (num > 10) return 10;

  return Math.floor(num);
}

async function tryQueryVariants(connection, variants = []) {
  let lastError = null;

  for (const variant of variants) {
    try {
      const [rows] = await connection.query(variant.sql, variant.values || []);
      return rows || [];
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    return [];
  }

  return [];
}

async function executeFirstSuccessfulQuery(connection, variants = []) {
  let lastError = null;

  for (const variant of variants) {
    try {
      await connection.query(variant.sql, variant.values || []);
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    return false;
  }

  return false;
}

function clampNumber(value, fallback, min, max) {
  const num = Number(value);

  if (!Number.isFinite(num)) {
    return fallback;
  }

  if (num < min) return min;
  if (num > max) return max;

  return Math.floor(num);
}

function cleanString(value) {
  const result = String(value || "").trim();
  return result || null;
}

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

module.exports = {
  DEFAULT_ACTIONS,
  sanitizeSceneForStorage,
  normalizeActions,
  normalizeActionKey,
  normalizeDangerLevel,
  tryQueryVariants,
  executeFirstSuccessfulQuery,
  clampNumber,
  cleanString,
  safeNumber
};