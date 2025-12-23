
const fs = require('fs').promises;
const fsSync = require('fs');
const PizZip = require('pizzip');
const XLSX = require('xlsx');
const { extractTextForAnalysis, getModificationInstructions, validateChanges } = require('./documentAnalyzer');

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
        error: instructions.explanation || 'No modifications identified by AI'
      };
    }

    // STEP 2.5: Validate changes
    console.log('[STEP 2.5] Validating changes...');
    const { validated, errors } = validateChanges(documentText, instructions.changes);
    
    if (errors.length > 0) {
      console.warn('[VALIDATION WARNINGS]', errors);
    }
    
    if (validated.length === 0) {
      return {
        success: false,
        error: 'No valid changes could be applied (text not found in document)'
      };
    }

    console.log('[STEP 2.5] ✓ Validated', validated.length, 'changes');

    // STEP 3: Apply changes to document
    console.log('[STEP 3] Applying changes...');
    
    switch(originalFormat.toLowerCase()) {
      case 'docx':
        return await modifyDocxWithLists(filePath, validated, options);
      
      case 'xlsx':
      case 'xls':
        return await modifyExcelDirectly(filePath, validated, options);
      
      case 'txt':
      case 'md':
      case 'markdown':
        return await modifyTextDirectly(filePath, validated, options);
      
      default:
        return new Error(`Format ${originalFormat} not supported for direct modification`);
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
 * FIXED: Modify DOCX with proper XML structure
 */
async function modifyDocxWithLists(filePath, changes, options) {
  try {
    // Read original DOCX
    const content = fsSync.readFileSync(filePath, 'binary');
    const zip = new PizZip(content);
    
    // Get document XML
    let documentXml = zip.files['word/document.xml'].asText();
    
    console.log('[DOCX] Processing', changes.length, 'changes');

    // FIX: Extract body content only (preserve document structure)
    const bodyMatch = documentXml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
    if (!bodyMatch) {
      throw new Error('Could not find document body in XML');
    }
    
    const beforeBody = documentXml.substring(0, bodyMatch.index + bodyMatch[0].indexOf('>') + 1);
    let bodyContent = bodyMatch[1];
    const afterBody = '</w:body></w:document>';

    console.log('[DOCX] XML structure:', {
      totalLength: documentXml.length,
      bodyStart: beforeBody.length,
      bodyLength: bodyContent.length
    });

    // Apply each change to body content only
    for (const change of changes) {
      const findText = change.find.trim();
      const replaceText = change.replace.trim();
      
      console.log('[DOCX] Change:', {
        find: findText.slice(0, 60) + '...',
        replace: replaceText.slice(0, 60) + '...',
        reason: change.reason
      });

      // Check for bullets or numbering
      const hasBullets = /^[•\-*]\s+/m.test(replaceText);
      const hasNumbering = /^\d+\.\s+/m.test(replaceText);
      
      if (hasBullets || hasNumbering) {
        const listType = hasNumbering ? 'numbered' : 'bullet';
        console.log(`[DOCX] Converting to ${listType} list...`);
        
        const { heading, listItems, isNumbered } = parseListText(replaceText);
        console.log('[DOCX] Parsed:', { 
          heading: heading.slice(0, 50), 
          items: listItems.length,
          type: isNumbered ? 'numbered' : 'bullet'
        });
        
        // Replace in body content
        const result = replaceSectionWithListSafe(bodyContent, findText, heading, listItems, isNumbered);
        
        if (result.success) {
          bodyContent = result.content;
          console.log(`[DOCX] ✓ Replaced with ${listType} list!`);
        } else {
          console.log('[DOCX] ⚠ Fallback to simple text replacement');
          bodyContent = simpleTextReplaceSafe(bodyContent, findText, replaceText);
        }
        
      } else {
        // Simple text replacement
        console.log('[DOCX] Simple text replacement...');
        bodyContent = simpleTextReplaceSafe(bodyContent, findText, replaceText);
      }
    }

    // Reconstruct full document
    documentXml = beforeBody + bodyContent + afterBody;

    // Ensure numbering.xml exists
    if (!zip.files['word/numbering.xml']) {
      console.log('[DOCX] Adding numbering.xml...');
      zip.file('word/numbering.xml', createNumberingXml());
      
      // Update relationships
      let relsXml = zip.files['word/_rels/document.xml.rels'].asText();
      if (!relsXml.includes('numbering.xml')) {
        const maxId = Math.max(
          ...Array.from(relsXml.matchAll(/Id="rId(\d+)"/g), m => parseInt(m[1]))
        );
        const newId = maxId + 1;
        const newRel = `<Relationship Id="rId${newId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`;
        relsXml = relsXml.replace('</Relationships>', newRel + '</Relationships>');
        zip.file('word/_rels/document.xml.rels', relsXml);
      }
    }

    // Save modified XML
    zip.file('word/document.xml', documentXml);
    
    const modifiedBuffer = zip.generate({ type: 'nodebuffer' });
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    
    await fs.writeFile(outputPath, modifiedBuffer);
    
    console.log('[DOCX] ✓ Saved:', outputPath);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: 'docx',
      metadata: {
        method: 'direct_xml_with_lists',
        changesApplied: changes.length
      }
    };

  } catch (error) {
    console.error('[DOCX ERROR]', error);
    return { success: false, error: error.message };
  }
}

