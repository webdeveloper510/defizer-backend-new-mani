const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const XLSX = require("xlsx");
const AdmZip = require("adm-zip"); 
const { PDFDocument } = require('pdf-lib'); 
const pdfParse = require('pdf-parse'); 
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const PptxGenJS = require('pptxgenjs');
const Pizzip = require('pizzip');
const {
  extractTextForAnalysis,
  getModificationInstructions,
  validateChanges,
} = require("./documentAnalyzer");

const MODIFIABLE_FORMATS = {
  direct: ["docx", "xlsx", "xls", "txt", "md", "markdown", "odt", "odp", "ods"],

  textBased: [
    "csv",
    "tsv",
    "html",
    "htm",
    "xml",
    "json",
    "rtf",
    "ics",
    "vcf",
    "eml",
    "mbox",
  ],

  complex: ["pdf", "pptx", "ppt"],

  notModifiable: [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "tiff",
    "mp4",
    "mp3",
    "wav",
    "zip",
    "rar",
    "7z",
    "tar.gz",
    "mdb",
    "accdb",
    "msg",
  ],
};

function isFormatModifiable(format) {
  format = format.toLowerCase().replace(".", "");

  return (
    MODIFIABLE_FORMATS.direct.includes(format) ||
    MODIFIABLE_FORMATS.textBased.includes(format) ||
    MODIFIABLE_FORMATS.complex.includes(format)
  );
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
async function extractTextWithPositions(pdfBytes, pageIndex) {
  const data = await pdfParse(pdfBytes);
  return [];
}

function findTextOccurrences(textContent, findText) {
  const occurrences = [];
  return occurrences;
}

function escapeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
async function modifyPdfPreserveFormatting(filePath, changes, options = {}) {
  const { filename } = options;
  
  console.log('[PDF MODIFIER] Starting with format preservation:', filename);
  
  try {
    // Read the PDF
    const existingPdfBytes = await fs.readFile(filePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    
    const pages = pdfDoc.getPages();
    let modificationsApplied = 0;
    
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const page = pages[pageIndex];
      
      const textContent = await extractTextWithPositions(existingPdfBytes, pageIndex);
      
      for (const change of changes) {
        const findText = change.find.trim();
        const replaceText = change.replace.trim();
        
        const occurrences = findTextOccurrences(textContent, findText);
        
        for (const occurrence of occurrences) {
          page.drawRectangle({
            x: occurrence.x,
            y: occurrence.y,
            width: occurrence.width,
            height: occurrence.height,
            color: rgb(1, 1, 1), 
          });
          
          page.drawText(replaceText, {
            x: occurrence.x,
            y: occurrence.y,
            size: occurrence.fontSize,
            font: await pdfDoc.embedFont(StandardFonts.Helvetica), 
            color: rgb(0, 0, 0),
          });
          
          modificationsApplied++;
          console.log(`[PDF] ✓ Replaced on page ${pageIndex + 1}:`, findText);
        }
      }
    }
    
    if (modificationsApplied === 0) {
      return {
        success: false,
        error: 'No matching text found in PDF'
      };
    }
        const modifiedPdfBytes = await pdfDoc.save();
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    await fs.writeFile(outputPath, modifiedPdfBytes);
    
    console.log(`[PDF] ✓ Successfully modified ${modificationsApplied} locations`);
    
    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: 'pdf',
      metadata: {
        method: 'pdf_native_modification',
        changesApplied: modificationsApplied,
        preservedStructure: true,
        preservedFormatting: true
      }
    };
    
  } catch (error) {
    console.error('[PDF MODIFIER ERROR]', error);
        console.log('[PDF] Falling back to extract-modify-export method...');
    return await modifyComplexFormat(filePath, userRequest, OPENAI_API_KEY, options);
  }
}
async function modifyPptxPreserveFormatting(filePath, changes, options = {}) {
  const { filename } = options;
  
  console.log('[PPTX MODIFIER] Starting with format preservation:', filename);
  
  try {
    const content = await fs.readFile(filePath);
    const zip = new Pizzip(content);
    
    let modificationsApplied = 0;
    
    const slideFiles = Object.keys(zip.files).filter(name => 
      name.match(/ppt\/slides\/slide\d+\.xml$/)
    );
    
    console.log(`[PPTX] Found ${slideFiles.length} slides`);
    
    for (const slideFile of slideFiles) {
      let slideXml = zip.files[slideFile].asText();
      const originalXml = slideXml;
      
      for (const change of changes) {
        const findText = change.find.trim();
        const replaceText = change.replace.trim();
                const escapedFind = escapeXml(findText);
        const escapedReplace = escapeXml(replaceText);
                const textTagRegex = /(<a:t[^>]*>)([^<]+)(<\/a:t>)/g;
        
        slideXml = slideXml.replace(textTagRegex, (match, openTag, textContent, closeTag) => {
          const decoded = decodeXml(textContent);
          
          if (decoded.includes(findText)) {
            const replaced = decoded.replace(
              new RegExp(escapeRegExp(findText), 'g'),
              replaceText
            );
            modificationsApplied++;
            return openTag + escapeXml(replaced) + closeTag;
          }
          
          return match;
        });
      }
            if (slideXml !== originalXml) {
        zip.file(slideFile, slideXml);
        console.log(`[PPTX] ✓ Modified:`, slideFile);
      }
    }
    
    if (modificationsApplied === 0) {
      return {
        success: false,
        error: 'No matching text found in presentation'
      };
    }
        const modifiedBuffer = zip.generate({ type: 'nodebuffer' });
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    await fs.writeFile(outputPath, modifiedBuffer);
    
    console.log(`[PPTX] ✓ Successfully modified ${modificationsApplied} locations`);
    
    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: 'pptx',
      metadata: {
        method: 'pptx_native_modification',
        changesApplied: modificationsApplied,
        preservedStructure: true,
        preservedFormatting: true,
        preservedSlides: true
      }
    };
    
  } catch (error) {
    console.error('[PPTX MODIFIER ERROR]', error);
        console.log('[PPTX] Falling back to extract-modify-export method...');
    return await modifyComplexFormat(filePath, userRequest, OPENAI_API_KEY, options);
  }
}

