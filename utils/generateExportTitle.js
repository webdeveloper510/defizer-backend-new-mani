// utils/generateExportTitle.js
const path = require("path"); // 👈 ADD THIS LINE FIRST
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Accepts both message history and exportContent!
async function generateExportTitle(messages, exportContent) {
  // Only use up to last 10 exchanges for context
  const limitedMessages = messages && messages.length ? messages.slice(-10) : [];

  // Prefer content, fallback to chat history
  let contentBlock = exportContent
    ? exportContent.slice(0, 800)
    : (limitedMessages.map(m => m.message).join('\n').slice(0, 800) || '');

  const prompt = [
    {
      role: "system",
      content: `You are an AI assistant that generates short, professional, human-friendly export file titles for documents and conversations. 
Given the content below, return a suitable Title Case file name (max 7 words, NO file extensions, no quotes, NO mention of PDF/Word/Export/Download). Respond with TITLE ONLY, no intro text.`
    },
    {
      role: "user",
      content: `Content:\n${contentBlock}`
    }
  ];

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: prompt,
      max_tokens: 16,
      temperature: 0.2,
    });
    let rawTitle = res.choices?.[0]?.message?.content?.replace(/[^a-zA-Z0-9\-\s']/g, '').trim() || "Defizer Report";
    // Capitalize title case (optional)
    let title = rawTitle.replace(/\s{2,}/g, ' ').replace(/[. ]+$/, '');
    if (!title || title.length < 3) title = "Defizer Report";
    return title;
  } catch (e) {
    console.error("[ExportTitle] OpenAI error:", e?.message || e);
    return "Defizer Report";
  }
}

module.exports = { generateExportTitle };