/**
 * Parse list text - supports BOTH bullets AND numbering
 */
function parseListText(text) {
  const lines = text.split('\n');
  const listItems = [];
  let heading = '';
  let inHeading = true;
  let isNumbered = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Detect bullet items
    if (/^[•\-*]\s+/.test(trimmed)) {
      inHeading = false;
      const content = trimmed.replace(/^[•\-*]\s+/, '').trim();
      if (content) listItems.push(content);
    } 
    // Detect numbered items
    else if (/^\d+\.\s+/.test(trimmed)) {
      inHeading = false;
      isNumbered = true;
      const content = trimmed.replace(/^\d+\.\s+/, '').trim();
      if (content) listItems.push(content);
    } 
    else if (inHeading) {
      heading += (heading ? '\n' : '') + trimmed;
    }
  }
  
  return { heading, listItems, isNumbered };
}

/**
 * FIXED: Safe replacement that maintains paragraph structure
 */
function replaceSectionWithListSafe(bodyContent, findText, heading, listItems, isNumbered) {
  console.log('[REPLACE SAFE] Looking for text...');
  
  // Extract all paragraphs
  const paragraphs = extractParagraphsSafe(bodyContent);
  console.log('[REPLACE SAFE] Found', paragraphs.length, 'paragraphs');
  
  // Find matching paragraph(s)
  let startIdx = -1;
  let endIdx = -1;
  
  const normalizedFind = findText.replace(/\s+/g, ' ').trim().toLowerCase();
  
  // Search for match
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const normalizedText = para.text.replace(/\s+/g, ' ').toLowerCase();
    
    // Match first 100 chars
    if (normalizedText.includes(normalizedFind.slice(0, 100))) {
      startIdx = i;
      // Estimate range
      const lineCount = Math.min(findText.split('\n').length + 2, 10);
      endIdx = Math.min(i + lineCount, paragraphs.length - 1);
      console.log('[REPLACE SAFE] Found match at paragraph', i);
      break;
    }
  }
  
  if (startIdx === -1) {
    console.log('[REPLACE SAFE] ✗ No match found');
    return { success: false, content: bodyContent };
  }
  
  // Build replacement XML (WITHOUT xmlns - it's already in document root)
  const listXml = createWordListSafe(heading, listItems, isNumbered);
  
  // Calculate positions
  const beforeSection = paragraphs.slice(0, startIdx);
  const afterSection = paragraphs.slice(endIdx + 1);
  
  // Reconstruct body
  const newContent = 
    beforeSection.map(p => p.xml).join('') +
    listXml +
    afterSection.map(p => p.xml).join('');
  
  console.log('[REPLACE SAFE] ✓ Replaced paragraphs', startIdx, '-', endIdx);
  return { success: true, content: newContent };
}

/**
 * FIXED: Extract paragraphs safely
 */
function extractParagraphsSafe(bodyContent) {
  const paragraphs = [];
  const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let match;
  
  while ((match = paragraphRegex.exec(bodyContent)) !== null) {
    const pXml = match[0];
    
    // Extract text
    const textMatches = pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    const text = textMatches
      .map(t => {
        const m = t.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
        return m ? decodeXml(m[1]) : '';
      })
      .join('');
         
    paragraphs.push({
      xml: pXml,
      text: text.trim()
    });
  }
  
  return paragraphs;
}

/**
 * FIXED: Simple text replacement that maintains structure
 */
