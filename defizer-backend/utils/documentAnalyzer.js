// utils/documentAnalyzer.js - FIXED VERSION with better text matching

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
// In documentAnalyzer.js, update the getModificationInstructions function:

async function getModificationInstructions(documentText, userRequest, OPENAI_API_KEY) {
  const prompt = `You are a document modification expert. Analyze the document and user request, then provide EXACT find-and-replace instructions.

DOCUMENT CONTENT:
"""
${documentText.slice(0, 12000)}
"""

USER REQUEST: "${userRequest}"

CRITICAL RULES FOR TEXT MATCHING:
1. Read the document text EXACTLY as it appears above
2. Find ALL variations and occurrences of the text to replace
3. Consider case variations, spacing, and punctuation
4. For "replace X with Y" requests, provide changes that cover common variations

MODIFICATION STRATEGY:
1. First find EXACT matches of the requested text
2. Then consider case variations (uppercase, lowercase, title case)
3. Consider variations with punctuation (with period, with comma, etc.)
4. Consider possessive forms if applicable
5. Consider plural forms if applicable

SCOPE DECISION GUIDELINES:
- GLOBAL SCOPE: When user says "replace all" or doesn't specify location
- LOCAL SCOPE: When user specifies "in paragraph 2", "first line", "section 3"

IMPORTANT: Match the EXACT text from the document, not what you think it should be.

Return ONLY valid JSON with this structure:
{
  "changes": [
    {
      "find": "exact text from document",
      "replace": "complete replacement text",
      "reason": "brief explanation",
      "scope": "global" or "local"
    }
  ],
  "explanation": "overall summary of modifications",
  "scope_analysis": "why you chose global vs local"
}

EXAMPLES:

Example 1 - Simple text replacement:
User: "Replace apple with orange"
Document shows: "I have an apple. The apple is red. APPLES are tasty."
Return:
{
  "changes": [
    {
      "find": "apple",
      "replace": "orange",
      "reason": "Replace lowercase 'apple'",
      "scope": "global"
    },
    {
      "find": "APPLE",
      "replace": "ORANGE",
      "reason": "Replace uppercase 'APPLE'",
      "scope": "global"
    },
    {
      "find": "APPLES",
      "replace": "ORANGES",
      "scope": "global"
    }
  ],
  "explanation": "Replaced 'apple' with 'orange' throughout document including case variations",
  "scope_analysis": "Global scope as user didn't specify location"
}

Example 2 - With context:
User: "Change revenue to income in the financial section"
Document shows: "Financial Report\nRevenue: $100\nOur revenue grew..."
Return:
{
  "changes": [
    {
      "find": "Revenue",
      "replace": "Income",
      "reason": "Change in financial section header",
      "scope": "local"
    },
    {
      "find": "revenue",
      "replace": "income",
      "reason": "Change in financial section text",
      "scope": "local"
    }
  ],
  "explanation": "Changed 'revenue' to 'income' in financial section",
  "scope_analysis": "Local scope as user specified 'in the financial section'"
}

Example 3 - Phrase replacement:
User: "Replace 'high growth' with 'rapid expansion'"
Document shows: "We expect high growth. HIGH GROWTH markets..."
Return:
{
  "changes": [
    {
      "find": "high growth",
      "replace": "rapid expansion",
      "reason": "Replace phrase",
      "scope": "global"
    },
    {
      "find": "HIGH GROWTH",
      "replace": "RAPID EXPANSION",
      "reason": "Replace uppercase phrase",
      "scope": "global"
    }
  ],
  "explanation": "Replaced 'high growth' with 'rapid expansion'",
  "scope_analysis": "Global scope as phrase appears throughout"
}

Now analyze the user request "${userRequest}" and the document content. Provide ONLY the JSON response.`;

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
            content: 'You are a text modification assistant. Analyze the document and user request. Provide JSON with find-replace instructions for ALL variations of the text (case, punctuation, etc.). Be thorough.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1, 
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
   if (
  typeof change.find !== 'string' ||
  change.find.trim() === '' ||
  typeof change.replace !== 'string'
) {
        throw new Error('Invalid change: missing find or replace field');
      }
    }
    
    console.log('[ANALYZER] ✓ Parsed', parsed.changes.length, 'changes');
    return parsed;
    
  } catch (error) {
    console.error('[ANALYZER ERROR]', error);
    
    return {
      changes: [],
      explanation: `Analysis failed: ${error.message}`,
      error: error.message
    };
  }
}
/**
 * Validate that find text exists in document - WITH FLEXIBLE MATCHING
 */
