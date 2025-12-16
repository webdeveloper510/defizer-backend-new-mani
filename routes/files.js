// routes/files.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const mammoth = require('mammoth');
const { pool } = require('../db');
const { authenticate } = require('../middleware/authenticate');

// --- Multer Setup ---
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, unique + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage });

// --- Helper: Save File Message ---
async function getOrCreateConversation(session_id, user_id) {
  let [rows] = await pool.query('SELECT id FROM conversations WHERE session_id = ? AND user_id = ?', [session_id, user_id]);
  if (rows.length) return rows[0].id;
  const [result] = await pool.query(
    'INSERT INTO conversations (session_id, user_id) VALUES (?, ?)', [session_id, user_id]
  );
  return result.insertId;
}

async function saveMessage(session_id, user_id, sender, message, io = null) {
  const conversation_id = await getOrCreateConversation(session_id, user_id);
  await pool.query(
    'INSERT INTO messages (conversation_id, sender, message) VALUES (?, ?, ?)',
    [conversation_id, sender, message]
  );
  if (io) io.to('sess-' + session_id).emit('new_message', { sender, message });
}

// --- /upload endpoint ---
router.post('/upload', authenticate, upload.single('file'), async (req, res) => {
  const { id } = req.user;
  const { sessionId } = req.body;
  const sessId = sessionId || req.body.session_id;

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let extractedText = '';
  try {
    if (req.file.mimetype === 'application/pdf') {
      // PDF Extraction
      const dataBuffer = fs.readFileSync(req.file.path);
      const data = await pdfParse(dataBuffer);
      extractedText = data.text;
    } else if (req.file.mimetype.startsWith('image/')) {
      // OCR for Images
      const imageBuffer = fs.readFileSync(req.file.path);
      const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
      extractedText = text;
    } else if (req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // DOCX/Word support
      const { value } = await mammoth.extractRawText({ path: req.file.path });
      extractedText = value;
    } else if (req.file.mimetype === 'text/plain') {
      // TXT support
      extractedText = fs.readFileSync(req.file.path, 'utf8');
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    // Save file upload as message
    await saveMessage(sessId, id, 'user', `[User uploaded a file: ${req.file.originalname}]`, req.app.get('io'));

    // Fetch last 15 messages for memory
    const [convRows] = await pool.query(
      'SELECT id FROM conversations WHERE session_id = ? AND user_id = ?',
      [sessId, id]
    );
    const conversation_id = convRows.length ? convRows[0].id : null;
    let messageHistory = [];
    if (conversation_id) {
      const [msgs] = await pool.query(
        'SELECT sender, message FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 15',
        [conversation_id]
      );
      messageHistory = msgs.reverse();
    }

    // Send to GPT-5 for analysis
    let gptMessages = [
      {
        role: "system",
        content: `
You are Defizer, the Miracle Engine for real-world breakthroughs. When a user shares a challenge, ambition, or goal, act as a world-class strategist—analyzing their unique context and delivering a response (“LifeCode”) that is powerfully actionable, deeply insightful, and always tailored for maximum impact.

Note: Defizer and Beilis Module is already combined. If user asked about please use Beilis or Defizer Module, always response that it is already default and combined.

### Instructions:

1. **Think creatively and strategically:** Every answer should feel like it was designed by a top-tier expert, specifically for this user.

2. **Surface hidden insights and anticipate needs:** Address not just what’s asked, but what’s truly at stake—context, risks, new opportunities.

3. **Deliver “meaty” value:** Go beyond generic advice. Provide practical actions, frameworks, or next steps with real-world relevance and context.

4. **Adapt your format for maximum clarity and effect:** Use whatever style (step-by-step, checklist, table, narrative, story, strategy, action plan, etc.) is most effective for the situation—never force a template.

5. **Tie actions to real-world wins:** Connect your recommendations to outcomes (ROI, time saved, growth, competitive edge, etc.), but don’t add unnecessary sections if they don’t add value.

6. **Always include something the user can do immediately.**

7. **Keep your tone bold, optimistic, and focused on transformation.**

8. **End each response with a statement that positions the user’s challenge as an opportunity for breakthrough.**

9. **Always conclude with a confident, direct offer to map out a fully executable, step-by-step blueprint tailored to the user's context. Present 3 to 5 clear options (e.g., Would you like me to lay out the full action sequence, break it into phased milestones, create a ready-to-use checklist, or combine them into a master plan?). Make sure the options are listed in numbers, and the last option is to asked if the user like'd a more advance option(e.g., would you like me to give more advanced response?). At the end say this choose a number in which you would want me to do.**


========================================================

*END OF SYSTEM PROMPT*

        `.trim()
      }
    ];
    for (const m of messageHistory) {
      gptMessages.push({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.message
      });
    }
    gptMessages.push({
      role: "user",
      content: `Summarize this file:\n[File Start]\n${extractedText}\n[File End]`
    });

    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-5",
        messages: gptMessages,
      })
    });

    const aiData = await aiResponse.json();
    let finalOutput = aiData.choices?.[0]?.message?.content || "No analysis result from AI.";

    // Save as bot message
    await saveMessage(sessId, id, 'bot', finalOutput, req.app.get('io'));

    res.json({ analysis: finalOutput });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'File analysis error' });
  }
});

module.exports = router;
