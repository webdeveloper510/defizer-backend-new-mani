const mysql = require('mysql2/promise');
require('dotenv').config();

async function testRobustConnection() {
  console.log('🔍 Testing robust database connection...');
  console.log('Host:', process.env.DB_HOST);
  console.log('User:', process.env.DB_USER);
  console.log('Database:', process.env.DB_NAME);
  console.log('Port:', process.env.DB_PORT || 3306);
  
  // Test with extended timeout and connection options
  const connectionOptions = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    connectTimeout: 30000, // 30 seconds
    acquireTimeout: 30000, // 30 seconds
    timeout: 30000, // 30 seconds
    // Additional options for remote connections
    ssl: false, // Try without SSL first
    multipleStatements: false,
    // Connection pool options
    waitForConnections: true,
    connectionLimit: 1,
    queueLimit: 0,
    // Keep alive settings
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  };
  
  try {
    console.log('\n⏳ Attempting connection with 30s timeout...');
    
    const connection = await mysql.createConnection(connectionOptions);
    console.log('✅ Connection successful!');
    
    // Test a simple query
    console.log('⏳ Testing query...');
    const [rows] = await connection.query('SELECT 1 + 1 AS result, NOW() as current_time');
    console.log('✅ Query test successful:', rows);
    
    await connection.end();
    console.log('✅ Connection closed successfully');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Connection failed:');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    
    if (error.code === 'ETIMEDOUT') {
      console.error('\n🔧 Troubleshooting ETIMEDOUT:');
      console.error('1. Check if your IP is whitelisted on the remote server');
      console.error('2. Try connecting from your live server to verify credentials');
      console.error('3. Check if the remote server allows external connections');
      console.error('4. Try using a VPN if your ISP blocks MySQL connections');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('\n🔧 Invalid credentials - check username/password');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n🔧 Cannot resolve hostname');
    }
    
    return false;
  }
}

testRobustConnection();

