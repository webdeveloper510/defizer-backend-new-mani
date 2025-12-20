const mysql = require('mysql2/promise');
const path = require("path"); // 👈 ADD THIS LINE FIRST
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function test() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: 3306,
      connectTimeout: 10000
    });
    const [rows] = await connection.query('SELECT 1+1 AS test');
    console.log('Connection SUCCESS!', rows);
    await connection.end();
  } catch (err) {
    console.error('Connection ERROR:', err);
  }
}
test();
