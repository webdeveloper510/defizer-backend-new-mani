// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');

const app = express();

// --- CORS + Core Middleware ---
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

console.log('Serving uploads from:', path.join(__dirname, 'uploads'));

// --- Serve ALL uploads (for file downloads, exports, etc) ---
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  setHeaders: function (res, filePath) {
    res.setHeader('Content-Disposition', 'attachment');
  }
}));

// --- Serve profile photos specifically (for direct <img> browser access) ---
app.use('/uploads/profile_photos', express.static(path.join(__dirname, 'uploads', 'profile_photos')));

// --- Serve Frontend Files ---
const frontendPath = path.join(__dirname, './Front-end');
console.log('Serving frontend from:', frontendPath);
app.use(express.static(frontendPath));

// --- Root Route ---
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// --- Modular Routers ---
app.use(require('./routes/auth'));              // Signup, login, profile, profile PATCH
app.use(require('./routes/chat'));              // AI LifeCode chat
app.use(require('./routes/conversations'));     // Chat threads & messages
//app.use(require('./routes/files'));             // File uploads & analysis
app.use(require('./routes/outcomes'));          // For outcome/ROI reporting
app.use(require('./routes/suggest'));           // AI prompt suggestion endpoint
app.use(require('./routes/projects'));          // Project CRUD
app.use(require('./routes/share'));

app.use('/api/live/weather', require('./routes/liveWeather'));


// --- Profile photo upload route ---
app.use('/api/profile-photo', require('./routes/profilePhoto')); // Must come after auth route

// --- Catch-all 404 handler (for any unmatched route) ---
app.use((req, res, next) => {
  res.status(404).json({ error: "Not found" });
});

// --- Global error handler ---
app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// --- Socket.IO Setup ---
const server = http.createServer(app);
const io = socketio(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});
app.set('io', io); // Attach io to app for route access

io.on('connection', (socket) => {
  const { sessionId, userId } = socket.handshake.query;
  if (sessionId) socket.join('sess-' + sessionId);
  if (userId) socket.join('user-' + userId);
});

// --- Start Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('API running on port', PORT));
