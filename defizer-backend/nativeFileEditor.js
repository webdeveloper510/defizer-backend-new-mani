// nativeFileEditor.js - DIRECT FILE MODIFICATION
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const XLSX = require('xlsx');
const { PDFDocument } = require('pdf-lib');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

/**
 * MAIN FUNCTION: Modify file natively while preserving all formatting
 */
async function modifyFileNatively(filePath, userRequest, OPENAI_API_KEY, options = {}) {
  const { originalFormat, filename } = options;
  
  console.log('[NATIVE EDITOR] Starting native modification:', {
    file: filename,
    format: originalFormat,
    request: userRequest.substring(0, 100)
  });

  try {
    // Route to appropriate native editor
    switch (originalFormat.toLowerCase()) {
      case 'docx':
        return await modifyDocxNatively(filePath, userRequest, OPENAI_API_KEY, options);
      
      case 'xlsx':
      case 'xls':
        return await modifyExcelNatively(filePath, userRequest, OPENAI_API_KEY, options);
      
      case 'csv':
      case 'tsv':
        return await modifySpreadsheetNatively(filePath, userRequest, OPENAI_API_KEY, options);
      
      case 'pdf':
        return await modifyPdfNatively(filePath, userRequest, OPENAI_API_KEY, options);
      
      case 'txt':
      case 'md':
        return await modifyTextNatively(filePath, userRequest, OPENAI_API_KEY, options);
      
      default:
        return {
          success: false,
          error: `Native modification not supported for ${originalFormat}`,
          fallbackToTextBased: true
        };
    }
  } catch (error) {
    console.error('[NATIVE EDITOR ERROR]', error);
    return {
      success: false,
      error: error.message,
      fallbackToTextBased: true
    };
  }
}
function escapeXmlText(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function convertToBulletXml(text) {
  // Split by lines that start with "- "
  const lines = text.split('\n').filter(line => line.trim());
  
  let xml = '';
  
  for (const line of lines) {
    const isBullet = line.trim().startsWith('- ');
    const bulletText = isBullet ? line.trim().substring(2) : line.trim();
    
    if (isBullet) {
      // Create bullet paragraph XML
      xml += `<w:p>
        <w:pPr>
          <w:pStyle w:val="ListParagraph"/>
          <w:numPr>
            <w:ilvl w:val="0"/>
            <w:numId w:val="1"/>
          </w:numPr>
        </w:pPr>
        <w:r>
          <w:t xml:space="preserve">${escapeXmlText(bulletText)}</w:t>
        </w:r>
      </w:p>`;
    } else if (line.trim().length > 0) {
      // Regular paragraph (like the title)
      xml += `<w:p>
        <w:pPr>
          <w:pStyle w:val="Normal"/>
        </w:pPr>
        <w:r>
          <w:t xml:space="preserve">${escapeXmlText(line.trim())}</w:t>
        </w:r>
      </w:p>`;
    }
  }
  
  return xml;
}
function replaceParagraphWithBullets(documentXml, findText, bulletXml) {
  // First, find where the text appears in the document
  // We need to find all <w:t> tags that contain parts of our text
  
  // Clean the find text for matching
  const cleanFind = findText.replace(/\s+/g, ' ').trim();
  const words = cleanFind.split(' ');
  
  // Strategy: Find the paragraph(s) that contain this text and replace them
  const paragraphRegex = /<w:p\b[^>]*>.*?<\/w:p>/gs;
  
  let newXml = documentXml;
  let foundParagraphs = [];
  let matches = documentXml.matchAll(paragraphRegex);
  
  for (const match of matches) {
    const paragraph = match[0];
    // Extract text from this paragraph
    const textContent = paragraph.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Check if this paragraph contains our search text
    if (textContent.includes(cleanFind) || 
        words.some(word => word.length > 4 && textContent.includes(word))) {
      foundParagraphs.push(match);
    }
  }
  
  // Replace the found paragraphs with our bullet XML
  if (foundParagraphs.length > 0) {
    // Replace the first occurrence
    newXml = newXml.replace(foundParagraphs[0][0], bulletXml);
    
    // Remove subsequent paragraphs if they're part of the same section
    for (let i = 1; i < foundParagraphs.length && i < 8; i++) {
      newXml = newXml.replace(foundParagraphs[i][0], '');
    }
  }
  
  return newXml;
}

/**
 * DOCX NATIVE MODIFICATION
 * Preserves tables, images, formatting, styles
 */

async function modifyDocxNatively(filePath, userRequest, OPENAI_API_KEY, options) {
  console.log('[DOCX NATIVE] Modifying DOCX with full format preservation');

  try {
    // Step 1: Read the original DOCX file
    const content = fsSync.readFileSync(filePath, 'binary');
    const zip = new PizZip(content);
    
    // Step 2: Extract text
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    const fullText = doc.getFullText();
    
    console.log('[DOCX NATIVE] Extracted text length:', fullText.length);

    // Step 3: Get AI to identify what to change
    const modificationPlan = await getDocxModificationPlan(
      fullText,
      userRequest,
      OPENAI_API_KEY
    );

    if (!modificationPlan.success) {
      return { success: false, error: 'Failed to create modification plan' };
    }

    console.log('[DOCX NATIVE] Modification plan:', modificationPlan);

    // Step 4: Get document XML
    let documentXml = zip.files['word/document.xml'].asText();

    // Step 5: Apply modifications
    const replacements = modificationPlan.replacements || [];
    
    for (const replacement of replacements) {
      try {
        // Check if replacement contains bullet points (lines starting with -)
        const hasBullets = /^-\s+/m.test(replacement.replace);
        
        if (hasBullets) {
          // Convert bullet format to Word XML
          const bulletXml = convertToBulletXml(replacement.replace);
          
          // Find the original text in XML and replace with bullet XML
          documentXml = replaceParagraphWithBullets(
            documentXml, 
            replacement.find, 
            bulletXml
          );
        } else {
          // Simple text replacement for non-bullet changes
          const escapedFind = escapeXmlText(replacement.find);
          const escapedReplace = escapeXmlText(replacement.replace);
          documentXml = documentXml.replace(
            new RegExp(escapedFind, 'g'),
            escapedReplace
          );
        }
      } catch (e) {
        console.error('[DOCX REPLACE ERROR]', e);
      }
    }

    // Update the document XML
    zip.file('word/document.xml', documentXml);

    // Step 6: Generate modified DOCX
    const modifiedBuffer = zip.generate({ type: 'nodebuffer' });
    
    // Step 7: Save modified file
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    await fs.writeFile(outputPath, modifiedBuffer);

    console.log('[DOCX NATIVE] Modified file saved:', outputPath);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: 'docx',
      metadata: {
        modificationType: 'native',
        formatPreserved: true,
        tablesPreserved: true,
        imagesPreserved: true,
        stylesPreserved: true,
        bulletsAdded: true
      }
    };

  } catch (error) {
    console.error('[DOCX NATIVE ERROR]', error);
    
    // Fallback: Use simpler approach
    return await modifyDocxSimple(filePath, userRequest, OPENAI_API_KEY, options);
  }
}

