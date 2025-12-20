// routes/liveWeather.js
const express = require('express');
const router = express.Router();
const { getWeather } = require('../utils/weather');

router.get('/', async (req, res) => {
  const { city, lat, lon } = req.query;
  if (!city && (!lat || !lon)) return res.status(400).json({ error: 'City or coordinates required' });
  try {
    const weather = await getWeather({ city, lat, lon });
    res.json(weather);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to fetch weather.' });
  }
});

module.exports = router;
