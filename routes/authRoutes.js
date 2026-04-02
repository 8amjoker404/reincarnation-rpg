const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");
const { getRandomActiveRaceAndSubtype } = require("../functions/randomRaceEngine");

const router = express.Router();
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      is_god: user.is_god || 0
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d"
    }
  );
};

const generateFallbackCharacterName = (username) => {
  const cleanUsername = String(username || "wanderer").trim();
  const suffix = Math.floor(1000 + Math.random() * 9000);
  return `${cleanUsername}_spawn_${suffix}`;
};

// POST /api/auth/register
router.post("/register", async (req, res, next) => {
  try {
    const { username, email, password, character_name } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "username, email, and password are required"
      });
    }

    const cleanUsername = String(username).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPassword = String(password).trim();
    const cleanCharacterName = character_name
      ? String(character_name).trim()
      : generateFallbackCharacterName(cleanUsername);

    if (cleanUsername.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Username must be at least 3 characters long"
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long"
      });
    }

    const [existingUsers] = await db.query(
      `
        SELECT id, username, email
        FROM users
        WHERE username = ? OR email = ?
        LIMIT 1
      `,
      [cleanUsername, cleanEmail]
    );

    if (existingUsers.length > 0) {
      if (existingUsers[0].username === cleanUsername) {
        return res.status(409).json({
          success: false,
          message: "Username already exists"
        });
      }

      if (existingUsers[0].email === cleanEmail) {
        return res.status(409).json({
          success: false,
          message: "Email already exists"
        });
      }
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);

    const randomSelection = await getRandomActiveRaceAndSubtype();
    const selectedRace = randomSelection.race;
    const selectedSubtype = randomSelection.subtype;

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [userResult] = await connection.query(
        `
          INSERT INTO users (username, email, password_hash, is_god)
          VALUES (?, ?, ?, 0)
        `,
        [cleanUsername, cleanEmail, passwordHash]
      );

      const userId = userResult.insertId;

      const starterHp = selectedSubtype.base_hp;
      const starterEnergy = selectedSubtype.base_energy;
      const starterAttack = selectedSubtype.base_attack;
      const starterDefense = selectedSubtype.base_defense;
      const starterSpeed = selectedSubtype.base_speed;
      const starterIntelligence = selectedSubtype.base_intelligence;

      const [playerResult] = await connection.query(
        `
          INSERT INTO players (
            user_id,
            character_name,
            race_id,
            race_subtype_id,
            level,
            year_survived,
            day_survived,
            age_days,
            hp,
            max_hp,
            energy,
            max_energy,
            hunger,
            attack_stat,
            defense_stat,
            speed_stat,
            intelligence_stat,
            evolution_stage,
            title,
            alignment_type,
            current_zone_id,
            is_alive
          )
          VALUES (?, ?, ?, ?, 1, 0, 0, 0, ?, ?, ?, ?, 0, ?, ?, ?, ?, 1, 'Nameless Being', 'neutral', NULL, 1)
        `,
        [
          userId,
          cleanCharacterName,
          selectedRace.id,
          selectedSubtype.id,
          starterHp,
          starterHp,
          starterEnergy,
          starterEnergy,
          starterAttack,
          starterDefense,
          starterSpeed,
          starterIntelligence
        ]
      );

      await connection.commit();

      const user = {
        id: userId,
        username: cleanUsername,
        email: cleanEmail,
        is_god: 0
      };

      const token = generateToken(user);

      return res.status(201).json({
        success: true,
        message: "User registered successfully",
        data: {
          user,
          token,
          player: {
            id: playerResult.insertId,
            user_id: userId,
            character_name: cleanCharacterName,
            race_id: selectedRace.id,
            race_name: selectedRace.name,
            race_subtype_id: selectedSubtype.id,
            race_subtype_name: selectedSubtype.name,
            level: 1,
            hp: starterHp,
            max_hp: starterHp,
            energy: starterEnergy,
            max_energy: starterEnergy,
            hunger: 0,
            attack_stat: starterAttack,
            defense_stat: starterDefense,
            speed_stat: starterSpeed,
            intelligence_stat: starterIntelligence,
            is_alive: 1
          }
        }
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/login
router.post("/login", async (req, res, next) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "identifier and password are required"
      });
    }

    const cleanIdentifier = String(identifier).trim().toLowerCase();
    const cleanPassword = String(password).trim();

    // Single query for both email or username
    const [users] = await db.query(
      `
        SELECT id, username, email, password_hash, is_god
        FROM users
        WHERE email = ? OR username = ?
        LIMIT 1
      `,
      [cleanIdentifier, cleanIdentifier]
    );

    if (!users.length) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials"
      });
    }

    const user = users[0];

    const isPasswordValid = await bcrypt.compare(
      cleanPassword,
      user.password_hash
    );

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials"
      });
    }

    const token = generateToken(user);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          is_god: user.is_god
        },
        token
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;