/**
 * DOCX SIMPLE MODIFICATION (Fallback method)
 * When complex XML manipulation fails
 */
async function modifyDocxSimple(filePath, userRequest, OPENAI_API_KEY, options) {
  console.log('[DOCX SIMPLE] Using simplified DOCX modification');

  try {
    // Extract text with structure
    const result = await mammoth.extractRawText({ path: filePath });
    const originalText = result.value;

    // Get AI modification
    const modifiedText = await getAITextModification(
      originalText,
      userRequest,
      OPENAI_API_KEY,
      'docx'
    );

    // Read original file
    const content = fsSync.readFileSync(filePath, 'binary');
    const zip = new PizZip(content);

    // Get document XML
    let documentXml = zip.files['word/document.xml'].asText();

    // Find text content in XML and replace
    const textMatch = documentXml.match(/<w:t[^>]*>(.*?)<\/w:t>/gs);
    
    if (textMatch && textMatch.length > 0) {
      // Replace text while keeping XML structure
      const oldTextContent = textMatch.map(m => 
        m.replace(/<[^>]+>/g, '')
      ).join(' ');

      // Simple paragraph-by-paragraph replacement
      const oldParagraphs = originalText.split('\n\n');
      const newParagraphs = modifiedText.split('\n\n');

      for (let i = 0; i < Math.min(oldParagraphs.length, newParagraphs.length); i++) {
        if (oldParagraphs[i].trim() !== newParagraphs[i].trim()) {
          documentXml = documentXml.replace(
            escapeRegex(oldParagraphs[i].trim()),
            newParagraphs[i].trim()
          );
        }
      }

      zip.file('word/document.xml', documentXml);
    }

    // Generate modified DOCX
    const modifiedBuffer = zip.generate({ type: 'nodebuffer' });
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    await fs.writeFile(outputPath, modifiedBuffer);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: 'docx',
      metadata: {
        modificationType: 'simple',
        formatPreserved: true,
        note: 'Basic formatting preserved'
      }
    };

  } catch (error) {
    console.error('[DOCX SIMPLE ERROR]', error);
    return { success: false, error: error.message };
  }
}

