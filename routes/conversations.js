// routes/conversations.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/authenticate');

/**
 * GET /api/conversations
 * List all conversations for the authenticated user (optionally filtered by project)
 * Query: ?project_id=...
 */
router.get('/api/conversations', authenticate, async (req, res) => {
  try {
    let sql = 'SELECT session_id, title, project_id, created_at FROM conversations WHERE user_id=?';
    const params = [req.user.id];

    if (req.query.project_id) {
      sql += ' AND project_id=?';
      params.push(req.query.project_id);
    }
    sql += ' ORDER BY created_at DESC';

    const [rows] = await pool.query(sql, params);
    res.json({ conversations: rows });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

/**
 * POST /api/conversations
 * Create a new conversation (with first message) in a project
 * Body: { project_id, message }
 */
router.post('/api/conversations', authenticate, async (req, res) => {
  const { project_id, message } = req.body;
  const user_id = req.user.id;
  if (!project_id || !message || !message.trim()) {
    return res.status(400).json({ error: 'Project and message are required' });
  }
  try {
    // Generate a new session_id (UUID)
    const session_id = require('crypto').randomUUID();
    // Insert new conversation
    const [convRes] = await pool.query(
      'INSERT INTO conversations (user_id, project_id, session_id, title, status) VALUES (?, ?, ?, ?, ?)',
      [user_id, project_id, session_id, message.substring(0, 64), 'active']
    );
    const conversationId = convRes.insertId;
    // Insert first message
    await pool.query(
      'INSERT INTO messages (conversation_id, sender, message) VALUES (?, ?, ?)',
      [conversationId, 'user', message]
    );
    // Return conversation info
    const [rows] = await pool.query(
      'SELECT session_id, title, project_id, created_at FROM conversations WHERE id=?',
      [conversationId]
    );
    res.json({ conversation: rows[0] });
  } catch (e) {
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

/**
 * DELETE /api/conversation/:session_id
 * Delete a conversation and all its messages
 */
router.delete('/api/conversation/:session_id', authenticate, async (req, res) => {
  try {
    const [conv] = await pool.query(
      'SELECT id FROM conversations WHERE session_id=? AND user_id=?',
      [req.params.session_id, req.user.id]
    );
    if (!conv.length) return res.status(404).json({ error: 'Not found' });

    const conversationId = conv[0].id;
    await pool.query('DELETE FROM messages WHERE conversation_id=?', [conversationId]);
    await pool.query('DELETE FROM conversations WHERE id=?', [conversationId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Could not delete conversation' });
  }
});

/**
 * GET /api/messages?session_id=...
 * Get all messages for a conversation (by session_id)
 */
router.get('/api/messages', authenticate, async (req, res) => {
  const session_id = req.query.session_id;
  if (!session_id) return res.status(400).json({ error: "Missing session_id" });
  try {
    const [conv] = await pool.query(
      'SELECT id FROM conversations WHERE session_id = ? AND user_id = ?',
      [session_id, req.user.id]
    );
    if (!conv.length) return res.json({ messages: [] });

    const conversation_id = conv[0].id;
    const [messages] = await pool.query(
      'SELECT sender, message, timestamp FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
      [conversation_id]
    );
    res.json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

/**
 * PATCH /api/conversation/:session_id/title
 * Rename the conversation
 */
router.patch('/api/conversation/:session_id/title', authenticate, async (req, res) => {
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Title required" });
  try {
    const [conv] = await pool.query(
      'SELECT id FROM conversations WHERE session_id=? AND user_id=?',
      [req.params.session_id, req.user.id]
    );
    if (!conv.length) return res.status(404).json({ error: 'Not found' });

    await pool.query('UPDATE conversations SET title=? WHERE id=?', [title.trim(), conv[0].id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update title' });
  }
});

module.exports = router;
