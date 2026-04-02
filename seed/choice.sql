-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Apr 02, 2026 at 07:00 PM
-- Server version: 10.4.28-MariaDB
-- PHP Version: 8.2.4

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `choice`
--

-- --------------------------------------------------------

--
-- Table structure for table `players`
--

CREATE TABLE `players` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` int(10) UNSIGNED NOT NULL,
  `life_number` int(11) NOT NULL DEFAULT 1,
  `previous_player_id` int(10) UNSIGNED DEFAULT NULL,
  `character_name` varchar(100) NOT NULL,
  `race_id` int(10) UNSIGNED NOT NULL,
  `race_subtype_id` int(10) UNSIGNED NOT NULL,
  `level` int(11) NOT NULL DEFAULT 1,
  `year_survived` int(11) NOT NULL DEFAULT 0,
  `day_survived` int(11) NOT NULL DEFAULT 0,
  `current_hour` int(11) NOT NULL DEFAULT 6,
  `age_days` int(11) NOT NULL DEFAULT 0,
  `hp` int(11) NOT NULL DEFAULT 100,
  `max_hp` int(11) NOT NULL DEFAULT 100,
  `energy` int(11) NOT NULL DEFAULT 50,
  `max_energy` int(11) NOT NULL DEFAULT 50,
  `hunger` int(11) NOT NULL DEFAULT 0,
  `attack_stat` int(11) NOT NULL DEFAULT 10,
  `defense_stat` int(11) NOT NULL DEFAULT 10,
  `speed_stat` int(11) NOT NULL DEFAULT 10,
  `intelligence_stat` int(11) NOT NULL DEFAULT 10,
  `evolution_stage` int(11) NOT NULL DEFAULT 1,
  `title` varchar(100) DEFAULT 'Nameless Being',
  `alignment_type` varchar(50) DEFAULT 'neutral',
  `current_zone_id` int(10) UNSIGNED DEFAULT NULL,
  `has_started_scene` tinyint(1) NOT NULL DEFAULT 0,
  `is_alive` tinyint(1) NOT NULL DEFAULT 1,
  `death_reason` varchar(255) DEFAULT NULL,
  `died_at` timestamp NULL DEFAULT NULL,
  `reincarnated_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `players`
--

INSERT INTO `players` (`id`, `user_id`, `life_number`, `previous_player_id`, `character_name`, `race_id`, `race_subtype_id`, `level`, `year_survived`, `day_survived`, `current_hour`, `age_days`, `hp`, `max_hp`, `energy`, `max_energy`, `hunger`, `attack_stat`, `defense_stat`, `speed_stat`, `intelligence_stat`, `evolution_stage`, `title`, `alignment_type`, `current_zone_id`, `has_started_scene`, `is_alive`, `death_reason`, `died_at`, `reincarnated_at`, `created_at`, `updated_at`) VALUES
(1, 1, 1, NULL, 'LightPotato', 3, 7, 1, 0, 1, 2, 1, 120, 120, 13, 45, 25, 15, 10, 16, 7, 1, 'Nameless Being', 'neutral', 1, 1, 1, NULL, NULL, NULL, '2026-04-01 21:58:11', '2026-04-02 16:26:22');

-- --------------------------------------------------------

--
-- Table structure for table `player_action_logs`
--