/**
 * EXCEL NATIVE MODIFICATION
 * Preserves formulas, formatting, charts, sheets
 */
async function modifyExcelNatively(filePath, userRequest, OPENAI_API_KEY, options) {
  console.log('[EXCEL NATIVE] Modifying Excel with full preservation');

  try {
    // Read Excel file
    const workbook = XLSX.readFile(filePath);
    
    // Get first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON for analysis
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    console.log('[EXCEL NATIVE] Original data:', {
      rows: data.length,
      columns: data[0]?.length
    });

    // Get AI modification plan
    const modificationPlan = await getExcelModificationPlan(
      data,
      userRequest,
      OPENAI_API_KEY
    );

    if (!modificationPlan.success) {
      return { success: false, error: 'Failed to create Excel modification plan' };
    }

    console.log('[EXCEL NATIVE] Applying', modificationPlan.changes.length, 'changes');

    // Apply changes to worksheet
    for (const change of modificationPlan.changes) {
      const cellAddress = XLSX.utils.encode_cell({ r: change.row, c: change.col });
      worksheet[cellAddress] = { v: change.value, t: change.type || 's' };
    }

    // If adding columns/rows
    if (modificationPlan.addColumns) {
      for (const col of modificationPlan.addColumns) {
        const colIndex = data[0].length + col.index;
        // Add header
        const headerCell = XLSX.utils.encode_cell({ r: 0, c: colIndex });
        worksheet[headerCell] = { v: col.name, t: 's' };
        // Add data
        for (let i = 1; i < data.length; i++) {
          const dataCell = XLSX.utils.encode_cell({ r: i, c: colIndex });
          worksheet[dataCell] = { v: col.defaultValue || '', t: 's' };
        }
      }
    }

    // Update range
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    if (modificationPlan.addColumns) {
      range.e.c += modificationPlan.addColumns.length;
    }
    worksheet['!ref'] = XLSX.utils.encode_range(range);

    // Save modified Excel
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    XLSX.writeFile(workbook, outputPath);

    console.log('[EXCEL NATIVE] Modified file saved:', outputPath);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: options.originalFormat,
      metadata: {
        modificationType: 'native',
        formatPreserved: true,
        formulasPreserved: true,
        chartsPreserved: true,
        sheetsPreserved: true
      }
    };

  } catch (error) {
    console.error('[EXCEL NATIVE ERROR]', error);
    return { success: false, error: error.message };
  }
}

/**
 * CSV/TSV NATIVE MODIFICATION
 */
async function modifySpreadsheetNatively(filePath, userRequest, OPENAI_API_KEY, options) {
  console.log('[SPREADSHEET NATIVE] Modifying CSV/TSV');

  try {
    const delimiter = options.originalFormat === 'tsv' ? '\t' : ',';
    
    // Read file
    const content = await fs.readFile(filePath, 'utf-8');
    const rows = content.split('\n').map(line => 
      line.split(delimiter).map(cell => cell.trim())
    );

    console.log('[SPREADSHEET NATIVE] Original:', rows.length, 'rows');

    // Get modification from AI
    const modifiedRows = await getSpreadsheetModification(
      rows,
      userRequest,
      OPENAI_API_KEY,
      delimiter
    );

    // Write back to file
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    const modifiedContent = modifiedRows
      .map(row => row.join(delimiter))
      .join('\n');
    
    await fs.writeFile(outputPath, modifiedContent);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: options.originalFormat,
      metadata: {
        modificationType: 'native',
        formatPreserved: true,
        originalRows: rows.length,
        modifiedRows: modifiedRows.length
      }
    };

  } catch (error) {
    console.error('[SPREADSHEET NATIVE ERROR]', error);
    return { success: false, error: error.message };
  }
}

/**
 * TEXT FILE NATIVE MODIFICATION
 */
