// routes/outcomes.js
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticate } = require('../middleware/authenticate');

// File load debug log
console.log('Defizer outcomes.js loaded at', new Date());

// Report outcome/ROI for a LifeCode
router.post('/api/report-outcome', authenticate, async (req, res) => {
  // Log everything about every incoming POST
  console.log('==== NEW REPORT-OUTCOME REQUEST ====');
  console.log('req.body:', req.body);
  console.log('req.headers:', req.headers);
  console.log('req.method:', req.method);
  console.log('req.url:', req.url);

  const { conversation_id, life_code_id, reported_result, roi_value } = req.body;
  const user_id = req.user.id;

  // Validation: Strong check for life_code_id
  if (
    !life_code_id ||
    life_code_id === '' ||
    life_code_id === 'null' ||
    life_code_id === null ||
    typeof life_code_id === 'undefined'
  ) {
    console.log('Blocked request: missing or empty life_code_id!');
    return res.status(400).json({ error: "Missing or empty life_code_id (required)" });
  }

  try {
    await pool.query(
      'INSERT INTO life_code_results (user_id, conversation_id, life_code_id, reported_result, roi_value) VALUES (?, ?, ?, ?, ?)',
      [user_id, conversation_id, life_code_id, reported_result, roi_value]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save outcome.' });
  }
});

// (Optional) Get all ROI results for this user
router.get('/api/my-roi', authenticate, async (req, res) => {
  const user_id = req.user.id;
  try {
    const [rows] = await pool.query(
      'SELECT * FROM life_code_results WHERE user_id = ? ORDER BY submitted_at DESC',
      [user_id]
    );
    res.json({ results: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch results.' });
  }
});

module.exports = router;
