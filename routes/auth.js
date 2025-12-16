// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { authenticate } = require('../middleware/authenticate');

function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name },
    process.env.JWT_SECRET, { expiresIn: '7d' }
  );
}

// --- SIGNUP ---
router.post('/api/signup', async (req, res) => {
  const { email, password, first_name, last_name } = req.body;
  if (!email || !password || !first_name || !last_name)
    return res.status(400).json({ error: 'First name, last name, email, and password are required' });

  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
    if (rows.length) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO users (email, password_hash, first_name, last_name) VALUES (?, ?, ?, ?)',
      [email, hash, first_name, last_name]
    );

    const [userRows] = await pool.query('SELECT * FROM users WHERE email=?', [email]);
    const user = userRows[0];
    const token = createToken(user);

    res.json({
      message: 'Signup successful', token, user: {
        id: user.id, email: user.email, first_name: user.first_name,
        last_name: user.last_name, role: user.role, queries_used: user.queries_used
      }
    });
  } catch (err) {
    console.error('Signup error:', err);
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        error: 'Database connection failed. Please try again later.',
        hint: 'Check if your IP is whitelisted in Hostinger Remote MySQL settings'
      });
    }
    res.status(500).json({ error: 'Signup failed' });
  }
});

// --- LOGIN ---
router.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email=?', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = createToken(user);
    res.json({
      message: 'Login successful', token, user: {
        id: user.id, email: user.email, first_name: user.first_name,
        last_name: user.last_name, role: user.role, queries_used: user.queries_used
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      return res.status(503).json({ 
        error: 'Database connection failed. Please try again later.',
        hint: 'Check if your IP is whitelisted in Hostinger Remote MySQL settings'
      });
    }
    res.status(500).json({ error: 'Login failed' });
  }
});

// --- PROFILE: GET ---
router.get('/api/profile', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, email, first_name, last_name, role, queries_used, profile_photo AS profile_photo_url FROM users WHERE id=?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Profile fetch failed' });
  }
});

// --- PROFILE: PATCH (update name) ---
router.patch('/api/profile', authenticate, async (req, res) => {
  const { first_name, last_name } = req.body;
  if (!first_name || !last_name)
    return res.status(400).json({ error: 'First name and last name are required' });
  try {
    await pool.query(
      'UPDATE users SET first_name=?, last_name=? WHERE id=?',
      [first_name, last_name, req.user.id]
    );
    res.json({ success: true, first_name, last_name });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Profile update failed' });
  }
});

module.exports = router;
