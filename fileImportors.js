// fileImporters.js - COMPLETE IMPORT SYSTEM
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const Tesseract = require('tesseract.js');
const { parse: parseCSV } = require('csv-parse/sync');
const AdmZip = require('adm-zip');
const xml2js = require('xml2js');

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Clean extracted text from files
 */
function cleanExtractedText(text) {
  return (text || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Chunk large text for AI processing
 */
function chunkText(text, chunkSize = 5000) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Summarize chunk with OpenAI (for large files)
 */
async function summarizeChunkWithAI(chunk, filename, chunkIndex, totalChunks, OPENAI_API_KEY) {
  const prompt = `
You are an expert document analyst. Summarize this section concisely, keeping all important details, numbers, and facts.

[${filename} - Section ${chunkIndex}/${totalChunks}]

${chunk}
  `.trim();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: prompt }],
      max_tokens: 512
    })
  });

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// ============================================================================
// CORE IMPORT HANDLERS
// ============================================================================

/**
 * Import PDF files
 */
async function importPDF(filePath, options = {}) {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    
    let extracted = cleanExtractedText(data.text || '');
    
    // Handle large PDFs with summarization
    if (options.summarize && extracted.length > 20000) {
      const chunks = chunkText(extracted, 5000);
      const summaries = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const summary = await summarizeChunkWithAI(
          chunks[i],
          options.filename || 'document.pdf',
          i + 1,
          chunks.length,
          options.OPENAI_API_KEY
        );
        summaries.push(summary);
      }
      
      extracted = summaries.join('\n\n');
    }
    
    return {
      success: true,
      content: extracted,
      metadata: {
        pages: data.numpages,
        info: data.info,
        filename: options.filename
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `PDF import failed: ${error.message}`
    };
  }
}

/**
 * Import Word documents (.doc, .docx)
 */
async function importWord(filePath, options = {}) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    let extracted = cleanExtractedText(result.value || '');
    
    if (options.summarize && extracted.length > 20000) {
      const chunks = chunkText(extracted, 5000);
      const summaries = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const summary = await summarizeChunkWithAI(
          chunks[i],
          options.filename || 'document.docx',
          i + 1,
          chunks.length,
          options.OPENAI_API_KEY
        );
        summaries.push(summary);
      }
      
      extracted = summaries.join('\n\n');
    }
    
    return {
      success: true,
      content: extracted,
      metadata: {
        messages: result.messages,
        filename: options.filename
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Word import failed: ${error.message}`
    };
  }
}

/**
 * Import Excel files (.xls, .xlsx)
 */
async function importExcel(filePath, options = {}) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheets = {};
    let combinedContent = '';
    
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON for structured data
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // Convert to CSV-like text
      const csvText = XLSX.utils.sheet_to_csv(worksheet);
      
      sheets[sheetName] = {
        json: jsonData,
        csv: csvText
      };
      
      combinedContent += `\n\n[Sheet: ${sheetName}]\n${csvText}`;
    });
    
    return {
      success: true,
      content: combinedContent.trim(),
      structured: sheets,
      metadata: {
        sheetCount: workbook.SheetNames.length,
        sheetNames: workbook.SheetNames,
        filename: options.filename
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Excel import failed: ${error.message}`
    };
  }
}

/**
 * Import CSV files
 */
async function importCSV(filePath, options = {}) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    // Parse CSV
    const records = parseCSV(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    
    // Convert to readable text
    let textContent = '';
    if (records.length > 0) {
      const headers = Object.keys(records[0]);
      textContent = headers.join(', ') + '\n\n';
      
      records.forEach(row => {
        textContent += headers.map(h => row[h] || '').join(', ') + '\n';
      });
    }
    
    return {
      success: true,
      content: textContent.trim(),
      structured: records,
      metadata: {
        rowCount: records.length,
        filename: options.filename
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `CSV import failed: ${error.message}`
    };
  }
}

/**
 * Import TSV files
 */
