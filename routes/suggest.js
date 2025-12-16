// routes/suggest.js

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

router.post('/api/suggest-prompt', async (req, res) => {
  console.log('[SUGGEST DEBUG] Incoming body:', req.body);
  const { prompt } = req.body;
  const todayUS = new Date().toLocaleDateString('en-US');
  const dateSystemMsg = `Today's date is: ${todayUS}. Always use this as the current date for any 'now' or 'today' question. Never mention your knowledge cutoff or guess the date.`;

  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'No prompt provided.' });

  try {
    const system = `${dateSystemMsg}
    You are an expert prompt engineer. Rewrite the following user prompt to be more clear, specific, and actionable. Be sure to not go beyond what the user's write. Never add dates like 'as of October 2023' or any reference to a specific time, unless the user's original prompt specifically included a date.
    
    `;

    const user = `User prompt: "${prompt}"`;

    const params = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      max_completion_tokens: 200,
      temperature: 0.3
    };
    // console.log('[SUGGEST DEBUG] About to call OpenAI with:', params);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });

    const data = await response.json();
    // console.log('[SUGGEST DEBUG] OpenAI raw response:', data);

    const improved = data.choices?.[0]?.message?.content?.trim() || '';
    if (!improved) throw new Error("No suggestion generated.");
    res.json({ suggestion: improved });
  } catch (err) {
    console.error("[SuggestPrompt]", err);
    res.status(500).json({ error: "Failed to generate suggestion." });
  }
});

module.exports = router;
