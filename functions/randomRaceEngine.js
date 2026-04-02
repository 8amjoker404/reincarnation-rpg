// backend/functions/randomRaceEngine.js
const db = require("../config/db");

const getRandomItem = (items) => {
  const randomIndex = Math.floor(Math.random() * items.length);
  return items[randomIndex];
};

const getRandomActiveRaceAndSubtype = async () => {
  const [races] = await db.query(
    `
      SELECT id, name, description
      FROM races
      WHERE is_active = 1
      ORDER BY id ASC
    `
  );

  if (!races.length) {
    throw new Error("No active races found. Please seed the races table.");
  }

  const selectedRace = getRandomItem(races);

  const [subtypes] = await db.query(
    `
      SELECT
        id,
        race_id,
        name,
        description,
        base_hp,
        base_energy,
        base_attack,
        base_defense,
        base_speed,
        base_intelligence
      FROM race_subtypes
      WHERE race_id = ? AND is_active = 1
      ORDER BY id ASC
    `,
    [selectedRace.id]
  );

  if (!subtypes.length) {
    throw new Error(`No active subtypes found for race: ${selectedRace.name}`);
  }

  const selectedSubtype = getRandomItem(subtypes);

  return {
    race: selectedRace,
    subtype: selectedSubtype
  };
};

module.exports = {
  getRandomActiveRaceAndSubtype
};