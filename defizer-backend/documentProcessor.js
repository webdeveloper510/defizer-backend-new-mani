// documentProcessor.js - ENHANCED WITH NATIVE FORMAT SUPPORT
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const XLSX = require('xlsx');
const { Document, Paragraph, TextRun, AlignmentType } = require('docx');
const fs = require('fs').promises;
const path = require('path');


async function detectModificationType(userMessage, OPENAI_API_KEY) {
  const prompt = `
You are a document modification classifier.
Given the following user request, determine the type of modification.

USER REQUEST:
"""${userMessage}"""

MODIFICATION TYPES:
1. section_modification – changing a specific section/paragraph
2. content_modification – changing general content
3. format_conversion – converting format (PDF, Excel, Word, etc.)
4. content_addition – adding new content
5. content_removal – removing content
6. structure_change – changing structure (lists, tables, bullets)
7. analyze – just analyze/summarize content
8. general_modification – fallback for other modifications

Respond with ONLY the type keyword.
`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0
    })
  });

  const data = await response.json();
  const type = data.choices?.[0]?.message?.content?.trim().toLowerCase() || 'general_modification';
  return type;
}


module.exports = {
  detectModificationType
};