function validateChanges(documentText, changes) {
  const validated = [];
  const errors = [];
  
  // DEBUG: Log document structure
  console.log('[VALIDATE DEBUG] Document sample (first 500 chars):');
  console.log(documentText.slice(0, 500));
  console.log('[VALIDATE DEBUG] Document contains bullet "•"?', documentText.includes('•'));
  console.log('[VALIDATE DEBUG] Document contains newlines?', documentText.includes('\n'));
  
  for (const change of changes) {
    let findText = change.find.trim();
    
    console.log('[VALIDATE] Looking for:', {
      text: findText.slice(0, 100),
      hasLiteralBackslashN: findText.includes('\\n'),
      hasActualNewline: findText.includes('\n'),
      length: findText.length
    })
    if (findText.includes('\\n')) {
      console.log('[VALIDATE] Converting literal \\n to actual newlines');
      findText = findText.replace(/\\n/g, '\n');
    }
    
    if (documentText.includes(findText)) {
      validated.push({ ...change, find: findText });
      console.log('[VALIDATE] ✓ Exact match found');
      continue;
    }
    
    const normalizedDoc = documentText.replace(/\s+/g, ' ').trim();
    const normalizedFind = findText.replace(/\s+/g, ' ').trim();
    
    console.log('[VALIDATE] Trying normalized match:', normalizedFind.slice(0, 100));
    
    if (normalizedDoc.includes(normalizedFind)) {
      const startIdx = normalizedDoc.indexOf(normalizedFind);
      validated.push({
        ...change,
        find: normalizedFind,
        _matchType: 'normalized'
      });
      console.log('[VALIDATE] ✓ Normalized match found');
      continue;
    }
    const fuzzyDoc = normalizedDoc.replace(/[•\-\*]\s*/g, '');
    const fuzzyFind = normalizedFind.replace(/[•\-\*]\s*/g, '');
    
    console.log('[VALIDATE] Trying fuzzy match:', fuzzyFind.slice(0, 100));
    
    if (fuzzyDoc.includes(fuzzyFind)) {
      validated.push({
        ...change,
        find: fuzzyFind,
        _matchType: 'fuzzy'
      });
      console.log('[VALIDATE] ✓ Fuzzy match found');
      continue;
    }
    
    const firstLine = findText.split(/[\n\r]+/)[0].trim();
    const normalizedFirstLine = firstLine.replace(/\s+/g, ' ').replace(/[•\-\*]\s*/g, '').trim();
    
    console.log('[VALIDATE] Trying first-line match:', normalizedFirstLine.slice(0, 80));
    
    if (normalizedDoc.includes(normalizedFirstLine)) {
      console.log('[VALIDATE] ⚠️ Found partial match (first line only), this may not work fully');
      validated.push({
        ...change,
        find: normalizedFirstLine,
        _matchType: 'partial'
      });
      continue;
    }
    
    // Match failed - log extensive debugging info
    console.error('[VALIDATE] ✗ No match found. Debug info:');
    console.error('  Find text (first 150 chars):', findText.slice(0, 150));
    console.error('  Normalized find:', normalizedFind.slice(0, 150));
    console.error('  Fuzzy find:', fuzzyFind.slice(0, 150));
    console.error('  Document sample around expected position:');
    
    // Try to find similar text in document
    const words = normalizedFind.split(' ').slice(0, 5).join(' ');
    const similarIdx = normalizedDoc.indexOf(words);
    if (similarIdx !== -1) {
      console.error('  Found similar text at position', similarIdx, ':', 
        normalizedDoc.slice(Math.max(0, similarIdx - 50), similarIdx + 200));
    } else {
      console.error('  No similar text found in document');
      console.error('  Document start:', normalizedDoc.slice(0, 200));
    }
    
    errors.push({
      change,
      error: 'Find text not found in document',
      attempted: {
        exact: findText.slice(0, 50),
        normalized: normalizedFind.slice(0, 50),
        fuzzy: fuzzyFind.slice(0, 50)
      }
    });
  }
  
  console.log(`[VALIDATE] Result: ${validated.length} validated, ${errors.length} errors`);
  return { validated, errors };
}

module.exports = {
  extractTextForAnalysis,
  getModificationInstructions,
  validateChanges
};