CREATE TABLE `player_action_logs` (
  `id` int(10) UNSIGNED NOT NULL,
  `player_id` int(10) UNSIGNED NOT NULL,
  `action_key` varchar(50) NOT NULL,
  `count` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `player_current_scene`
--

CREATE TABLE `player_current_scene` (
  `id` int(10) UNSIGNED NOT NULL,
  `player_id` int(10) UNSIGNED NOT NULL,
  `zone_id` int(10) UNSIGNED NOT NULL,
  `scene_title` varchar(150) NOT NULL,
  `scene_text` text NOT NULL,
  `environment_tag` varchar(80) DEFAULT NULL,
  `danger_level` varchar(20) NOT NULL DEFAULT 'low',
  `option_1` varchar(150) NOT NULL,
  `option_1_key` varchar(50) NOT NULL,
  `option_2` varchar(150) NOT NULL,
  `option_2_key` varchar(50) NOT NULL,
  `option_3` varchar(150) NOT NULL,
  `option_3_key` varchar(50) NOT NULL,
  `option_4` varchar(150) NOT NULL,
  `option_4_key` varchar(50) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `player_current_scene`
--

INSERT INTO `player_current_scene` (`id`, `player_id`, `zone_id`, `scene_title`, `scene_text`, `environment_tag`, `danger_level`, `option_1`, `option_1_key`, `option_2`, `option_2_key`, `option_3`, `option_3_key`, `option_4`, `option_4_key`, `created_at`, `updated_at`) VALUES
(4, 1, 1, 'Awakening in Whispering Grasslands', 'LightPotato awaken as a shadow wolf in Whispering Grasslands. The world feels unfamiliar, dangerous, and alive. Your instincts are raw, your body is weak, and every choice from here will shape survival.', 'frontier', '1', 'Scan the darkness', 'observe', 'Blend into the shadows', 'move', 'Creep through the undergrowth', 'hide', 'Attack from the hidden', 'rest', '2026-04-02 16:26:22', '2026-04-02 16:26:22');

-- --------------------------------------------------------

--
-- Table structure for table `player_scene_ai_cache`
--

CREATE TABLE `player_scene_ai_cache` (
  `id` int(10) UNSIGNED NOT NULL,
  `player_id` int(10) UNSIGNED NOT NULL,
  `player_scene_id` int(10) UNSIGNED NOT NULL,
  `source_scene_updated_at` timestamp NULL DEFAULT NULL,
  `raw_scene_title` varchar(255) DEFAULT NULL,
  `raw_scene_text` text DEFAULT NULL,
  `raw_actions_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`raw_actions_json`)),
  `ai_scene_title` varchar(255) DEFAULT NULL,
  `ai_scene_text` text DEFAULT NULL,
  `ai_actions_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`ai_actions_json`)),
  `ai_event_summary` text DEFAULT NULL,
  `narration_applied` tinyint(1) NOT NULL DEFAULT 0,
  `choice_text_applied` tinyint(1) NOT NULL DEFAULT 0,
  `narration_model` varchar(255) DEFAULT NULL,
  `choice_model` varchar(255) DEFAULT NULL,
  `narration_error` text DEFAULT NULL,
  `choice_error` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `player_scene_ai_cache`
--

INSERT INTO `player_scene_ai_cache` (`id`, `player_id`, `player_scene_id`, `source_scene_updated_at`, `raw_scene_title`, `raw_scene_text`, `raw_actions_json`, `ai_scene_title`, `ai_scene_text`, `ai_actions_json`, `ai_event_summary`, `narration_applied`, `choice_text_applied`, `narration_model`, `choice_model`, `narration_error`, `choice_error`, `created_at`, `updated_at`) VALUES
(2, 1, 4, '2026-04-02 16:26:22', 'Awakening in Whispering Grasslands', 'LightPotato awaken as a shadow wolf in Whispering Grasslands. The world feels unfamiliar, dangerous, and alive. Your instincts are raw, your body is weak, and every choice from here will shape survival.', '[{\"slot\":1,\"key\":\"observe\",\"text\":\"Observe your surroundings\"},{\"slot\":2,\"key\":\"move\",\"text\":\"Move carefully\"},{\"slot\":3,\"key\":\"hide\",\"text\":\"Hide and listen\"},{\"slot\":4,\"key\":\"rest\",\"text\":\"Rest and recover\"}]', 'Awakening in Whispering Grasslands', 'LightPotato awaken as a shadow wolf in Whispering Grasslands. The world feels unfamiliar, dangerous, and alive. Your instincts are raw, your body is weak, and every choice from here will shape survival.', '[{\"slot\":1,\"key\":\"observe\",\"text\":\"Scan the darkness\"},{\"slot\":2,\"key\":\"move\",\"text\":\"Blend into the shadows\"},{\"slot\":3,\"key\":\"hide\",\"text\":\"Creep through the undergrowth\"},{\"slot\":4,\"key\":\"rest\",\"text\":\"Attack from the hidden\"}]', NULL, 0, 1, NULL, 'mistralai/Mistral-7B-Instruct-v0.2:featherless-ai', 'AI narration failed', NULL, '2026-04-02 16:26:22', '2026-04-02 16:26:22');

-- --------------------------------------------------------

--
-- Table structure for table `player_skills`
--

CREATE TABLE `player_skills` (
  `id` int(10) UNSIGNED NOT NULL,
  `player_id` int(10) UNSIGNED NOT NULL,
  `skill_id` int(10) UNSIGNED NOT NULL,
  `skill_level` int(11) NOT NULL DEFAULT 1,
  `is_unlocked` tinyint(1) NOT NULL DEFAULT 0,
  `unlock_reason` varchar(255) DEFAULT NULL,
  `current_cooldown` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `player_skills`
--

INSERT INTO `player_skills` (`id`, `player_id`, `skill_id`, `skill_level`, `is_unlocked`, `unlock_reason`, `current_cooldown`, `created_at`, `updated_at`) VALUES
(1, 1, 1, 1, 0, 'Use attack 5 times', 0, '2026-04-02 05:47:20', '2026-04-02 16:26:08'),
(2, 1, 2, 1, 0, 'Use hide 5 times', 0, '2026-04-02 05:47:20', '2026-04-02 16:26:08'),
(3, 1, 3, 1, 0, 'Survive 3 days', 0, '2026-04-02 05:47:20', '2026-04-02 16:26:08'),
(4, 1, 4, 1, 0, 'Use move 5 times', 0, '2026-04-02 05:47:20', '2026-04-02 16:26:08');

-- --------------------------------------------------------

--
-- Table structure for table `player_traits`
--

CREATE TABLE `player_traits` (
  `id` int(10) UNSIGNED NOT NULL,
  `player_id` int(10) UNSIGNED NOT NULL,
  `aggressive` int(11) NOT NULL DEFAULT 0,
  `intelligence` int(11) NOT NULL DEFAULT 0,
  `stealth` int(11) NOT NULL DEFAULT 0,
  `survival` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `player_traits`
--

INSERT INTO `player_traits` (`id`, `player_id`, `aggressive`, `intelligence`, `stealth`, `survival`, `created_at`, `updated_at`) VALUES
(1, 1, 0, 0, 0, 1, '2026-04-02 05:13:24', '2026-04-02 05:14:30');

-- --------------------------------------------------------

--
-- Table structure for table `races`
--

CREATE TABLE `races` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `races`
--

INSERT INTO `races` (`id`, `name`, `description`, `is_active`, `created_at`, `updated_at`) VALUES
(1, 'human', 'Balanced mortal beings with adaptability and survival instinct.', 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(2, 'elf', 'Graceful mystical beings with speed and spiritual awareness.', 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(3, 'beast', 'Ferocious primal creatures built for instinct and force.', 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(4, 'spirit', 'Ethereal lifeforms with energy affinity and ancient presence.', 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(5, 'anomaly', 'Unnatural corrupted existences born from broken laws of reality.', 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(6, 'dragon', 'Ancient scaled beings of destruction.', 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55');

-- --------------------------------------------------------

--
-- Table structure for table `race_subtypes`
--

CREATE TABLE `race_subtypes` (
  `id` int(10) UNSIGNED NOT NULL,
  `race_id` int(10) UNSIGNED NOT NULL,
  `name` varchar(80) NOT NULL,
  `description` text DEFAULT NULL,
  `base_hp` int(11) NOT NULL DEFAULT 100,
  `base_energy` int(11) NOT NULL DEFAULT 50,
  `base_attack` int(11) NOT NULL DEFAULT 10,
  `base_defense` int(11) NOT NULL DEFAULT 10,
  `base_speed` int(11) NOT NULL DEFAULT 10,
  `base_intelligence` int(11) NOT NULL DEFAULT 10,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `race_subtypes`
--

INSERT INTO `race_subtypes` (`id`, `race_id`, `name`, `description`, `base_hp`, `base_energy`, `base_attack`, `base_defense`, `base_speed`, `base_intelligence`, `is_active`, `created_at`, `updated_at`) VALUES
(1, 1, 'knight', 'A disciplined frontline human fighter.', 130, 40, 14, 15, 8, 9, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(2, 1, 'wanderer', 'A balanced traveler shaped by hardship.', 110, 50, 11, 10, 11, 10, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(3, 1, 'sorcerer', 'A gifted human who channels raw arcane force.', 90, 80, 9, 8, 10, 16, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(4, 2, 'ranger', 'An agile elf hunter with precision and speed.', 100, 60, 12, 9, 15, 12, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(5, 2, 'moonblade', 'A swift elf warrior under lunar blessing.', 105, 65, 13, 10, 14, 12, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(6, 2, 'mystic', 'An elf deeply tied to ancient magical knowledge.', 85, 90, 8, 8, 12, 18, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(7, 3, 'shadow wolf', 'A beast subtype driven by speed and feral instinct.', 120, 45, 15, 10, 16, 7, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(8, 3, 'horned fang', 'A brutal beast subtype with crushing force.', 140, 35, 17, 13, 9, 6, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(9, 4, 'soul guide', 'A calm spirit subtype with insight and energy flow.', 95, 95, 9, 9, 11, 17, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(10, 4, 'flame wisp', 'A volatile spirit subtype burning with agile energy.', 80, 100, 11, 7, 15, 14, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(11, 5, 'shadow', 'A strange anomaly born from darkness and distortion.', 100, 70, 13, 9, 13, 12, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(12, 5, 'void shard', 'A fractured anomaly infused with void energy.', 90, 110, 10, 8, 10, 19, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(13, 5, 'cursed echo', 'A broken anomaly that carries memory and ruin.', 105, 85, 12, 11, 11, 15, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(14, 6, 'fire dragon', 'A newborn dragon with burning scales and a fierce core.', 130, 90, 18, 11, 12, 10, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(15, 6, 'ice dragon', 'A baby dragon born from frost and silence.', 135, 95, 14, 15, 9, 12, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55'),
(16, 6, 'storm dragon', 'A young dragon charged with thunder and wind.', 125, 105, 16, 10, 17, 11, 1, '2026-04-01 20:55:55', '2026-04-01 20:55:55');

-- --------------------------------------------------------

--
-- Table structure for table `skills`
--

CREATE TABLE `skills` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(120) NOT NULL,
  `skill_key` varchar(120) NOT NULL,
  `description` text DEFAULT NULL,
  `skill_type` enum('attack','defense','recovery','movement','utility','passive') NOT NULL DEFAULT 'utility',
  `target_type` enum('self','enemy','area','none') NOT NULL DEFAULT 'none',
  `race_id` int(10) UNSIGNED DEFAULT NULL,
  `race_subtype_id` int(10) UNSIGNED DEFAULT NULL,
  `unlock_level` int(11) NOT NULL DEFAULT 1,
  `energy_cost` int(11) NOT NULL DEFAULT 0,
  `cooldown_turns` int(11) NOT NULL DEFAULT 0,
  `base_power` int(11) NOT NULL DEFAULT 0,
  `scaling_stat` enum('attack_stat','defense_stat','speed_stat','intelligence_stat','none') NOT NULL DEFAULT 'none',
  `effect_kind` enum('damage','heal','buff','debuff','escape','stealth','vision','none') NOT NULL DEFAULT 'none',
  `effect_value` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `unlock_type` enum('level','action_count','stat_threshold','survival','zone','none') DEFAULT 'none',
  `unlock_value` int(11) DEFAULT NULL,
  `unlock_action_key` varchar(50) DEFAULT NULL,
  `unlock_zone_tag` varchar(50) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `skills`
--

INSERT INTO `skills` (`id`, `name`, `skill_key`, `description`, `skill_type`, `target_type`, `race_id`, `race_subtype_id`, `unlock_level`, `energy_cost`, `cooldown_turns`, `base_power`, `scaling_stat`, `effect_kind`, `effect_value`, `is_active`, `created_at`, `updated_at`, `unlock_type`, `unlock_value`, `unlock_action_key`, `unlock_zone_tag`) VALUES
(1, 'Shadow Fang', 'shadow_fang', 'Strike from shadows', 'attack', 'enemy', 3, 7, 1, 6, 0, 14, 'speed_stat', 'damage', 14, 1, '2026-04-02 06:47:00', '2026-04-02 06:47:00', 'action_count', 5, 'attack', NULL),
(2, 'Night Prowl', 'night_prowl', 'Move unseen', 'utility', 'self', 3, 7, 1, 4, 0, 0, 'speed_stat', 'stealth', 10, 1, '2026-04-02 06:47:00', '2026-04-02 06:47:00', 'action_count', 5, 'hide', NULL),
(3, 'Lunar Howl', 'lunar_howl', 'Empower yourself', 'utility', 'area', 3, 7, 1, 5, 0, 0, 'attack_stat', 'buff', 10, 1, '2026-04-02 06:47:00', '2026-04-02 06:47:00', 'survival', 3, NULL, NULL),
(4, 'Shadow Escape', 'shadow_escape', 'Instant reposition', 'movement', 'self', 3, 7, 1, 5, 0, 0, 'speed_stat', 'escape', 8, 1, '2026-04-02 06:47:00', '2026-04-02 06:47:00', 'action_count', 5, 'move', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` int(10) UNSIGNED NOT NULL,
  `username` varchar(50) NOT NULL,
  `email` varchar(120) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `is_god` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `username`, `email`, `password_hash`, `is_god`, `created_at`, `updated_at`) VALUES
(1, 'light', '8amlight@gmail.com', '$2b$10$fmzcksi.HB042ZaBbhGyIeVaJAIs4xTnDPEyxk4SQ3UeWwXFpnPGS', 0, '2026-04-01 21:58:11', '2026-04-01 21:58:11');

-- --------------------------------------------------------

--
-- Table structure for table `zones`
--

CREATE TABLE `zones` (
  `id` int(10) UNSIGNED NOT NULL,
  `name` varchar(120) NOT NULL,
  `zone_type` varchar(80) NOT NULL,
  `difficulty_level` varchar(30) NOT NULL DEFAULT 'low',
  `environment_tag` varchar(80) NOT NULL,
  `description` text DEFAULT NULL,
  `is_safe_zone` tinyint(1) NOT NULL DEFAULT 0,
  `parent_zone_id` int(10) UNSIGNED DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `zones`
--

INSERT INTO `zones` (`id`, `name`, `zone_type`, `difficulty_level`, `environment_tag`, `description`, `is_safe_zone`, `parent_zone_id`, `is_active`, `created_at`, `updated_at`) VALUES
(1, 'Whispering Grasslands', 'plains', 'low', 'frontier', 'A wide open stretch of moving grass, small prey trails, and nervous silence.', 1, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(2, 'Emberpeak Ridge', 'mountain', 'medium', 'mountain', 'Jagged volcanic stone, high wind, and narrow ledges.', 0, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(3, 'Moonveil Forest', 'forest', 'medium', 'forest', 'Dense roots, dim light, and hidden movement under the leaves.', 0, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(4, 'Blackroot Hollow', 'dark_forest', 'high', 'dark_forest', 'A cursed woodland where sound dies too quickly.', 0, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(5, 'Ruins of Vael Turoth', 'ruins', 'medium', 'ruins', 'Broken stone halls carrying old magic and forgotten stories.', 0, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(6, 'Aether Drift', 'spirit_field', 'medium', 'ethereal', 'The veil between matter and essence feels painfully thin here.', 0, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(7, 'Shattered Scar', 'corruption', 'high', 'corruption', 'The land bends in impossible angles and reality flickers.', 0, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(8, 'Hunter\'s Shelter', 'safe_camp', 'low', 'wild', 'A rough but stable place where survivors briefly regroup.', 1, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(9, 'Frostfang Pass', 'mountain', 'high', 'mountain', 'Snowbitten cliffs where one wrong step means death.', 0, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(10, 'Sunken Mire', 'swamp', 'medium', 'wild', 'Thick mud, trapped bones, and a smell of decay.', 0, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(11, 'Ashen Threshold', 'wasteland', 'high', 'frontier', 'A dead place where even the wind sounds tired.', 0, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(12, 'Silvermist Crossing', 'riverlands', 'low', 'forest', 'Clear water, reeds, and the tracks of both prey and predators.', 1, NULL, 1, '2026-04-02 05:45:26', '2026-04-02 05:45:26'),
(16, 'South Grass Trail', 'plains_path', 'low', 'frontier', 'A calmer path through the southern edge of the grasslands.', 1, 1, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(17, 'Tall Grass Hollow', 'plains_depth', 'medium', 'wild', 'A deeper stretch of moving grass where small predators stay hidden.', 0, 1, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(18, 'Ashfall Ledge', 'mountain_path', 'medium', 'mountain', 'A narrow path dusted with ash and unstable rock.', 0, 2, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(19, 'Cracked Furnace Slope', 'mountain_depth', 'high', 'mountain', 'Heat rises from below the stone as if the ridge itself is breathing.', 0, 2, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(20, 'Whisperleaf Edge', 'forest_path', 'low', 'forest', 'The lighter outer edge of Moonveil Forest where the trees first begin to close in.', 1, 3, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(21, 'Old Root Path', 'forest_path', 'medium', 'forest', 'Ancient roots twist across the ground and make every step uncertain.', 0, 3, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(22, 'Hunter\'s Clearing', 'forest_clearing', 'medium', 'wild', 'A quiet clearing marked by claw lines, footprints, and old camp remains.', 0, 3, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(23, 'Black Pond', 'dark_forest_depth', 'high', 'dark_forest', 'Still black water reflects shapes that do not seem fully real.', 0, 4, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(24, 'Hollow Spine Trail', 'dark_forest_path', 'high', 'dark_forest', 'A broken trail between bent trees and roots shaped like bones.', 0, 4, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(25, 'Fallen Archive', 'ruins_chamber', 'medium', 'ruins', 'Collapsed shelves and shattered tablets lie beneath drifting dust.', 0, 5, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(26, 'Echo Hall', 'ruins_corridor', 'medium', 'ruins', 'Every step echoes twice, as if something unseen answers from deeper inside.', 0, 5, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(27, 'Pale Current', 'spirit_stream', 'medium', 'ethereal', 'Soft currents of spiritual force push against your body from all sides.', 0, 6, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(28, 'Veil Crossing', 'spirit_crossing', 'high', 'ethereal', 'The boundary between worlds trembles here with dangerous pressure.', 0, 6, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(29, 'Broken Edge', 'corruption_path', 'high', 'corruption', 'Stone, shadow, and distance all feel wrong here.', 0, 7, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(30, 'Twisted Core', 'corruption_depth', 'high', 'corruption', 'The deeper heart of the Scar pulses with warped presence.', 0, 7, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(31, 'Supply Corner', 'camp_section', 'low', 'wild', 'A small area of salvaged tools, rope, and hidden supplies.', 1, 8, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(32, 'Watch Post', 'camp_section', 'low', 'wild', 'A lookout position built from wood, bone, and instinct.', 1, 8, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(33, 'Iceclaw Bend', 'mountain_path', 'high', 'mountain', 'A frozen bend where the wind cuts harder than steel.', 0, 9, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(34, 'White Drop Ledge', 'mountain_depth', 'high', 'mountain', 'A steep ledge where snow hides cracks and falling death.', 0, 9, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(35, 'Rotwater Bank', 'swamp_path', 'medium', 'wild', 'A slick bank where old bones rest half-buried in the mud.', 0, 10, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(36, 'Leech Hollow', 'swamp_depth', 'high', 'wild', 'Dark stagnant water hides parasites and slower death.', 0, 10, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(37, 'Dustwalk Reach', 'wasteland_path', 'medium', 'frontier', 'A long open stretch of drifting ash and weak footing.', 0, 11, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(38, 'Burnt Flats', 'wasteland_depth', 'high', 'frontier', 'The deeper flats radiate heat from long-dead fire.', 0, 11, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(39, 'Reedshade Bank', 'river_path', 'low', 'forest', 'Soft ground, moving reeds, and a clear line of sight along the water.', 1, 12, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50'),
(40, 'Glasswater Bend', 'river_depth', 'medium', 'forest', 'A deeper bend in the water where tracks stop too suddenly.', 0, 12, 1, '2026-04-02 05:50:50', '2026-04-02 05:50:50');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `players`
--
ALTER TABLE `players`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_players_race_id` (`race_id`),
  ADD KEY `idx_players_race_subtype_id` (`race_subtype_id`),
  ADD KEY `idx_players_user_id` (`user_id`);

--
-- Indexes for table `player_action_logs`
--
ALTER TABLE `player_action_logs`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_player_action_log` (`player_id`,`action_key`),
  ADD KEY `idx_player_action_logs_player_id` (`player_id`),
  ADD KEY `idx_player_action_logs_action_key` (`action_key`);

--
-- Indexes for table `player_current_scene`
--
ALTER TABLE `player_current_scene`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_player_current_scene` (`player_id`),
  ADD KEY `idx_player_current_scene_zone_id` (`zone_id`);

--
-- Indexes for table `player_scene_ai_cache`
--
ALTER TABLE `player_scene_ai_cache`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_player_scene_ai_cache_scene` (`player_scene_id`),
  ADD KEY `idx_player_scene_ai_cache_player` (`player_id`);

--
-- Indexes for table `player_skills`
--
ALTER TABLE `player_skills`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_player_skill` (`player_id`,`skill_id`),
  ADD KEY `idx_player_skills_player_id` (`player_id`),
  ADD KEY `idx_player_skills_skill_id` (`skill_id`);

--
-- Indexes for table `player_traits`
--
ALTER TABLE `player_traits`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_player_traits_player_id` (`player_id`),
  ADD KEY `idx_player_traits_player_id` (`player_id`);

--
-- Indexes for table `races`
--
ALTER TABLE `races`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_race_name` (`name`);

--
-- Indexes for table `race_subtypes`
--
ALTER TABLE `race_subtypes`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_race_subtypes_race_id` (`race_id`);

--
-- Indexes for table `skills`
--
ALTER TABLE `skills`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_username` (`username`),
  ADD UNIQUE KEY `unique_email` (`email`);

--
-- Indexes for table `zones`
--
ALTER TABLE `zones`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `players`
--
ALTER TABLE `players`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `player_action_logs`
--
ALTER TABLE `player_action_logs`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `player_current_scene`
--
ALTER TABLE `player_current_scene`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `player_scene_ai_cache`
--
ALTER TABLE `player_scene_ai_cache`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `player_skills`
--
ALTER TABLE `player_skills`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=113;

--
-- AUTO_INCREMENT for table `player_traits`
--
ALTER TABLE `player_traits`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=26;

--
-- AUTO_INCREMENT for table `races`
--
ALTER TABLE `races`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `race_subtypes`
--
ALTER TABLE `race_subtypes`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=17;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `zones`
--
ALTER TABLE `zones`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=41;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `players`
--
ALTER TABLE `players`
  ADD CONSTRAINT `fk_players_race` FOREIGN KEY (`race_id`) REFERENCES `races` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_players_race_subtype` FOREIGN KEY (`race_subtype_id`) REFERENCES `race_subtypes` (`id`) ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_players_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `player_action_logs`
--
ALTER TABLE `player_action_logs`
  ADD CONSTRAINT `fk_player_action_logs_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `player_current_scene`
--
ALTER TABLE `player_current_scene`
  ADD CONSTRAINT `fk_player_current_scene_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_player_current_scene_zone` FOREIGN KEY (`zone_id`) REFERENCES `zones` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `player_scene_ai_cache`
--
ALTER TABLE `player_scene_ai_cache`
  ADD CONSTRAINT `fk_player_scene_ai_cache_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_player_scene_ai_cache_scene` FOREIGN KEY (`player_scene_id`) REFERENCES `player_current_scene` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `player_skills`
--
ALTER TABLE `player_skills`
  ADD CONSTRAINT `fk_player_skills_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_player_skills_skill` FOREIGN KEY (`skill_id`) REFERENCES `skills` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `player_traits`
--
ALTER TABLE `player_traits`
  ADD CONSTRAINT `fk_player_traits_player` FOREIGN KEY (`player_id`) REFERENCES `players` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `race_subtypes`
--
ALTER TABLE `race_subtypes`
  ADD CONSTRAINT `fk_race_subtypes_race` FOREIGN KEY (`race_id`) REFERENCES `races` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
