const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
  console.log('Testing database connection...');
  console.log('Host:', process.env.DB_HOST);
  console.log('User:', process.env.DB_USER);
  console.log('Database:', process.env.DB_NAME);
  console.log('Port:', process.env.DB_PORT || 3306);
  
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: process.env.DB_PORT || 3306,
      connectTimeout: 10000
    });
    
    console.log('\n✓ Connection successful!');
    
    const [rows] = await connection.query('SELECT 1 + 1 AS result');
    console.log('✓ Query test successful:', rows);
    
    await connection.end();
    console.log('✓ Connection closed successfully');
    
  } catch (error) {
    console.error('\n✗ Connection failed:');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.error('\n→ MySQL server is not running or not accessible');
      console.error('→ Check if MySQL service is started');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('\n→ Invalid username or password');
      console.error('→ Check your .env credentials');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n→ Cannot resolve database host');
      console.error('→ Check DB_HOST in .env');
    } else if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
      console.error('\n→ Connection timeout or reset');
      console.error('→ Check firewall, network, or if remote DB is accessible');
    }
  }
}

testConnection();