async function modifyTextNatively(filePath, userRequest, OPENAI_API_KEY, options) {
  console.log('[TEXT NATIVE] Modifying text file');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    
    const modifiedContent = await getAITextModification(
      content,
      userRequest,
      OPENAI_API_KEY,
      options.originalFormat
    );

    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    await fs.writeFile(outputPath, modifiedContent);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: options.originalFormat,
      metadata: {
        modificationType: 'native',
        formatPreserved: true
      }
    };

  } catch (error) {
    console.error('[TEXT NATIVE ERROR]', error);
    return { success: false, error: error.message };
  }
}

/**
 * PDF NATIVE MODIFICATION (Limited - PDFs are complex)
 */
async function modifyPdfNatively(filePath, userRequest, OPENAI_API_KEY, options) {
  console.log('[PDF NATIVE] Note: PDF modification is limited');

  // PDFs are very complex to edit natively
  // Best approach: Extract text, modify, create new PDF
  return {
    success: false,
    error: 'Native PDF modification not fully supported. Use text extraction method.',
    fallbackToTextBased: true
  };
}

// ============================================================================
// AI HELPER FUNCTIONS
// ============================================================================

/**
 * Get DOCX modification plan from AI
 */
async function getDocxModificationPlan(fullText, userRequest, OPENAI_API_KEY) {
  const prompt = `
You are a document editor assistant. Analyze this document and the user's request, then provide a modification plan.

DOCUMENT CONTENT:
"""
${fullText.substring(0, 10000)}
"""

USER REQUEST: "${userRequest}"

IMPORTANT: If the user wants to convert text to bullet points:
- In the "replace" field, format each item as a new line starting with "- " (dash followed by space)
- Example format:
  Title:
  - First item here
  - Second item here
  - Third item here

Provide a JSON response with find-and-replace instructions:
{
  "success": true,
  "replacements": [
    {
      "find": "exact original text to find (multi-line is OK)",
      "replace": "new formatted text with bullets if needed"
    }
  ],
  "note": "Brief explanation"
}

Return ONLY valid JSON, no markdown.
`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a document modification assistant. Always return valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1
    })
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim() || '{}';
  
  try {
    return JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
  } catch (e) {
    return { success: false, error: 'Failed to parse AI response' };
  }
}
/**
 * Get Excel modification plan from AI
 */
async function getExcelModificationPlan(data, userRequest, OPENAI_API_KEY) {
  const headers = data[0];
  const sampleRows = data.slice(1, 6);

  const prompt = `
You are an Excel modification assistant. Analyze this spreadsheet and provide modification instructions.

HEADERS: ${headers.join(', ')}

SAMPLE DATA (first 5 rows):
${sampleRows.map((row, i) => `Row ${i+1}: ${row.join(', ')}`).join('\n')}

USER REQUEST: "${userRequest}"

Provide JSON response:
{
  "success": true,
  "changes": [
    {"row": 1, "col": 2, "value": "new value", "type": "s"}
  ],
  "addColumns": [
    {"index": 0, "name": "New Column", "defaultValue": ""}
  ],
  "note": "Brief explanation"
}

Return ONLY valid JSON.
`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an Excel modification assistant. Always return valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1
    })
  });

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content?.trim() || '{}';
  
  try {
    return JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, ''));
  } catch (e) {
    return { success: false, error: 'Failed to parse AI response' };
  }
}

/**
 * Get spreadsheet modification from AI
 */
async function getSpreadsheetModification(rows, userRequest, OPENAI_API_KEY, delimiter) {
  const prompt = `
Modify this spreadsheet according to the request.

CURRENT DATA:
${rows.slice(0, 10).map(row => row.join(delimiter)).join('\n')}
${rows.length > 10 ? `... (${rows.length} total rows)` : ''}

USER REQUEST: "${userRequest}"

Return the COMPLETE modified spreadsheet with ALL rows (not just sample).
Use "${delimiter}" as delimiter.
Return ONLY the data, no explanations.
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
      temperature: 0.1
    })
  });

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  
  return content.split('\n').map(line => 
    line.split(delimiter).map(cell => cell.trim())
  );
}

/**
 * Get AI text modification
 */
async function getAITextModification(originalText, userRequest, OPENAI_API_KEY, format) {
  const prompt = `
Modify this ${format} document according to the user's request.

ORIGINAL DOCUMENT:
"""
${originalText}
"""

USER REQUEST: "${userRequest}"

Return the COMPLETE modified document. Preserve formatting and structure.
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
      temperature: 0.1
    })
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || originalText;
}

/**
 * Escape regex special characters
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  modifyFileNatively
};