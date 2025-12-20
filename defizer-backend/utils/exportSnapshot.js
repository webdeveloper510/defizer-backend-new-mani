// utils/exportSnapshot.js
const { pool } = require('../db');
const { cleanExportContent } = require('../fileGenerators');

// Aggregates messages for export (Markdown)
async function getChatExportContent(conversationId) {
  const [rows] = await pool.query(
    "SELECT sender, message FROM messages WHERE conversation_id=? ORDER BY timestamp ASC",
    [conversationId]
  );
  let content = '';
  rows.forEach(msg => {
    if (msg.sender === 'user') {
      content += `**User:** ${msg.message}\n\n`;
    } else {
      content += `**Defizer:** ${msg.message}\n\n`;
    }
  });
  return content;
}

// Returns snapshot (creates if missing)
async function getOrCreateExportSnapshot(conversationId) {
  const [[conv]] = await pool.query(
    "SELECT export_snapshot FROM conversations WHERE id=?",
    [conversationId]
  );
  if (conv && conv.export_snapshot) {
    console.log(`[SNAPSHOT] Returning frozen snapshot for conversation ${conversationId}`);
    return conv.export_snapshot;
  }
  // If no snapshot, build and save
  const content = await getChatExportContent(conversationId);
  const cleaned = cleanExportContent(content);
  console.log(`[SNAPSHOT] Creating new snapshot for conversation ${conversationId}`);
  await pool.query(
    "UPDATE conversations SET export_snapshot=? WHERE id=?",
    [cleaned, conversationId]
  );
  return cleaned;
}

// Always call after chat changes
async function clearExportSnapshot(conversationId) {
  await pool.query(
    "UPDATE conversations SET export_snapshot=NULL WHERE id=?",
    [conversationId]
  );
}

module.exports = {
  getOrCreateExportSnapshot,
  clearExportSnapshot,
};
