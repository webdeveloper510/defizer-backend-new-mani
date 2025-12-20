// routes/share.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/authenticate');
const crypto = require('crypto');

// Create share link
router.post('/api/share-thread', authenticate, async (req, res) => {
  const { session_id, is_public = true } = req.body;
  const user_id = req.user.id;
  if (!session_id) return res.status(400).json({ error: "session_id required" });

  try {
    // Get conversation
    const [convs] = await pool.query(
      'SELECT id, title FROM conversations WHERE session_id=? AND user_id=?',
      [session_id, user_id]
    );
    if (!convs.length) return res.status(404).json({ error: "Conversation not found" });

    const conversation_id = convs[0].id;
    let title = convs[0].title;
    
    // If no title, use first user message as title
    if (!title || !title.trim()) {
      const [msgs] = await pool.query(
        "SELECT message FROM messages WHERE conversation_id=? AND sender='user' ORDER BY id ASC LIMIT 1",
        [conversation_id]
      );
      title = msgs[0]?.message?.slice(0, 48) || "Untitled Chat";
    }
    
    const shareId = crypto.randomBytes(12).toString('hex'); // 24-char

    await pool.query(
      'INSERT INTO shared_threads (id, conversation_id, user_id, title, is_public) VALUES (?, ?, ?, ?, ?)',
      [shareId, conversation_id, user_id, title, is_public ? 1 : 0]
    );

    console.log('[SHARE THREAD] Created:', { shareId, is_public, title });
    res.json({ shareId, url: `/chat.html?share=${shareId}`, is_public });
  } catch (err) {
    console.error('[SHARE ERROR]', err);
    res.status(500).json({ error: "Failed to create share link.", details: err.message });
  }
});

// Fetch shared thread (public)
router.get('/api/shared-thread/:shareId', async (req, res) => {
  const { shareId } = req.params;
  console.log('[SHARE VIEW] Requesting shareId:', shareId);
  
  try {
    const [rows] = await pool.query(
      'SELECT conversation_id, title, created_at, is_public FROM shared_threads WHERE id=?',
      [shareId]
    );
    console.log('[SHARE VIEW] Found rows:', rows.length);
    
    if (!rows.length) {
      console.log('[SHARE VIEW] No rows found for shareId:', shareId);
      return res.status(404).json({ error: "Not found" });
    }
    
    if (rows[0].is_public === 0) {
      console.log('[SHARE VIEW] Share is private for shareId:', shareId);
      return res.status(403).json({ error: "This share is not public" });
    }

    const { conversation_id, title, created_at } = rows[0];
    console.log('[SHARE VIEW] Fetching messages for conversation_id:', conversation_id);
    
    const [messages] = await pool.query(
      'SELECT sender, message, timestamp FROM messages WHERE conversation_id=? ORDER BY timestamp ASC',
      [conversation_id]
    );
    console.log('[SHARE VIEW] Found messages:', messages.length);
    
    res.json({ title, created_at, messages });
  } catch (err) {
    console.error('[SHARE VIEW ERROR]', err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

module.exports = router;
