const express = require("express");
const router = express.Router();
const { generateWithHuggingFace } = require("../functions/ai/huggingFaceClient");
const { SYSTEM_PROMPT } = require("../functions/ai/prompts/systemPrompt");

router.get("/test", async (req, res) => {
  try {
    const result = await generateWithHuggingFace({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt:
        "Generate the first awakening scene of a newly reincarnated weak creature in a dangerous world.",
      jsonMode: true,
      maxTokens: 220,
      temperature: 0.6
    });

    if (!result.success) {
      return res.status(500).json(result);
    }

    return res.json({
      success: true,
      model: result.model,
      parsed: !!result.parsed,
      data: result.parsed || result.rawText
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;