function getModificationStrategy(format) {
  format = format.toLowerCase().replace(".", "");

  if (MODIFIABLE_FORMATS.direct.includes(format)) {
    return "DIRECT";
  }

  if (MODIFIABLE_FORMATS.textBased.includes(format)) {
    return "TEXT_BASED";
  }

  if (MODIFIABLE_FORMATS.complex.includes(format)) {
    return "EXTRACT_MODIFY_EXPORT";
  }

  return "NOT_SUPPORTED";
}

async function modifyDocumentEnhanced(
  filePath,
  userRequest,
  OPENAI_API_KEY,
  options = {}
) {
  const { originalFormat, filename } = options;
  const strategy = getModificationStrategy(originalFormat);

  console.log("[ENHANCED MODIFIER]", {
    file: filename,
    format: originalFormat,
    strategy,
    isModifiable: strategy !== "NOT_SUPPORTED",
  });

  switch (strategy) {
    case "DIRECT":
      return await modifyDocumentDirectly(
        filePath,
        userRequest,
        OPENAI_API_KEY,
        options
      );

    case "TEXT_BASED":
      return await modifyTextBasedFormat(
        filePath,
        userRequest,
        OPENAI_API_KEY,
        options
      );

    case "EXTRACT_MODIFY_EXPORT":
      return await modifyComplexFormat(
        filePath,
        userRequest,
        OPENAI_API_KEY,
        options
      );

    case "NOT_SUPPORTED":
      return {
        success: false,
        error: `Format ${originalFormat.toUpperCase()} does not support direct modification.`,
        recommendation: `You can export this to a modifiable format (DOCX, TXT, etc.) first.`,
      };

    default:
      return {
        success: false,
        error: `Unknown modification strategy for ${originalFormat}`,
      };
  }
}

