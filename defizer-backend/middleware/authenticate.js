// middleware/authenticate.js
const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  //console.log('AUTH HEADER:', req.headers['authorization']);
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No auth header' });
  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