function simpleTextReplaceSafe(bodyContent, findText, replaceText) {
  const paragraphs = extractParagraphsSafe(bodyContent);
  const normalizedFind = findText.replace(/\s+/g, ' ').toLowerCase();
  
  // Find and replace
  let modified = false;
  const newParagraphs = paragraphs.map(para => {
    const normalizedText = para.text.replace(/\s+/g, ' ').toLowerCase();
    
    if (normalizedText.includes(normalizedFind.slice(0, 60))) {
      console.log('[SIMPLE REPLACE] Replacing in paragraph');
      modified = true;
      
      // Replace within <w:t> tags
      let modifiedXml = para.xml;
      const textRegex = /<w:t([^>]*)>([^<]*)<\/w:t>/g;
      
      modifiedXml = modifiedXml.replace(textRegex, (match, attrs, content) => {
        const decoded = decodeXml(content);
        const newContent = decoded.replace(
          new RegExp(findText.split('\n')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
          replaceText.split('\n')[0]
        );
        return `<w:t${attrs}>${escapeXml(newContent)}</w:t>`;
      });
      
      return { ...para, xml: modifiedXml };
    }
    return para;
  });
  
  if (!modified) {
    console.log('[SIMPLE REPLACE] No match found');
    return bodyContent;
  }
  
  return newParagraphs.map(p => p.xml).join('');
}

/**
 * FIXED: Create Word list WITHOUT extra xmlns (document already has it)
 */
function createWordListSafe(heading, listItems, isNumbered = false) {
  let xml = '';
  
  // Add heading
  if (heading) {
    const headingLines = heading.split('\n').filter(l => l.trim());
    headingLines.forEach(line => {
      xml += `<w:p>`;
      xml += `<w:pPr><w:pStyle w:val="Heading3"/></w:pPr>`;
      xml += `<w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r>`;
      xml += `</w:p>`;
    });
  }
  
  // Add list items
  const numId = isNumbered ? '2' : '1';
  
  listItems.forEach(item => {
    xml += `<w:p>`;
    xml += `<w:pPr>`;
    xml += `<w:pStyle w:val="ListParagraph"/>`;
    xml += `<w:numPr>`;
    xml += `<w:ilvl w:val="0"/>`;
    xml += `<w:numId w:val="${numId}"/>`;
    xml += `</w:numPr>`;
    xml += `</w:pPr>`;
    xml += `<w:r>`;
    xml += `<w:t xml:space="preserve">${escapeXml(item)}</w:t>`;
    xml += `</w:r>`;
    xml += `</w:p>`;
  });
  
  return xml;
}

/**
 * Create numbering.xml
 */
function createNumberingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:pPr>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
      <w:rPr>
        <w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/>
      </w:rPr>
    </w:lvl>
  </w:abstractNum>
  
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr>
        <w:ind w:left="720" w:hanging="360"/>
      </w:pPr>
    </w:lvl>
  </w:abstractNum>
  
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
  
  <w:num w:numId="2">
    <w:abstractNumId w:val="1"/>
  </w:num>
</w:numbering>`;
}

/**
 * Modify Excel
 */
async function modifyExcelDirectly(filePath, changes, options) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(worksheet['!ref']);

    let changesApplied = 0;

    for (const change of changes) {
      const findText = change.find.trim();
      const replaceText = change.replace.trim();
      
      for (let R = range.s.r; R <= range.e.r; R++) {
        for (let C = range.s.c; C <= range.e.c; C++) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = worksheet[cellAddress];
          
          if (cell && cell.v && typeof cell.v === 'string') {
            if (cell.v.includes(findText)) {
              cell.v = cell.v.replace(findText, replaceText);
              changesApplied++;
              console.log('[EXCEL] Updated cell', cellAddress);
            }
          }
        }
      }
    }

    if (changesApplied === 0) {
      console.warn('[EXCEL] No changes were applied');
    }

    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    XLSX.writeFile(workbook, outputPath);
    
    return { 
      success: true, 
      modifiedFilePath: outputPath, 
      originalFormat: options.originalFormat || 'xlsx',
      metadata: { changesApplied }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Modify text files
 */
async function modifyTextDirectly(filePath, changes, options) {
  try {
    let content = await fs.readFile(filePath, 'utf-8');
    let changesApplied = 0;
    
    for (const change of changes) {
      const findText = change.find.trim();
      const replaceText = change.replace.trim();
      
      if (content.includes(findText)) {
        content = content.replace(findText, replaceText);
        changesApplied++;
        console.log('[TEXT] Applied change:', change.reason);
      }
    }
    
    if (changesApplied === 0) {
      console.warn('[TEXT] No changes were applied');
    }
    
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    await fs.writeFile(outputPath, content);
    
    return { 
      success: true, 
      modifiedFilePath: outputPath, 
      originalFormat: options.originalFormat || 'txt',
      metadata: { changesApplied }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Helper functions
function escapeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

module.exports = {
  modifyDocumentDirectly
};