// utils/documentAnalyzer.js - FULLY DYNAMIC VERSION

const mammoth = require('mammoth');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;

/**
 * Extract text for AI to understand
 */
async function extractTextForAnalysis(filePath, format) {
  switch(format.toLowerCase()) {
    case 'docx':
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    
    case 'xlsx':
    case 'xls':
      const workbook = XLSX.readFile(filePath);
      let text = '';
      workbook.SheetNames.forEach(sheet => {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1 });
        text += data.map(row => row.join(', ')).join('\n') + '\n';
      });
      return text;
    
    case 'pdf':
      const buffer = await fs.readFile(filePath);
      const pdf = await pdfParse(buffer);
      return pdf.text;
    
    default:
      return await fs.readFile(filePath, 'utf-8');
  }
}

/**
 * AI analyzes document and gives FLEXIBLE modification instructions
 * Works for ANY user request - no hardcoded assumptions!
 */
async function getModificationInstructions(documentText, userRequest, OPENAI_API_KEY) {
  const prompt = `You are a document modification expert.

DOCUMENT CONTENT:
"""
${documentText.slice(0, 10000)}
"""

USER REQUEST: "${userRequest}"

Your task: Understand what the user wants to change and provide SPECIFIC find-and-replace instructions.

RULES:
1. Find the EXACT text that needs to be changed
2. Provide the COMPLETE replacement text (fully formatted as user wants)
3. Be VERY SPECIFIC - quote exact words from document
4. If user wants bullet points, format the replacement with bullet points
5. If user wants to add/remove/modify anything, provide complete before/after text
6. Support ANY type of modification: bullets, numbering, tables, formatting, adding text, removing text, etc.

Return JSON with this simple structure:
{
  "changes": [
    {
      "find": "exact text from document (can be multiple lines)",
      "replace": "complete replacement text (formatted as user wants)"
    }
  ],
  "explanation": "brief summary of what you're changing"
}

EXAMPLES:

Example 1 - Convert to bullets:
User: "Make the key features section a bullet list"
Document has: "Key Features:\n1. Data Storage\n2. Data Retrieval"
Return: {
  "changes": [{
    "find": "Key Features:\n1. Data Storage\n2. Data Retrieval",
    "replace": "Key Features:\n• Data Storage\n• Data Retrieval"
  }]
}

Example 2 - Add text:
User: "Add 'Contact us at info@example.com' at the end"
Return: {
  "changes": [{
    "find": "[END_OF_DOCUMENT]",
    "replace": "\n\nContact us at info@example.com"
  }]
}

Example 3 - Make text bold (for plain text, use ** markers):
User: "Make the title bold"
Document has: "Introduction"
Return: {
  "changes": [{
    "find": "Introduction",
    "replace": "**Introduction**"
  }]
}

Return ONLY valid JSON, no markdown code blocks.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: 'You are a document analyzer. Understand ANY user modification request and provide exact find-replace instructions. Return only valid JSON.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim() || '{}';
  
  try {
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const parsed = JSON.parse(cleaned);
    return parsed;
  } catch (e) {
    console.error('[PARSE ERROR]', e);
    return { changes: [], explanation: 'Failed to parse instructions' };
  }
}

module.exports = {
  extractTextForAnalysis,
  getModificationInstructions
};