async function modifyDocumentDirectly(
  filePath,
  userRequest,
  OPENAI_API_KEY,
  options = {}
) {
  const { originalFormat, filename, messageHistory } = options;

  console.log("[DIRECT MODIFIER] Starting:", {
    file: filename,
    format: originalFormat,
    request: userRequest,
    hasHistory: !!messageHistory
  });

  try {
    const documentText = await extractTextForAnalysis(filePath, originalFormat);
    
    // Get AI instructions (now handles ALL modification types)
    const instructions = await getModificationInstructions(
      documentText,
      userRequest,
      OPENAI_API_KEY,
      messageHistory 
    );

    // Check modification type
    const modType = instructions.modificationType || 'REPLACE';
    console.log('[MODIFIER] Modification type:', modType);
    // TYPE 1: REPLACE (your existing logic - backward compatible)
    if (modType === 'REPLACE') {
      if (!instructions.changes || instructions.changes.length === 0) {
        return {
          success: false,
          error: instructions.explanation || "No modifications identified by AI",
        };
      }
      
      const { validated, errors } = validateChanges(
        documentText,
        instructions.changes,
        'REPLACE'
      );

      if (validated.length === 0) {
        return {
          success: false,
          error: "No valid changes could be applied (text not found in document)",
        };
      }
      
      // Execute replace operations (your existing code)
      switch (originalFormat.toLowerCase()) {
        case "docx":
          return await modifyDocxWithLists(filePath, validated, options);

        case "xlsx":
        case "xls":
          return await modifyExcelDirectly(filePath, validated, options);

        case "txt":
        case "md":
        case "markdown":
          return await modifyTextDirectly(filePath, validated, options);
        
        case "odt":
        case "odp":
        case "ods":
          return await modifyOpenDocument(filePath, validated, options);

        default:
          return {
            success: false,
            error: `Format ${originalFormat} not handled in direct modifier`
          };
      }
    }

    // TYPE 2: ADD (adding new content)
    else if (modType === 'ADD') {
      if (!instructions.operations || instructions.operations.length === 0) {
        return { success: false, error: "No ADD operations specified" };
      }

      const { validated } = validateChanges(
        documentText,
        instructions.operations,
        'ADD'
      );

      if (validated.length === 0) {
        return { success: false, error: "No valid ADD operations" };
      }

      return await executeAddOperations(filePath, validated, originalFormat, options);
    }

    // TYPE 3: DELETE (removing content)
    else if (modType === 'DELETE') {
      if (!instructions.operations || instructions.operations.length === 0) {
        return { success: false, error: "No DELETE operations specified" };
      }

      const { validated } = validateChanges(
        documentText,
        instructions.operations,
        'DELETE'
      );

      if (validated.length === 0) {
        return { success: false, error: "No valid DELETE operations" };
      }

      return await executeDeleteOperations(filePath, validated, originalFormat, options);
    }

    // TYPE 4: FORMAT (changing structure/format)
    else if (modType === 'FORMAT') {
      if (!instructions.operations || instructions.operations.length === 0) {
        return { success: false, error: "No FORMAT operations specified" };
      }

      const { validated } = validateChanges(
        documentText,
        instructions.operations,
        'FORMAT'
      );

      if (validated.length === 0) {
        return { success: false, error: "No valid FORMAT operations" };
      }

      return await executeFormatOperations(filePath, validated, originalFormat, options);
    }

    // TYPE 5: TRANSFORM (rewriting content)
    else if (modType === 'TRANSFORM') {
      if (!instructions.operations || instructions.operations.length === 0) {
        return { success: false, error: "No TRANSFORM operations specified" };
      }

      return await executeTransformOperations(filePath, instructions.operations, originalFormat, options);
    }

    // TYPE 6-8: Other types (can add later)
    else {
      return {
        success: false,
        error: `Modification type ${modType} not yet implemented. Falling back to text extraction method.`
      };
    }

  } catch (error) {
    console.error("[DIRECT MODIFIER ERROR]", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

async function executeAddOperations(filePath, operations, originalFormat, options) {
  console.log('[ADD EXECUTOR] Starting with', operations.length, 'operations');
  
  switch (originalFormat.toLowerCase()) {
    case 'docx':
      return await executeAddInDocx(filePath, operations, options);
    case 'txt':
    case 'md':
    case 'markdown':
      return await executeAddInText(filePath, operations, options);
    case 'xlsx':
    case 'xls':
      return await executeAddInExcel(filePath, operations, options);
    default:
      return { success: false, error: `ADD not supported for ${originalFormat}` };
  }
}
async function executeAddInDocx(filePath, operations, options) {
  const PizZip = require('pizzip');
  const fsSync = require('fs');
  
  const content = fsSync.readFileSync(filePath, 'binary');
  const zip = new PizZip(content);
  let documentXml = zip.files['word/document.xml'].asText();

  let modificationsApplied = 0;

  for (const op of operations) {
    const newContent = op.content;
    const position = op.position || 'append';
    
    // Create paragraph XML
    let paragraphXml;
    
    if (op.formatting?.type === 'bullet_list') {
      const lines = newContent.split('\n').filter(l => l.trim());
      paragraphXml = lines.map(line => 
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`
      ).join('');
    } else {
      paragraphXml = `<w:p><w:r><w:t>${escapeXml(newContent)}</w:t></w:r></w:p>`;
    }

    // Insert based on position
    if (position === 'append') {
      documentXml = documentXml.replace('</w:body>', paragraphXml + '</w:body>');
      modificationsApplied++;
    } else if (position === 'prepend') {
      documentXml = documentXml.replace('<w:body>', '<w:body>' + paragraphXml);
      modificationsApplied++;
    } else if (position === 'after' && op.anchor) {
      const anchorText = escapeXml(op.anchor);
      const regex = new RegExp(`(<w:t[^>]*>${anchorText}</w:t>.*?</w:p>)`);
      if (regex.test(documentXml)) {
        documentXml = documentXml.replace(regex, '$1' + paragraphXml);
        modificationsApplied++;
      }
    }
  }

  if (modificationsApplied === 0) {
    return { success: false, error: 'No ADD operations applied' };
  }

  zip.file('word/document.xml', documentXml);
  const modifiedBuffer = zip.generate({ type: 'nodebuffer' });
  const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
  await fs.writeFile(outputPath, modifiedBuffer);

  return {
    success: true,
    modifiedFilePath: outputPath,
    originalFormat: 'docx',
    metadata: { method: 'ADD', operationsApplied: modificationsApplied }
  };
}

async function executeAddInText(filePath, operations, options) {
  let content = await fs.readFile(filePath, 'utf-8');
  let modificationsApplied = 0;

  for (const op of operations) {
    const position = op.position || 'append';
    const newContent = op.content;

    if (position === 'append') {
      content += '\n\n' + newContent;
      modificationsApplied++;
    } else if (position === 'prepend') {
      content = newContent + '\n\n' + content;
      modificationsApplied++;
    } else if (position === 'after' && op.anchor) {
      const anchorIndex = content.indexOf(op.anchor);
      if (anchorIndex !== -1) {
        const insertPoint = anchorIndex + op.anchor.length;
        content = content.slice(0, insertPoint) + '\n\n' + newContent + content.slice(insertPoint);
        modificationsApplied++;
      }
    }
  }

  const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
  await fs.writeFile(outputPath, content);

  return {
    success: true,
    modifiedFilePath: outputPath,
    metadata: { method: 'ADD', operationsApplied: modificationsApplied }
  };
}

async function executeAddInExcel(filePath, operations, options) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];

  let modificationsApplied = 0;

  for (const op of operations) {
    // Add row to bottom
    if (op.content.includes('|')) {
      const values = op.content.split('|').map(v => v.trim());
      worksheet.addRow(values);
      modificationsApplied++;
    }
  }

  const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
  await workbook.xlsx.writeFile(outputPath);

  return {
    success: true,
    modifiedFilePath: outputPath,
    metadata: { method: 'ADD', operationsApplied: modificationsApplied }
  };
}

/**
 * Execute DELETE operations
 */
async function executeDeleteOperations(filePath, operations, originalFormat, options) {
  console.log('[DELETE EXECUTOR] Starting with', operations.length, 'operations');
  
  switch (originalFormat.toLowerCase()) {
    case 'docx':
      return await executeDeleteInDocx(filePath, operations, options);
    case 'txt':
    case 'md':
    case 'markdown':
      return await executeDeleteInText(filePath, operations, options);
    default:
      return { success: false, error: `DELETE not supported for ${originalFormat}` };
  }
}

async function executeDeleteInDocx(filePath, operations, options) {
  const PizZip = require('pizzip');
  const fsSync = require('fs');
  
  const content = fsSync.readFileSync(filePath, 'binary');
  const zip = new PizZip(content);
  let documentXml = zip.files['word/document.xml'].asText();

  let modificationsApplied = 0;

  for (const op of operations) {
    const targetText = escapeXml(op.target);
    
    // Delete paragraph containing target text
    const regex = new RegExp(`<w:p>.*?<w:t[^>]*>${escapeRegExp(targetText)}</w:t>.*?</w:p>`, 'g');
    const beforeLength = documentXml.length;
    documentXml = documentXml.replace(regex, '');
    
    if (documentXml.length < beforeLength) {
      modificationsApplied++;
    }
  }

  if (modificationsApplied === 0) {
    return { success: false, error: 'No DELETE operations applied' };
  }

  zip.file('word/document.xml', documentXml);
  const modifiedBuffer = zip.generate({ type: 'nodebuffer' });
  const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
  await fs.writeFile(outputPath, modifiedBuffer);

  return {
    success: true,
    modifiedFilePath: outputPath,
    metadata: { method: 'DELETE', operationsApplied: modificationsApplied }
  };
}

async function executeDeleteInText(filePath, operations, options) {
  let content = await fs.readFile(filePath, 'utf-8');
  let modificationsApplied = 0;

  for (const op of operations) {
    const target = op.target;
    
    if (content.includes(target)) {
      content = content.replace(target, '');
      modificationsApplied++;
    }
  }

  const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
  await fs.writeFile(outputPath, content);

  return {
    success: true,
    modifiedFilePath: outputPath,
    metadata: { method: 'DELETE', operationsApplied: modificationsApplied }
  };
}

/**
 * Execute FORMAT operations (convert to lists, tables, etc.)
 */
async function executeFormatOperations(filePath, operations, originalFormat, options) {
  console.log('[FORMAT EXECUTOR] Starting with', operations.length, 'operations');
    const { executeFormatOperationsDynamic } = require('./documentModifierDynamic');
    try {
    const result = await executeFormatOperationsDynamic(filePath, operations, originalFormat, options);
    
    if (result.success) {
      return result; 
    }
    
    console.log('[FORMAT] Dynamic approach failed, falling back to static...');
  } catch (error) {
    console.error('[FORMAT] Dynamic error:', error);
  }
  
  switch (originalFormat.toLowerCase()) {
    case 'docx':
      return await executeFormatInDocx(filePath, operations, options); 
    case 'txt':
      return await executeFormatInText(filePath, operations, options);
    default:
      return { success: false, error: `FORMAT not supported for ${originalFormat}` };
  }
}

async function executeFormatInDocx(filePath, operations, options) {
  const PizZip = require('pizzip');
  const fsSync = require('fs');
  
  const content = fsSync.readFileSync(filePath, 'binary');
  const zip = new PizZip(content);
  let documentXml = zip.files['word/document.xml'].asText();

  let modificationsApplied = 0;

  for (const op of operations) {
    const sourceText = op.source;
    const transformation = op.transformation;
    const targetContent = op.targetContent;

    if (transformation === 'to_bullet_list' && targetContent) {
      // Convert to bullet list
      const lines = targetContent.split('\n').filter(l => l.trim());
      const listXml = lines.map(line => 
        `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${escapeXml(line.replace(/^[•\-\*]\s*/, ''))}</w:t></w:r></w:p>`
      ).join('');

      // Find and replace the source text paragraph
      const sourceEscaped = escapeXml(sourceText);
      const regex = new RegExp(`<w:p>.*?<w:t[^>]*>${escapeRegExp(sourceEscaped)}</w:t>.*?</w:p>`, 'g');
      
      if (regex.test(documentXml)) {
        documentXml = documentXml.replace(regex, listXml);
        modificationsApplied++;
      }
    }
  }

  if (modificationsApplied === 0) {
    return { success: false, error: 'No FORMAT operations applied' };
  }

  zip.file('word/document.xml', documentXml);
  const modifiedBuffer = zip.generate({ type: 'nodebuffer' });
  const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
  await fs.writeFile(outputPath, modifiedBuffer);

  return {
    success: true,
    modifiedFilePath: outputPath,
    metadata: { method: 'FORMAT', operationsApplied: modificationsApplied }
  };
}

async function executeFormatInText(filePath, operations, options) {
  let content = await fs.readFile(filePath, 'utf-8');
  let modificationsApplied = 0;

  for (const op of operations) {
    const sourceText = op.source;
    const targetContent = op.targetContent;

    if (content.includes(sourceText) && targetContent) {
      content = content.replace(sourceText, targetContent);
      modificationsApplied++;
    }
  }

  const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
  await fs.writeFile(outputPath, content);

  return {
    success: true,
    modifiedFilePath: outputPath,
    metadata: { method: 'FORMAT', operationsApplied: modificationsApplied }
  };
}

/**
 * Execute TRANSFORM operations (AI rewrites content)
 */
async function executeTransformOperations(filePath, operations, originalFormat, options) {
  console.log('[TRANSFORM EXECUTOR] Starting with', operations.length, 'operations');
  
  // Transform is simple: just replace source with target
  const changes = operations.map(op => ({
    find: op.source,
    replace: op.target,
    reason: op.reason || 'Transform operation'
  }));

  // Use existing modify functions
  switch (originalFormat.toLowerCase()) {
    case 'docx':
      return await modifyDocxWithLists(filePath, changes, options);
    case 'txt':
    case 'md':
    case 'markdown':
      return await modifyTextDirectly(filePath, changes, options);
    default:
      return { success: false, error: `TRANSFORM not supported for ${originalFormat}` };
  }
}
async function modifyOpenDocument(filePath, changes, options = {}) {
  const { originalFormat, filename } = options;
  
  console.log('[OPENDOC] Modifying', originalFormat.toUpperCase(), ':', filename);
  
  try {
    const zip = new AdmZip(filePath);
    
    // Get all XML files that might contain text
    const xmlFiles = ['content.xml', 'styles.xml'];
    let modificationsApplied = 0;
    
    for (const xmlFileName of xmlFiles) {
      const entry = zip.getEntry(xmlFileName);
      if (!entry) {
        console.log(`[OPENDOC] ${xmlFileName} not found, skipping...`);
        continue;
      }
      
      let xmlContent = entry.getData().toString('utf8');
      const originalXml = xmlContent;
            for (const change of changes) {
        const findText = change.find.trim();
        const replaceText = change.replace.trim();
        
        const escapedFind = escapeXml(findText);
        const escapedReplace = escapeXml(replaceText);
        
        if (xmlContent.includes(escapedFind)) {
          const regex = new RegExp(escapeRegExp(escapedFind), 'g');
          xmlContent = xmlContent.replace(regex, escapedReplace);
          modificationsApplied++;
          console.log(`[OPENDOC] ✓ Applied in ${xmlFileName}:`, change.reason || findText);
        } else {
          if (xmlContent.includes(findText)) {
            const regex = new RegExp(escapeRegExp(findText), 'g');
            xmlContent = xmlContent.replace(regex, replaceText);
            modificationsApplied++;
            console.log(`[OPENDOC] ✓ Applied (unescaped) in ${xmlFileName}:`, change.reason || findText);
          }
        }
      }
            if (xmlContent !== originalXml) {
        zip.updateFile(xmlFileName, Buffer.from(xmlContent, 'utf8'));
        console.log(`[OPENDOC] Updated ${xmlFileName}`);
      }
    }
    
    if (modificationsApplied === 0) {
      console.error('[OPENDOC] No matching text found in document');
      return {
        success: false,
        error: 'No matching text found in document. Please check if the text exists.'
      };
    }
    
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    zip.writeZip(outputPath);
    
    console.log(`[OPENDOC] ✓ Successfully modified ${modificationsApplied} locations`);
    console.log(`[OPENDOC] ✓ Saved to: ${outputPath}`);
    
    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat,
      metadata: {
        method: 'opendocument_xml_modification',
        changesApplied: modificationsApplied,
        preservedStructure: true,
        preservedFormatting: true
      }
    };
    
  } catch (error) {
    console.error('[OPENDOC ERROR]', error);
    return {
      success: false,
      error: `OpenDocument modification failed: ${error.message}`
    };
  }
}

async function modifyOpenDocumentAdvanced(filePath, changes, options = {}) {
  const { originalFormat, filename } = options;
  
  console.log('[OPENDOC ADVANCED] Modifying', originalFormat.toUpperCase(), ':', filename);
  
  try {
    const zip = new AdmZip(filePath);
    const contentEntry = zip.getEntry('content.xml');
    
    if (!contentEntry) {
      throw new Error('content.xml not found in OpenDocument file');
    }
    
    let contentXml = contentEntry.getData().toString('utf8');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(contentXml, 'text/xml');
    
    let modificationsApplied = 0;
    
    // Get all text elements based on format
    const textTags = {
      odt: ['text:p', 'text:h', 'text:span'],
      odp: ['text:p', 'text:span'],
      ods: ['text:p', 'table:table-cell']
    };
    
    const tags = textTags[originalFormat.toLowerCase()] || textTags.odt;
    
    for (const tag of tags) {
      const elements = xmlDoc.getElementsByTagName(tag);
      
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        
        for (const change of changes) {
          if (modifyElementText(element, change.find.trim(), change.replace.trim())) {
            modificationsApplied++;
            console.log(`[OPENDOC ADVANCED] ✓ Modified <${tag}>:`, change.reason || change.find);
          }
        }
      }
    }
    
    if (modificationsApplied === 0) {
      return {
        success: false,
        error: 'No matching text found in document'
      };
    }
    
    // Serialize back to XML
    const serializer = new XMLSerializer();
    const modifiedXml = serializer.serializeToString(xmlDoc);
    
    // Update ZIP
    zip.updateFile('content.xml', Buffer.from(modifiedXml, 'utf8'));
    
    // Also check and update styles.xml if needed
    const stylesEntry = zip.getEntry('styles.xml');
    if (stylesEntry) {
      let stylesXml = stylesEntry.getData().toString('utf8');
      const stylesDoc = parser.parseFromString(stylesXml, 'text/xml');
      
      for (const tag of tags) {
        const elements = stylesDoc.getElementsByTagName(tag);
        
        for (let i = 0; i < elements.length; i++) {
          const element = elements[i];
          
          for (const change of changes) {
            if (modifyElementText(element, change.find.trim(), change.replace.trim())) {
              modificationsApplied++;
            }
          }
        }
      }
      
      const modifiedStyles = serializer.serializeToString(stylesDoc);
      zip.updateFile('styles.xml', Buffer.from(modifiedStyles, 'utf8'));
    }
    
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    zip.writeZip(outputPath);
    
    console.log(`[OPENDOC ADVANCED] ✓ Successfully modified ${modificationsApplied} locations`);
    
    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat,
      metadata: {
        method: 'opendocument_dom_modification',
        changesApplied: modificationsApplied,
        preservedStructure: true,
        preservedFormatting: true
      }
    };
    
  } catch (error) {
    console.error('[OPENDOC ADVANCED ERROR]', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Recursively modifies text in XML element nodes
 */
function modifyElementText(element, findText, replaceText) {
  let modified = false;
  
  if (element.childNodes) {
    for (let i = 0; i < element.childNodes.length; i++) {
      const node = element.childNodes[i];
      
      if (node.nodeType === 3) { // Text node
        if (node.nodeValue && node.nodeValue.includes(findText)) {
          node.nodeValue = node.nodeValue.replace(
            new RegExp(escapeRegExp(findText), 'g'),
            replaceText
          );
          modified = true;
        }
      } else {
        // Recursive search in child elements
        if (modifyElementText(node, findText, replaceText)) {
          modified = true;
        }
      }
    }
  }
  
  return modified;
}

// ============================================================================
// HANDLER 2: TEXT-BASED FORMATS (CSV, TSV, HTML, XML, JSON, etc.)
// ============================================================================

async function modifyTextBasedFormat(
  filePath,
  userRequest,
  OPENAI_API_KEY,
  options = {}
) {
  const { originalFormat, filename } = options;

  console.log("[TEXT-BASED MODIFIER]", {
    format: originalFormat,
    file: filename,
  });

  try {
    // Read file as text
    let content = await fs.readFile(filePath, "utf-8");

    // Get AI instructions
    const instructions = await getModificationInstructions(
      content,
      userRequest,
      OPENAI_API_KEY
    );

    if (!instructions.changes || instructions.changes.length === 0) {
      return {
        success: false,
        error: instructions.explanation || "No modifications identified",
      };
    }

    // Validate changes
    const { validated, errors } = validateChanges(
      content,
      instructions.changes
    );

    if (validated.length === 0) {
      return {
        success: false,
        error: "No valid changes found in document",
      };
    }

    // Apply all changes
    let modifiedContent = content;
    let changesApplied = 0;

    for (const change of validated) {
      const findText = change.find.trim();
      const replaceText = change.replace.trim();

      if (modifiedContent.includes(findText)) {
        modifiedContent = modifiedContent.replace(findText, replaceText);
        changesApplied++;
        console.log("[TEXT-BASED] Applied:", change.reason);
      }
    }

    if (changesApplied === 0) {
      return {
        success: false,
        error: "No changes were applied (text not found)",
      };
    }

    // For JSON/XML, validate syntax
    if (originalFormat === "json") {
      try {
        JSON.parse(modifiedContent);
      } catch (e) {
        console.warn(
          "[JSON VALIDATION] Invalid JSON after modification, attempting fix..."
        );
        modifiedContent = modifiedContent.trim();
      }
    }

    // Save modified file
    const outputPath = filePath.replace(/(\.[^.]+)$/, "_modified$1");
    await fs.writeFile(outputPath, modifiedContent, "utf-8");

    console.log("[TEXT-BASED] ✓ Saved:", outputPath);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat,
      metadata: {
        method: "text_based_modification",
        changesApplied,
        preservedStructure: true,
      },
    };
  } catch (error) {
    console.error("[TEXT-BASED ERROR]", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// HANDLER 3: COMPLEX FORMATS (PDF, PPTX - Extract → Modify → Export)
// ============================================================================

async function modifyComplexFormat(
  filePath,
  userRequest,
  OPENAI_API_KEY,
  options = {}
) {
  const { originalFormat, filename } = options;
  const { exportFile } = require("../fileGenerators");

  console.log("[COMPLEX MODIFIER]", { format: originalFormat, file: filename });

  try {
    // STEP 1: Extract text
    console.log("[COMPLEX] Step 1: Extracting text...");
    const extractedText = await extractTextForAnalysis(
      filePath,
      originalFormat
    );

    if (!extractedText || extractedText.trim().length < 10) {
      return {
        success: false,
        error: "Could not extract text from document",
      };
    }

    // STEP 2: Modify with AI
    console.log("[COMPLEX] Step 2: Modifying content...");
    const modifiedText = await getAIModificationForComplex(
      extractedText,
      userRequest,
      OPENAI_API_KEY,
      originalFormat
    );

    // STEP 3: Export back to original format
    console.log("[COMPLEX] Step 3: Exporting to", originalFormat);
    const exportResult = await exportFile(
      modifiedText,
      "temp_session",
      filename.replace(/\.[^/.]+$/, ""),
      originalFormat
    );

    if (!exportResult || !exportResult.url) {
      throw new Error("Export failed");
    }

    const exportedFilePath = path.join(
      __dirname,
      "..",
      exportResult.url.replace(/^\//, "")
    );

    if (!fsSync.existsSync(exportedFilePath)) {
      throw new Error(`Exported file not found: ${exportedFilePath}`);
    }

    const uploadDir = path.join(__dirname, "..", "uploads");
    const finalFileName = `${Date.now()}-${filename.replace(
      /\.[^/.]+$/,
      ""
    )}_modified.${originalFormat}`;
    const outputPath = path.join(uploadDir, finalFileName);

    await fs.copyFile(exportedFilePath, outputPath);
    await fs.unlink(exportedFilePath);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat,
      metadata: {
        method: "extract_modify_export",
        preservedStructure: false,
        note: `Original ${originalFormat.toUpperCase()} formatting may be partially lost.`,
      },
    };
  } catch (error) {
    console.error("[COMPLEX ERROR]", error);
    return {
      success: false,
      error: `Complex format modification failed: ${error.message}`,
    };
  }
}

// ============================================================================
// AI MODIFICATION FOR COMPLEX FORMATS
// ============================================================================

async function getAIModificationForComplex(
  content,
  userRequest,
  apiKey,
  format
) {
  const fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));

  const prompt = `You are modifying content extracted from a ${format.toUpperCase()} file.

USER REQUEST: "${userRequest}"

ORIGINAL CONTENT:
${content}

INSTRUCTIONS:
1. Apply the requested modifications
2. Return the COMPLETE modified content
3. Do not truncate or summarize
4. Maintain readability and structure

OUTPUT THE MODIFIED CONTENT:`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a document editor. Return complete modified content for ${format} files.`,
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: Math.max(content.length * 1.5, 4000),
    }),
  });

  const data = await response.json();
  let modified = data.choices?.[0]?.message?.content?.trim() || content;

  // Clean markdown artifacts
  modified = modified.replace(/```[a-z]*\n?/g, "").trim();

  return modified;
}

// ============================================================================
// DOCX MODIFIER (EXISTING CODE)
// ============================================================================

async function modifyDocxWithLists(filePath, changes, options) {
  try {
    const content = fsSync.readFileSync(filePath, "binary");
    const zip = new PizZip(content);
    let documentXml = zip.files["word/document.xml"].asText();

    // Create a deep copy of the document for comparison
    const originalXml = documentXml;

    // Apply changes
    let changesApplied = 0;

    for (const change of changes) {
      const findText = change.find.trim();
      const replaceText = change.replace.trim();
      const scope = change.scope || "global";

      // Check if this is a list/bullet change
      const hasBullets = /^[•\-*]\s+/m.test(replaceText);
      const hasNumbering = /^\d+\.\s+/m.test(replaceText);

      if (hasBullets || hasNumbering) {
        // Handle list conversion
        const { heading, listItems, isNumbered } = parseListText(replaceText);
        const result = replaceSectionWithList(
          documentXml,
          findText,
          heading,
          listItems,
          isNumbered
        );

        if (result.success) {
          documentXml = result.content;
          changesApplied++;
        } else {
          // Fall back to text replacement
          documentXml = replaceTextInDocument(
            documentXml,
            findText,
            replaceText,
            scope
          );
          changesApplied++;
        }
      } else {
        // Regular text replacement
        documentXml = replaceTextInDocument(
          documentXml,
          findText,
          replaceText,
          scope
        );
        changesApplied++;
      }
    }

    // Ensure numbering XML exists if needed
    if (documentXml.includes("<w:numPr>") && !zip.files["word/numbering.xml"]) {
      zip.file("word/numbering.xml", createNumberingXml());

      // Update document relationships if needed
      if (zip.files["word/_rels/document.xml.rels"]) {
        let relsXml = zip.files["word/_rels/document.xml.rels"].asText();
        if (!relsXml.includes("numbering.xml")) {
          const maxId = Math.max(
            ...(Array.from(relsXml.matchAll(/Id="rId(\d+)"/g), (m) =>
              parseInt(m[1])
            ) || [0])
          );
          const newId = maxId + 1;
          const newRel = `<Relationship Id="rId${newId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`;
          relsXml = relsXml.replace(
            "</Relationships>",
            newRel + "</Relationships>"
          );
          zip.file("word/_rels/document.xml.rels", relsXml);
        }
      }
    }

    // Save the modified document
    zip.file("word/document.xml", documentXml);
    const modifiedBuffer = zip.generate({ type: "nodebuffer" });
    const outputPath = filePath.replace(/(\.[^.]+)$/, "_modified$1");
    await fs.writeFile(outputPath, modifiedBuffer);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: "docx",
      metadata: {
        method: "enhanced_docx_modification",
        changesApplied,
        preservedTables: true,
        preservedLists: true,
      },
    };
  } catch (error) {
    console.error("[DOCX MODIFICATION ERROR]", error);
    return {
      success: false,
      error: `DOCX modification failed: ${error.message}`,
    };
  }
}

