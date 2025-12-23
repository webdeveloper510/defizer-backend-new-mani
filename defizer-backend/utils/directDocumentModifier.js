// utils/directDocumentModifier.js - SIMPLIFIED DYNAMIC VERSION

const fs = require('fs').promises;
const fsSync = require('fs');
const PizZip = require('pizzip');
const XLSX = require('xlsx');
const { extractTextForAnalysis, getModificationInstructions } = require('./documentAnalyzer');

/**
 * MAIN FUNCTION: Modify document based on ANY user instruction
 */
async function modifyDocumentDirectly(filePath, userRequest, OPENAI_API_KEY, options = {}) {
  const { originalFormat, filename } = options;
  
  console.log('[DIRECT MODIFIER] Starting:', {
    file: filename,
    format: originalFormat,
    request: userRequest
  });

  try {
    // STEP 1: Extract text for AI
    console.log('[STEP 1] Extracting text...');
    const documentText = await extractTextForAnalysis(filePath, originalFormat);
    console.log('[STEP 1] ✓ Extracted:', documentText.length, 'chars');

    // STEP 2: AI analyzes and gives instructions
    console.log('[STEP 2] AI analyzing...');
    const instructions = await getModificationInstructions(
      documentText,
      userRequest,
      OPENAI_API_KEY
    );
    
    console.log('[STEP 2] ✓ AI Instructions:', {
      changes: instructions.changes?.length || 0,
      explanation: instructions.explanation
    });

    if (!instructions.changes || instructions.changes.length === 0) {
      return {
        success: false,
        error: 'No modifications identified by AI'
      };
    }

    // STEP 3: Apply changes to document
    console.log('[STEP 3] Applying changes...');
    
    switch(originalFormat.toLowerCase()) {
      case 'docx':
        return await modifyDocxDirectly(filePath, instructions.changes, options);
      
      case 'xlsx':
      case 'xls':
        return await modifyExcelDirectly(filePath, instructions.changes, options);
      
      case 'txt':
      case 'md':
        return await modifyTextDirectly(filePath, instructions.changes, options);
      
      default:
        throw new Error(`Format ${originalFormat} not supported`);
    }

  } catch (error) {
    console.error('[DIRECT MODIFIER ERROR]', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Modify DOCX - applies simple find & replace in XML
 */
async function modifyDocxDirectly(filePath, changes, options) {
  try {
    // Read original DOCX
    const content = fsSync.readFileSync(filePath, 'binary');
    const zip = new PizZip(content);
    
    // Get document XML
    let documentXml = zip.files['word/document.xml'].asText();
    
    console.log('[DOCX] Processing', changes.length, 'changes');

    // Apply each change
    for (const change of changes) {
      const findText = change.find.trim();
      const replaceText = change.replace.trim();
      
      console.log('[DOCX] Change:', {
        find: findText.slice(0, 50) + '...',
        replace: replaceText.slice(0, 50) + '...'
      });

      // Strategy: Find text in <w:t> tags and replace
      // This preserves all formatting, tables, images around it
      
      // Build regex to find the text across potentially multiple <w:t> tags
      const textParts = findText.split(/\s+/);
      
      // Simple approach: Try direct replacement first
      let modified = false;
      
      // Try to find and replace in text nodes
      const textRegex = new RegExp(
        `(<w:t[^>]*>)([^<]*${escapeRegex(findText)}[^<]*)(<\/w:t>)`,
        'g'
      );
      
      if (textRegex.test(documentXml)) {
        documentXml = documentXml.replace(textRegex, (match, open, content, close) => {
          const newContent = content.replace(findText, replaceText);
          modified = true;
          return open + escapeXml(newContent) + close;
        });
      }
      
      // If not found, try word-by-word approach
      if (!modified) {
        // Find text that might be split across tags
        const firstWord = textParts[0];
        const pattern = new RegExp(escapeRegex(firstWord), 'i');
        
        if (pattern.test(documentXml)) {
          // Found the start, try to replace
          const escapedFind = escapeRegex(findText);
          documentXml = documentXml.replace(
            new RegExp(escapedFind, 'gi'),
            escapeXml(replaceText)
          );
          modified = true;
        }
      }

      if (modified) {
        console.log('[DOCX] ✓ Applied change');
      } else {
        console.log('[DOCX] ⚠ Could not find text to replace');
      }
    }

    // Save modified XML back to DOCX
    zip.file('word/document.xml', documentXml);
    
    // Generate modified file
    const modifiedBuffer = zip.generate({ type: 'nodebuffer' });
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    
    await fs.writeFile(outputPath, modifiedBuffer);
    
    console.log('[DOCX] ✓ Saved:', outputPath);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: 'docx',
      metadata: {
        method: 'direct_xml_modification',
        changesApplied: changes.length,
        preservedAll: true
      }
    };

  } catch (error) {
    console.error('[DOCX ERROR]', error);
    return { success: false, error: error.message };
  }
}

/**
 * Modify Excel - simple find & replace in cells
 */
async function modifyExcelDirectly(filePath, changes, options) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref']);

    console.log('[EXCEL] Processing', changes.length, 'changes');

    // Apply changes
    for (const change of changes) {
      const findText = change.find.trim();
      const replaceText = change.replace.trim();
      
      // Search all cells
      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = worksheet[cellAddress];
          
          if (cell && cell.v && typeof cell.v === 'string') {
            if (cell.v.includes(findText)) {
              cell.v = cell.v.replace(findText, replaceText);
              console.log('[EXCEL] ✓ Replaced in', cellAddress);
            }
          }
        }
      }
    }

    // Save
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    XLSX.writeFile(workbook, outputPath);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: options.originalFormat || 'xlsx'
    };

  } catch (error) {
    console.error('[EXCEL ERROR]', error);
    return { success: false, error: error.message };
  }
}

/**
 * Modify text files - simple find & replace
 */
async function modifyTextDirectly(filePath, changes, options) {
  try {
    let content = await fs.readFile(filePath, 'utf-8');

    for (const change of changes) {
      content = content.replace(
        new RegExp(escapeRegex(change.find.trim()), 'g'),
        change.replace.trim()
      );
    }

    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    await fs.writeFile(outputPath, content);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: options.originalFormat || 'txt'
    };

  } catch (error) {
    console.error('[TEXT ERROR]', error);
    return { success: false, error: error.message };
  }
}

// Helper functions
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  modifyDocumentDirectly
};