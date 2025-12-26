
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;

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

async function getModificationInstructions(documentText, userRequest, OPENAI_API_KEY, messageHistory = []) {
  let conversationContext = "";
  if (messageHistory && messageHistory.length > 0) {
    conversationContext = "\n\nCONVERSATION HISTORY:\n";
    const recentMessages = messageHistory.slice(-10);
    
    recentMessages.forEach((msg, idx) => {
      const role = msg.sender === 'user' ? 'USER' : 'ASSISTANT';
      conversationContext += `${role}: ${msg.message}\n`;
    });
    
    conversationContext += `\nCURRENT USER REQUEST: "${userRequest}"\n`;
  }
    const prompt = `You are an intelligent document modification assistant that handles ANY type of modification request.

${conversationContext ? conversationContext : `USER REQUEST: "${userRequest}"`}

DOCUMENT CONTENT:
"""
${documentText.slice(0, 12000)}
"""

YOUR TASK:
Analyze the request and determine what type of modification is needed. You can handle:

1. **REPLACE** - Change existing text
   Examples: "change AWS to Azure", "update the date to 2024", "fix the typo"

2. **ADD** - Insert new content
   Examples: "add a conclusion", "insert a table with X data", "add bullet points for Y"

3. **DELETE** - Remove content
   Examples: "remove the intro", "delete section 3", "take out the last paragraph"

4. **FORMAT** - Change formatting or structure
   Examples: "make it a bullet list", "convert to table", "make this bold", "add headings"

5. **RESTRUCTURE** - Reorganize content
   Examples: "move section 2 before section 1", "combine these paragraphs"

6. **TRANSFORM** - Rewrite content
   Examples: "make it more formal", "summarize this", "expand on this point"

7. **EXTRACT** - Pull out specific information
   Examples: "extract all dates", "list all key points"

8. **COMPUTE** - Calculate or analyze data
   Examples: "add totals", "calculate the average", "count occurrences"

CRITICAL RULES FOR ALL TYPES:

✅ **For REPLACE operations:**
   - Match text EXACTLY as it appears in the document
   - Include proper whitespace, line breaks, bullets
   - Use the "changes" format with find/replace

✅ **For ADD operations:**
   - Specify WHERE to add (use "position" and "anchor")
   - Provide COMPLETE content to add
   - Match the document's formatting style

✅ **For DELETE operations:**
   - Identify content precisely
   - Can use exact text or section markers

✅ **For FORMAT operations:**
   - Specify source content and target format
   - Include formatting parameters (bullet style, heading level, etc.)

✅ **For TRANSFORM operations:**
   - Provide both original and transformed content
   - Explain the transformation

✅ **Use conversation history to resolve:**
   - Pronouns: "it", "this", "that", "these", "those"
   - Vague references: "the list", "the section", "the data"
   - Context-dependent requests: "now do X", "make it Y"

OUTPUT FORMAT - Always return valid JSON:

**For REPLACE (find/replace modifications):**
{
  "modificationType": "REPLACE",
  "changes": [
    {
      "find": "exact text from document",
      "replace": "new text",
      "reason": "explanation",
      "scope": "global|first"
    }
  ],
  "explanation": "what you understood"
}

**For ADD (adding new content):**
{
  "modificationType": "ADD",
  "operations": [
    {
      "type": "add",
      "position": "after|before|append|prepend",
      "anchor": "text near where to add (or START/END)",
      "content": "complete content to add",
      "formatting": {
        "type": "paragraph|bullet_list|numbered_list|table|heading",
        "style": "normal|bold|italic"
      },
      "reason": "explanation"
    }
  ],
  "explanation": "what will be added"
}

**For DELETE (removing content):**
{
  "modificationType": "DELETE",
  "operations": [
    {
      "type": "delete",
      "target": "exact text to delete",
      "mode": "exact|section|range",
      "startMarker": "text before (optional)",
      "endMarker": "text after (optional)",
      "reason": "explanation"
    }
  ],
  "explanation": "what will be deleted"
}

**For FORMAT (changing structure/format):**
{
  "modificationType": "FORMAT",
  "operations": [
    {
      "type": "format",
      "source": "content to format",
      "transformation": "to_bullet_list|to_numbered_list|to_table|to_heading|to_bold",
      "parameters": {
        "heading_level": 2,
        "list_style": "bullet",
        "table_headers": ["col1", "col2"]
      },
      "targetContent": "formatted version",
      "reason": "explanation"
    }
  ],
  "explanation": "formatting changes"
}

**For TRANSFORM (rewriting content):**
{
  "modificationType": "TRANSFORM",
  "operations": [
    {
      "type": "transform",
      "source": "original content",
      "target": "transformed content",
      "transformation": "summarize|expand|formalize|simplify",
      "reason": "explanation"
    }
  ],
  "explanation": "content transformation"
}

IMPORTANT NOTES:
- If request is ambiguous, use conversation history to clarify
- For REPLACE type, MUST use "changes" array (backward compatible)
- For other types, use "operations" array
- Always include "modificationType" field
- Match text EXACTLY from document (case-sensitive, with whitespace)

NOW ANALYZE THE REQUEST AND RESPOND WITH JSON:`;

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
            content: `You are a universal document modification expert. You handle ALL types of modifications: replace, add, delete, format, transform, etc. Always return valid JSON with the correct structure based on modification type.` 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 4000
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

    console.log('[AI ANALYSIS] Response preview:', content.slice(0, 300));
    
    let cleaned = content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
        const parsed = JSON.parse(cleaned);
        console.log('[MODIFICATION TYPE]', parsed.modificationType || 'REPLACE (default)');
        if (!parsed.modificationType) {
      parsed.modificationType = 'REPLACE';
    }
        if (parsed.modificationType === 'REPLACE') {
      if (!parsed.changes || !Array.isArray(parsed.changes)) {
        throw new Error('REPLACE type must have "changes" array');
      }
      console.log('[AI CHANGES]', parsed.changes.length, 'replacements planned');
    } else {
      if (!parsed.operations || !Array.isArray(parsed.operations)) {
        throw new Error(`${parsed.modificationType} type must have "operations" array`);
      }
      console.log('[AI OPERATIONS]', parsed.operations.length, 'operations planned');
    }
    
    console.log('[AI EXPLANATION]', parsed.explanation);
    
    return parsed;
    
  } catch (error) {
    console.error('[AI ANALYSIS ERROR]', error);
    
    return {
      modificationType: 'REPLACE',
      changes: [],
      explanation: `Could not process request: ${error.message}`,
      error: error.message
    };
  }
}
function validateChanges(documentText, changesOrOperations, modificationType = 'REPLACE') {
  console.log('[VALIDATE] Type:', modificationType);
  console.log('[VALIDATE] Document length:', documentText.length);
  console.log('[VALIDATE] Document sample:', documentText.slice(0, 200));
  
  const validated = [];
  const errors = [];
    if (modificationType === 'REPLACE' && Array.isArray(changesOrOperations)) {
    for (const change of changesOrOperations) {
      let findText = change.find?.trim();
      
      if (!findText) {
        errors.push({ change, error: 'Missing find text' });
        continue;
      }
      
      console.log('[VALIDATE] Looking for:', findText.slice(0, 100));
            if (findText.includes('\\n')) {
        findText = findText.replace(/\\n/g, '\n');
      }
            if (documentText.includes(findText)) {
        validated.push({ ...change, find: findText });
        console.log('[VALIDATE] ✓ Exact match found');
        continue;
      }
      
      const normalizedDoc = documentText.replace(/\s+/g, ' ').trim();
      const normalizedFind = findText.replace(/\s+/g, ' ').trim();
      
      if (normalizedDoc.includes(normalizedFind)) {
        validated.push({ ...change, find: normalizedFind, _matchType: 'normalized' });
        console.log('[VALIDATE] ✓ Normalized match found');
        continue;
      }
            const fuzzyDoc = normalizedDoc.replace(/[•\-\*]\s*/g, '');
      const fuzzyFind = normalizedFind.replace(/[•\-\*]\s*/g, '');
      
      if (fuzzyDoc.includes(fuzzyFind)) {
        validated.push({ ...change, find: fuzzyFind, _matchType: 'fuzzy' });
        console.log('[VALIDATE] ✓ Fuzzy match found');
        continue;
      }
            const firstLine = findText.split(/[\n\r]+/)[0].trim();
      if (normalizedDoc.includes(firstLine)) {
        validated.push({ ...change, find: firstLine, _matchType: 'partial' });
        console.log('[VALIDATE] ⚠️ Partial match (first line only)');
        continue;
      }
      
      console.error('[VALIDATE] ✗ No match found for:', findText.slice(0, 80));
      errors.push({ change, error: 'Text not found in document' });
    }
  }
  
  else if (modificationType !== 'REPLACE') {
    console.log('[VALIDATE] Non-REPLACE operation, validating structure only');
    
    for (const operation of changesOrOperations) {
      if (!operation.type) {
        errors.push({ operation, error: 'Missing operation type' });
        continue;
      }
          switch (operation.type) {
        case 'add':
          if (!operation.content) {
            errors.push({ operation, error: 'ADD operation missing content' });
          } else {
            validated.push(operation);
            console.log('[VALIDATE] ✓ ADD operation valid');
          }
          break;
          
        case 'delete':
          if (!operation.target) {
            errors.push({ operation, error: 'DELETE operation missing target' });
          } else {
            if (documentText.includes(operation.target)) {
              validated.push(operation);
              console.log('[VALIDATE] ✓ DELETE target found');
            } else {
              errors.push({ operation, error: 'DELETE target not found in document' });
            }
          }
          break;
          
        case 'format':
          if (!operation.source || !operation.transformation) {
            errors.push({ operation, error: 'FORMAT operation missing source or transformation' });
          } else {
            validated.push(operation);
            console.log('[VALIDATE] ✓ FORMAT operation valid');
          }
          break;
          
        case 'transform':
          if (!operation.target) {
            errors.push({ operation, error: 'TRANSFORM operation missing target content' });
          } else {
            validated.push(operation);
            console.log('[VALIDATE] ✓ TRANSFORM operation valid');
          }
          break;
          
        default:
          validated.push(operation);
          console.log('[VALIDATE] ✓ Operation accepted:', operation.type);
      }
    }
  }
  
  console.log(`[VALIDATE] Result: ${validated.length} validated, ${errors.length} errors`);
  return { validated, errors };
}

module.exports = {
  extractTextForAnalysis,
  getModificationInstructions,
  validateChanges
};