async function importTSV(filePath, options = {}) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    
    const records = parseCSV(fileContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter: '\t'
    });
    
    let textContent = '';
    if (records.length > 0) {
      const headers = Object.keys(records[0]);
      textContent = headers.join('\t') + '\n\n';
      
      records.forEach(row => {
        textContent += headers.map(h => row[h] || '').join('\t') + '\n';
      });
    }
    
    return {
      success: true,
      content: textContent.trim(),
      structured: records,
      metadata: {
        rowCount: records.length,
        filename: options.filename
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `TSV import failed: ${error.message}`
    };
  }
}

/**
 * Import PowerPoint files (.ppt, .pptx)
 */
async function importPowerPoint(filePath, options = {}) {
  try {
    // For PPTX, we can use officeparser or similar library
    // For now, placeholder implementation
    return {
      success: true,
      content: `PowerPoint file: ${options.filename}\n[PowerPoint import requires additional library]`,
      metadata: {
        filename: options.filename,
        note: 'Full PowerPoint parsing requires officeparser library'
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `PowerPoint import failed: ${error.message}`
    };
  }
}

/**
 * Import images with OCR
 */
async function importImage(filePath, options = {}) {
  try {
    const imageBuffer = fs.readFileSync(filePath);
    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
    
    const extracted = cleanExtractedText(text || '');
    
    return {
      success: true,
      content: extracted,
      metadata: {
        filename: options.filename,
        method: 'OCR'
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Image import failed: ${error.message}`
    };
  }
}

/**
 * Import text files
 */
async function importText(filePath, options = {}) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const cleaned = cleanExtractedText(content);
    
    return {
      success: true,
      content: cleaned,
      metadata: {
        filename: options.filename
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `Text import failed: ${error.message}`
    };
  }
}

/**
 * Import RTF files
 */
async function importRTF(filePath, options = {}) {
  try {
    // RTF requires specific parser, for now treat as text
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Basic RTF tag removal
    let cleaned = content
      .replace(/\\[a-z]+[0-9]*\s?/g, ' ')
      .replace(/[{}]/g, '')
      .replace(/\\/g, '');
    
    cleaned = cleanExtractedText(cleaned);
    
    return {
      success: true,
      content: cleaned,
      metadata: {
        filename: options.filename,
        note: 'Basic RTF parsing - formatting may be lost'
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `RTF import failed: ${error.message}`
    };
  }
}

/**
 * Import HTML files
 */
async function importHTML(filePath, options = {}) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Strip HTML tags for text content
    let text = content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-z]+;/gi, ' ');
    
    text = cleanExtractedText(text);
    
    return {
      success: true,
      content: text,
      rawHTML: content,
      metadata: {
        filename: options.filename
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `HTML import failed: ${error.message}`
    };
  }
}

/**
 * Import XML files
 */
async function importXML(filePath, options = {}) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parser = new xml2js.Parser();
    
    const result = await parser.parseStringPromise(content);
    const jsonString = JSON.stringify(result, null, 2);
    
    return {
      success: true,
      content: jsonString,
      structured: result,
      metadata: {
        filename: options.filename
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `XML import failed: ${error.message}`
    };
  }
}

/**
 * Import ZIP files (extracts and processes contents)
 */
async function importZIP(filePath, options = {}) {
  try {
    const zip = new AdmZip(filePath);
    const zipEntries = zip.getEntries();
    
    const contents = [];
    const tempDir = path.join(path.dirname(filePath), 'temp_extracted');
    
    // Create temp directory
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Extract all files
    zip.extractAllTo(tempDir, true);
    
    // Process each file
    for (const entry of zipEntries) {
      if (!entry.isDirectory) {
        const extractedPath = path.join(tempDir, entry.entryName);
        const ext = path.extname(entry.entryName).toLowerCase();
        
        let fileResult = null;
        
        switch (ext) {
          case '.pdf':
            fileResult = await importPDF(extractedPath, { ...options, filename: entry.entryName });
            break;
          case '.docx':
          case '.doc':
            fileResult = await importWord(extractedPath, { ...options, filename: entry.entryName });
            break;
          case '.xlsx':
          case '.xls':
            fileResult = await importExcel(extractedPath, { ...options, filename: entry.entryName });
            break;
          case '.csv':
            fileResult = await importCSV(extractedPath, { ...options, filename: entry.entryName });
            break;
          case '.txt':
            fileResult = await importText(extractedPath, { ...options, filename: entry.entryName });
            break;
          default:
            fileResult = { success: false, error: 'Unsupported file type in ZIP' };
        }
        
        if (fileResult && fileResult.success) {
          contents.push({
            filename: entry.entryName,
            content: fileResult.content
          });
        }
      }
    }
    
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    
    // Combine all contents
    const combinedContent = contents
      .map(c => `\n[File: ${c.filename}]\n${c.content}`)
      .join('\n\n');
    
    return {
      success: true,
      content: combinedContent,
      files: contents,
      metadata: {
        fileCount: contents.length,
        filename: options.filename
      }
    };
  } catch (error) {
    return {
      success: false,
      error: `ZIP import failed: ${error.message}`
    };
  }
}

// ============================================================================
// MAIN IMPORT ROUTER
// ============================================================================

/**
 * Main import function - routes to appropriate handler
 */
async function importFile(filePath, mimeType, originalName, options = {}) {
  const ext = path.extname(originalName).toLowerCase();
  
  // Add filename to options
  options.filename = originalName;
  
  console.log(`[IMPORT] Processing: ${originalName} (${mimeType})`);
  
  // Route to appropriate handler
  switch (ext) {
    case '.pdf':
      return await importPDF(filePath, options);
      
    case '.docx':
    case '.doc':
      return await importWord(filePath, options);
      
    case '.xlsx':
    case '.xls':
      return await importExcel(filePath, options);
      
    case '.csv':
      return await importCSV(filePath, options);
      
    case '.tsv':
      return await importTSV(filePath, options);
      
    case '.pptx':
    case '.ppt':
      return await importPowerPoint(filePath, options);
      
    case '.txt':
      return await importText(filePath, options);
      
    case '.rtf':
      return await importRTF(filePath, options);
      
    case '.html':
    case '.htm':
      return await importHTML(filePath, options);
      
    case '.xml':
      return await importXML(filePath, options);
      
    case '.zip':
      return await importZIP(filePath, options);
      
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif':
    case '.bmp':
    case '.tiff':
      return await importImage(filePath, options);
      
    default:
      // Try as text file
      if (mimeType && mimeType.startsWith('text/')) {
        return await importText(filePath, options);
      }
      
      return {
        success: false,
        error: `Unsupported file format: ${ext}`
      };
  }
}

/**
 * Process multiple files
 */
async function importMultipleFiles(files, options = {}) {
  const results = [];
  const MAX_TOTAL_CHARS = options.maxTotalChars || 80000;
  let totalChars = 0;
  
  for (const file of files) {
    const result = await importFile(file.path, file.mimetype, file.originalname, options);
    
    if (result.success) {
      const content = result.content || '';
      const withLabel = `\n[${file.originalname}]\n${content}\n`;
      
      // Extract file format
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      
      if (totalChars + withLabel.length > MAX_TOTAL_CHARS) {
        const allowed = MAX_TOTAL_CHARS - totalChars;
        if (allowed > 0) {
          results.push({
            filename: file.originalname,
            content: withLabel.slice(0, allowed),
            truncated: true,
            format: ext,  // ADD FORMAT
            structured: result.structured, // ADD STRUCTURED DATA
            metadata: result.metadata
          });
          totalChars += allowed;
        }
        break;
      } else {
        results.push({
          filename: file.originalname,
          content: withLabel,
          contentLength: content.length,
          format: ext,  // ADD FORMAT
          structured: result.structured, // ADD STRUCTURED DATA
          metadata: result.metadata
        });
        totalChars += withLabel.length;
      }
    } else {
      console.error(`[IMPORT ERROR] ${file.originalname}: ${result.error}`);
    }
  }
  
  return {
    combined: results.map(r => r.content).join('\n\n'),
    files: results,
    totalChars
  };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  importFile,
  importMultipleFiles,
  cleanExtractedText,
  chunkText,
  summarizeChunkWithAI
};