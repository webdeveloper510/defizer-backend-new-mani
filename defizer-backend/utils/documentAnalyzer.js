// utils/documentAnalyzer.js - FIXED VERSION

const mammoth = require('mammoth');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;

/**
 * Extract text for AI to understand
 */
async function extractTextForAnalysis(filePath, format) {
  try {
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
          text += `\n=== Sheet: ${sheet} ===\n`;
          text += data.map(row => row.join(' | ')).join('\n') + '\n';
        });
        return text;
      
      case 'pdf':
        const buffer = await fs.readFile(filePath);
        const pdf = await pdfParse(buffer);
        return pdf.text;
      
      case 'txt':
      case 'md':
      case 'markdown':
        return await fs.readFile(filePath, 'utf-8');
      
      default:
        return await fs.readFile(filePath, 'utf-8');
    }
  } catch (error) {
    console.error('[TEXT EXTRACTION ERROR]', error);
    throw new Error(`Failed to extract text: ${error.message}`);
  }
}

/**
 * AI analyzes document and gives FORMAT-AWARE modification instructions
 */
async function getModificationInstructions(documentText, userRequest, OPENAI_API_KEY) {
  const prompt = `You are a document modification expert. Analyze the document and user request, then provide EXACT find-and-replace instructions.

DOCUMENT CONTENT:
"""
${documentText.slice(0, 12000)}
"""

USER REQUEST: "${userRequest}"

CRITICAL RULES:
1. Find the EXACT text that needs to be changed (must match document PERFECTLY)
2. Provide the COMPLETE replacement text with proper formatting
3. For bullet points: Use "• " (bullet character + space) for each item
4. For numbered lists: Use "1. ", "2. ", etc.
5. Be SPECIFIC - quote exact phrases from the document
6. Include surrounding context if needed to make the match unique
7. Each "find" string must appear EXACTLY ONCE in the document

FORMAT-SPECIFIC GUIDANCE:
- DOCX/DOC: Support bullets (•), numbering, bold markers (**text**)
- XLSX/XLS: Modify cell contents, preserve table structure
- TXT/MD: Use Markdown formatting (**, *, bullets)
- PDF: Text replacement only (no formatting changes)

Return ONLY valid JSON with this structure:
{
  "changes": [
    {
      "find": "exact text from document (can be multiple lines)",
      "replace": "complete replacement text (properly formatted)",
      "reason": "brief explanation of this change"
    }
  ],
  "explanation": "overall summary of modifications"
}

EXAMPLES:

Example 1 - Convert to bullets:
User: "Make the features list use bullet points"
Document has:
"Key Features:
1. Fast processing
2. Secure storage
3. Easy integration"

Return:
{
  "changes": [{
    "find": "Key Features:\n1. Fast processing\n2. Secure storage\n3. Easy integration",
    "replace": "Key Features:\n• Fast processing\n• Secure storage\n• Easy integration",
    "reason": "Convert numbered list to bullet points"
  }],
  "explanation": "Converted features list from numbered to bullet format"
}

Example 2 - Replace specific text:
User: "Change 'contact us' to 'get in touch'"
Document has: "For more information, contact us at info@example.com"
Return:
{
  "changes": [{
    "find": "For more information, contact us at info@example.com",
    "replace": "For more information, get in touch at info@example.com",
    "reason": "Updated contact phrasing"
  }],
  "explanation": "Changed contact wording as requested"
}

Example 3 - Add content:
User: "Add a disclaimer at the end"
Document ends with: "...all rights reserved."
Return:
{
  "changes": [{
    "find": "all rights reserved.",
    "replace": "all rights reserved.\n\nDisclaimer: This information is provided as-is without warranty.",
    "reason": "Added disclaimer at end"
  }],
  "explanation": "Appended disclaimer to document end"
}

Example 4 - Excel cell modification:
User: "Change the price in row 2 to $199"
Document has: "Product | Price\nWidget | $149"
Return:
{
  "changes": [{
    "find": "$149",
    "replace": "$199",
    "reason": "Updated widget price"
  }],
  "explanation": "Updated price for Widget"
}

IMPORTANT:
- Return ONLY valid JSON (no markdown code blocks, no extra text)
- Each "find" string must be UNIQUE in the document
- Include enough context to avoid ambiguous matches
- If you can't find the exact text, explain why in "explanation"

Now analyze the document and provide modification instructions.`;

  try {
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
            content: 'You are a precise document analyzer. Return ONLY valid JSON with exact find-replace instructions. No markdown formatting, no extra commentary.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1, // Lower temperature for more precise matching
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    console.log('[AI RESPONSE]', content.slice(0, 500));
    
    // Clean up markdown code blocks if present
    let cleaned = content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    // Parse JSON
    const parsed = JSON.parse(cleaned);
    
    // Validate structure
    if (!parsed.changes || !Array.isArray(parsed.changes)) {
      throw new Error('Invalid response structure: missing changes array');
    }
    
    // Validate each change
    for (const change of parsed.changes) {
      if (!change.find || !change.replace) {
        throw new Error('Invalid change: missing find or replace field');
      }
    }
    
    console.log('[ANALYZER] ✓ Parsed', parsed.changes.length, 'changes');
    return parsed;
    
  } catch (error) {
    console.error('[ANALYZER ERROR]', error);
    
    // Return structured error
    return {
      changes: [],
      explanation: `Analysis failed: ${error.message}`,
      error: error.message
    };
  }
}

/**
 * Validate that find text exists in document
 */
function validateChanges(documentText, changes) {
  const validated = [];
  const errors = [];
  
  for (const change of changes) {
    const findText = change.find.trim();
    
    if (documentText.includes(findText)) {
      validated.push(change);
    } else {
      // Try fuzzy matching (normalize whitespace)
      const normalizedDoc = documentText.replace(/\s+/g, ' ');
      const normalizedFind = findText.replace(/\s+/g, ' ');
      
      if (normalizedDoc.includes(normalizedFind)) {
        validated.push({
          ...change,
          find: findText // Keep original
        });
      } else {
        errors.push({
          change,
          error: 'Find text not found in document'
        });
      }
    }
  }
  
  return { validated, errors };
}

module.exports = {
  extractTextForAnalysis,
  getModificationInstructions,
  validateChanges
};