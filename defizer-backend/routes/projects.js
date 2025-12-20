// routes/projects.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/authenticate');

// GET /api/projects - List all projects for the user
router.get('/api/projects', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, created_at FROM projects WHERE user_id=? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ projects: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// POST /api/projects - Create a new project
router.post('/api/projects', authenticate, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name required' });
  try {
    await pool.query(
      'INSERT INTO projects (user_id, name) VALUES (?, ?)',
      [req.user.id, name.trim()]
    );
    // Return updated project list
    const [rows] = await pool.query(
      'SELECT id, name, created_at FROM projects WHERE user_id=? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ projects: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// PATCH /api/projects/:id - Rename a project
router.patch('/api/projects/:id', authenticate, async (req, res) => {
  const { name } = req.body;
  const projectId = req.params.id;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name required' });
  try {
    // Only allow user to rename their own project
    await pool.query(
      'UPDATE projects SET name=? WHERE id=? AND user_id=?',
      [name.trim(), projectId, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename project' });
  }
});

// DELETE /api/projects/:id - Delete a project and its conversations/messages
router.delete('/api/projects/:id', authenticate, async (req, res) => {
  const projectId = req.params.id;
  try {
    // Find all conversations for this project
    const [convos] = await pool.query(
      'SELECT id FROM conversations WHERE project_id=? AND user_id=?',
      [projectId, req.user.id]
    );
    const convIds = convos.map(row => row.id);

    // Delete all messages for these conversations
    if (convIds.length) {
      await pool.query(
        `DELETE FROM messages WHERE conversation_id IN (${convIds.map(() => '?').join(',')})`,
        convIds
      );
      await pool.query(
        `DELETE FROM conversations WHERE id IN (${convIds.map(() => '?').join(',')})`,
        convIds
      );
    }

    // Finally, delete the project
    await pool.query(
      'DELETE FROM projects WHERE id=? AND user_id=?',
      [projectId, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

module.exports = router;
