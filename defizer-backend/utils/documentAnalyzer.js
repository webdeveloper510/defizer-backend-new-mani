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

async function getModificationInstructions(documentText, userRequest, OPENAI_API_KEY) {
  const prompt = `You are an intelligent document modification assistant. Your job is to understand what the user wants and provide precise find-and-replace instructions.

DOCUMENT CONTENT:
"""
${documentText.slice(0, 12000)}
"""

USER'S REQUEST: "${userRequest}"

YOUR TASK:
1. Understand the user's intent (even if they have typos or are unclear)
2. Find the EXACT text in the document that needs to be changed
3. Provide precise find-and-replace instructions

CRITICAL RULES:
✓ Match text EXACTLY as it appears in the document (case-sensitive)
✓ If user has typos, interpret their real intent
✓ If user asks to "make X a list", convert content to proper list format
✓ If user asks to "add", "remove", "change", "update" - understand what they mean
✓ Look at the ACTUAL document content above, not what you think it should be
✓ Return changes that will actually work when applied to the document

OUTPUT FORMAT:
Return ONLY valid JSON (no markdown, no explanation outside JSON):
{
  "changes": [
    {
      "find": "exact text from document",
      "replace": "new text",
      "reason": "why this change",
      "scope": "global"
    }
  ],
  "explanation": "what you understood and what you're doing",
  "interpretation": "how you interpreted the user's request (mention any corrections you made)"
}

UNDERSTANDING USER INTENT:
- If unclear, make your best intelligent guess
- If user has typos, figure out what they meant
- If user says "list", convert to bullet format (• item)
- If user says "numbered list", use numbering (1. item)
- If user says "bold/italic", add appropriate formatting markers
- If user says "section", find that section and modify it
- If user says "add", insert new content appropriately
- If user says "remove/delete", replace with empty string

EXAMPLES OF INTELLIGENT INTERPRETATION:

User: "make key features a list"
→ Understand: Convert the Key Features section content into bullet list format

User: "change price to cost"
→ Understand: Replace the word "price" with "cost" (all variations)

User: "add Q5 data: revenue 5.0, expenses 3.0"
→ Understand: Insert a new row/line with Q5 data

User: "remove the conclusion paragraph"
→ Understand: Delete/replace the conclusion section with empty string

User: "make headings bold"
→ Understand: Add **heading** formatting around section titles

User: "fix the typo in line 3"
→ Understand: Need to identify and correct the typo in third line

User: "update revenue to 100k"
→ Understand: Find revenue value and change it to 100k

User: "make it more professional"
→ Understand: Improve tone/wording while keeping meaning

NOW ANALYZE:
The user said: "${userRequest}"
The document contains: (see above)

Think step by step:
1. What does the user want?
2. Where in the document should I make changes?
3. What exact text should I find?
4. What should I replace it with?

Provide the JSON response.`;

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
            content: `You are an expert at understanding user intent and providing precise document modifications. 

Key abilities:
- Interpret vague or typo-filled requests
- Match exact text from documents (case-sensitive)
- Convert between formats (paragraph → list, etc.)
- Handle any type of modification: replace, add, remove, reformat, restructure
- Return only valid JSON

Be intelligent and adaptive. The user might ask ANYTHING - your job is to figure out what they want and provide the right find-replace instructions.` 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3, 
        max_tokens: 3000
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

    console.log('[AI MODIFICATION ANALYSIS]');
    console.log('User request:', userRequest);
    console.log('AI response preview:', content.slice(0, 300));
        let cleaned = content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const parsed = JSON.parse(cleaned);
        if (!parsed.changes || !Array.isArray(parsed.changes)) {
      throw new Error('AI returned invalid structure: missing changes array');
    }
        console.log('[AI INTERPRETATION]', parsed.interpretation || parsed.explanation);
    console.log('[AI CHANGES]', parsed.changes.length, 'modifications planned');
    
    for (let i = 0; i < parsed.changes.length; i++) {
      const change = parsed.changes[i];
      
      if (!change.find || typeof change.find !== 'string' || change.find.trim() === '') {
        console.warn(`[VALIDATOR] Change ${i+1}: Missing or empty 'find' field, skipping`);
        continue;
      }
      
      if (typeof change.replace !== 'string') {
        console.warn(`[VALIDATOR] Change ${i+1}: Invalid 'replace' field, skipping`);
        continue;
      }
      
      console.log(`[VALIDATOR] Change ${i+1}: ✓ Valid`);
      console.log(`  Find: "${change.find.slice(0, 50)}${change.find.length > 50 ? '...' : ''}"`);
      console.log(`  Replace: "${change.replace.slice(0, 50)}${change.replace.length > 50 ? '...' : ''}"`);
      console.log(`  Reason: ${change.reason}`);
    }
    
    return parsed;
    
  } catch (error) {
    console.error('[AI MODIFICATION ERROR]', error);
        return {
      changes: [],
      explanation: `Could not understand the request: ${error.message}`,
      interpretation: `Failed to process: "${userRequest}"`,
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