const mysql = require('mysql2/promise');
const path = require("path"); // 👈 ADD THIS LINE FIRST
require('dotenv').config({ path: path.join(__dirname, '.', '.env') });


const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 60000, // 60s for Hostinger
  charset: 'utf8mb4',
  // Add these options for better connection stability
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // 10s
  maxIdle: 10, // max idle connections (default: same as connectionLimit)
  idleTimeout: 60000, // 60s idle timeout
  acquireTimeout: 60000 // 60s acquire timeout
});

// Test the connection on startup
pool.getConnection()
  .then(connection => {
    console.log('✓ Database connection successful');
    connection.release();
  })
  .catch(err => {
    console.error('✗ Database connection failed:', err.message);
    console.error('  Check your .env file and ensure MySQL is running');
  });

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    console.error('Database connection was lost. Will attempt to reconnect on next query.');
  }
});

module.exports = { pool };