function replaceTextInDocument(documentXml, findText, replaceText, scope) {
  // Find all text nodes in the document, including those in tables
  const textNodeRegex = /(<w:t[^>]*>)([^<]+)(<\/w:t>)/g;

  return documentXml.replace(
    textNodeRegex,
    (match, openTag, textContent, closeTag) => {
      const decodedText = decodeXml(textContent);

      if (decodedText.includes(findText)) {
        const replacedText =
          scope === "global"
            ? decodedText.replace(
                new RegExp(escapeRegExp(findText), "gi"),
                replaceText
              )
            : decodedText.replace(findText, replaceText);

        return openTag + escapeXml(replacedText) + closeTag;
      }

      return match;
    }
  );
}

function replaceSectionWithList(
  documentXml,
  findText,
  heading,
  listItems,
  isNumbered
) {
  // Extract paragraphs from the document
  const paragraphs = [];
  const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let match;

  while ((match = paragraphRegex.exec(documentXml)) !== null) {
    paragraphs.push({
      xml: match[0],
      text: extractTextFromParagraph(match[0]),
    });
  }

  // Find the paragraph(s) containing the findText
  const findTextLower = findText.toLowerCase();
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].text.toLowerCase().includes(findTextLower)) {
      startIdx = i;
      // Look ahead to find the end of this section
      for (let j = i + 1; j < Math.min(i + 10, paragraphs.length); j++) {
        if (paragraphs[j].text.trim().length === 0) {
          endIdx = j - 1;
          break;
        }
      }
      if (endIdx === -1) endIdx = Math.min(i + 5, paragraphs.length - 1);
      break;
    }
  }

  if (startIdx === -1) {
    return { success: false, content: documentXml };
  }

  // Generate list XML
  let listXml = "";

  if (heading) {
    heading.split("\n").forEach((line) => {
      listXml += `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
        line
      )}</w:t></w:r></w:p>`;
    });
  }

  listItems.forEach((item) => {
    listXml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${
      isNumbered ? "2" : "1"
    }"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
      item
    )}</w:t></w:r></w:p>`;
  });

  // Reconstruct the document with the list
  const beforeSection = documentXml.substring(
    0,
    getParagraphPosition(documentXml, startIdx)
  );
  const afterSection = documentXml.substring(
    getParagraphPosition(documentXml, endIdx + 1)
  );

  return {
    success: true,
    content: beforeSection + listXml + afterSection,
  };
}

function getParagraphPosition(documentXml, paragraphIndex) {
  const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let position = 0;
  let count = 0;
  let match;

  while (
    (match = paragraphRegex.exec(documentXml)) !== null &&
    count < paragraphIndex
  ) {
    position = match.index + match[0].length;
    count++;
  }

  return position;
}

function extractTextFromParagraph(paragraphXml) {
  const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let text = "";
  let match;

  while ((match = textRegex.exec(paragraphXml)) !== null) {
    text += decodeXml(match[1]);
  }

  return text;
}

// Helper functions
function escapeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseListText(text) {
  const lines = text.split("\n");
  const listItems = [];
  let heading = "";
  let inHeading = true;
  let isNumbered = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^[•\-*]\s+/.test(trimmed)) {
      inHeading = false;
      const content = trimmed.replace(/^[•\-*]\s+/, "").trim();
      if (content) listItems.push(content);
    } else if (/^\d+\.\s+/.test(trimmed)) {
      inHeading = false;
      isNumbered = true;
      const content = trimmed.replace(/^\d+\.\s+/, "").trim();
      if (content) listItems.push(content);
    } else if (inHeading) {
      heading += (heading ? "\n" : "") + trimmed;
    }
  }

  return { heading, listItems, isNumbered };
}

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
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

// ============================================================================
// EXCEL MODIFIER (EXISTING CODE)
// ============================================================================

async function modifyExcelDirectly(filePath, changes, options = {}) {
  try {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    let changesApplied = 0;

    // Helper: find table (your export creates one)
    const table = worksheet.getTables()[0];

    for (const change of changes) {
      const findText = change.find?.trim();
      const replaceText = change.replace?.trim();

      /**
       * ✅ CASE 1: ADD ROW TO TABLE (Q5 | 3.0 | 1.8 | 1.2)
       */
      const rowMatch = replaceText?.match(
        /(Q\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/
      );

      if (rowMatch && table) {
        const [, quarter, revenue, expenses, profit] = rowMatch;

        // Prevent duplicates
        const existingRows = table.table.rows;
        const alreadyExists = existingRows.some(
          (r) => String(r[0]).trim() === quarter
        );
        if (alreadyExists) continue;

        table.addRow([
          quarter,
          Number(revenue),
          Number(expenses),
          Number(profit),
        ]);

        changesApplied++;
        continue;
      }

      /**
       * ✅ CASE 2: NORMAL TEXT REPLACEMENT (preserve styles)
       */
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (typeof cell.value === "string" && cell.value.includes(findText)) {
            cell.value = cell.value.replace(findText, replaceText);
            changesApplied++;
          }
        });
      });
    }

    const outputPath = filePath.replace(/(\.[^.]+)$/, "_modified$1");
    if (options.originalFormat === "xls") {
      const tempXlsxPath = outputPath.replace(".xls", ".temp.xlsx");
      await workbook.xlsx.writeFile(tempXlsxPath);

      const wb = XLSX.readFile(tempXlsxPath);
      XLSX.writeFile(wb, outputPath, { bookType: "xls", compression: true });

      await fs.unlink(tempXlsxPath);
    } else {
      await workbook.xlsx.writeFile(outputPath);
    }

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: options.originalFormat || "xlsx",
      metadata: {
        changesApplied,
        engine: "exceljs",
        formatPreserved: true,
      },
    };
  } catch (error) {
    console.error("[EXCEL MODIFY ERROR]", error);
    return { success: false, error: error.message };
  }
}

async function modifyTextDirectly(filePath, changes, options) {
  try {
    let content = await fs.readFile(filePath, "utf-8");
    let changesApplied = 0;

    for (const change of changes) {
      const findText = change.find;
      const replaceText = change.replace;
      const scope = change.scope || "global";

      if (scope === "global") {
        const regex = new RegExp(
          findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "g"
        );
        content = content.replace(regex, replaceText);
      } else {
        content = content.replace(findText, replaceText);
      }

      changesApplied++;
    }

    const outputPath = filePath.replace(/(\.[^.]+)$/, "_modified$1");
    await fs.writeFile(outputPath, content);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: options.originalFormat || "txt",
      metadata: { changesApplied },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
module.exports = {
  modifyDocumentEnhanced,
  isFormatModifiable,
  getModificationStrategy,
  MODIFIABLE_FORMATS,
  modifyOpenDocument,
  modifyOpenDocumentAdvanced,
    executeAddOperations,
  executeDeleteOperations,
  executeFormatOperations,
  executeTransformOperations
};