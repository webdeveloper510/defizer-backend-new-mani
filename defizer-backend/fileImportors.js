// utils/fileImporter.js - COMPLETE IMPORT HANDLER FOR ALL EXPORT FORMATS

const mammoth = require('mammoth');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { parseStringPromise } = require('xml2js');

/**
 * Main import function - handles ALL formats from your export system
 */
async function importFile(filePath, originalFormat) {
  const format = originalFormat.toLowerCase();
  
  console.log('[IMPORT] Processing:', { filePath, format });

  try {
    switch(format) {
      // ===== OFFICE DOCUMENTS =====
      case 'docx':
      case 'doc':
        return await importWord(filePath);
      
      case 'xlsx':
      case 'xls':
      case 'ods':
        return await importSpreadsheet(filePath, format);
      
      case 'pptx':
      case 'ppt':
      case 'odp':
        return await importPresentation(filePath, format);
      
      case 'pdf':
        return await importPDF(filePath);
      
      case 'odt':
        return await importODT(filePath);
      
      case 'rtf':
        return await importRTF(filePath);
      
      // ===== TEXT FORMATS =====
      case 'txt':
      case 'md':
      case 'markdown':
        return await importText(filePath);
      
      case 'csv':
        return await importCSV(filePath);
      
      case 'tsv':
        return await importTSV(filePath);
      
      // ===== WEB FORMATS =====
      case 'html':
      case 'htm':
        return await importHTML(filePath);
      
      case 'xml':
        return await importXML(filePath);
      
      // ===== IMAGES =====
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'bmp':
      case 'tiff':
        return await importImage(filePath, format);
      
      // ===== ARCHIVES =====
      case 'zip':
        return await importZIP(filePath);
      
      case 'rar':
      case '7z':
      case 'tar.gz':
        return await importArchive(filePath, format);
      
      // ===== SPECIAL FORMATS =====
      case 'ics':
        return await importICS(filePath);
      
      case 'vcf':
        return await importVCF(filePath);
      
      case 'eml':
      case 'msg':
      case 'mbox':
        return await importEmail(filePath, format);
      
      default:
        return {
          success: false,
          error: `Unsupported import format: ${format}`
        };
    }
  } catch (error) {
    console.error('[IMPORT ERROR]', error);
    return {
      success: false,
      error: error.message,
      extractedText: '',
      metadata: {}
    };
  }
}

// ============================================================================
// OFFICE DOCUMENT IMPORTERS
// ============================================================================

async function importWord(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    const htmlResult = await mammoth.convertToHtml({ path: filePath });
    
    return {
      success: true,
      extractedText: result.value,
      htmlContent: htmlResult.value,
      format: 'docx',
      metadata: {
        type: 'word_document',
        hasFormatting: true
      }
    };
  } catch (error) {
    throw new Error(`Word import failed: ${error.message}`);
  }
}

async function importSpreadsheet(filePath, format) {
  try {
    const workbook = XLSX.readFile(filePath);
    const sheets = {};
    let allText = '';
    
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      
      // Get as JSON for structured data
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      sheets[sheetName] = jsonData;
      
      // Get as text
      const sheetText = jsonData.map(row => row.join('\t')).join('\n');
      allText += `\n=== ${sheetName} ===\n${sheetText}\n`;
    });
    
    return {
      success: true,
      extractedText: allText,
      structuredData: sheets,
      format: format,
      metadata: {
        type: 'spreadsheet',
        sheetCount: workbook.SheetNames.length,
        sheetNames: workbook.SheetNames
      }
    };
  } catch (error) {
    throw new Error(`Spreadsheet import failed: ${error.message}`);
  }
}

async function importPresentation(filePath, format) {
  try {
    // For PPTX, extract text from slides
    if (format === 'pptx') {
      const zip = new AdmZip(filePath);
      const entries = zip.getEntries();
      let slideTexts = [];
      
      entries.forEach(entry => {
        if (entry.entryName.match(/ppt\/slides\/slide\d+\.xml/)) {
          const content = entry.getData().toString('utf8');
          // Extract text between <a:t> tags
          const texts = content.match(/<a:t>(.*?)<\/a:t>/g) || [];
          const slideText = texts.map(t => t.replace(/<\/?a:t>/g, '')).join(' ');
          if (slideText) slideTexts.push(slideText);
        }
      });
      
      return {
        success: true,
        extractedText: slideTexts.join('\n\n'),
        format: format,
        metadata: {
          type: 'presentation',
          slideCount: slideTexts.length
        }
      };
    }
    
    // Fallback for other formats
    return {
      success: true,
      extractedText: 'Presentation file (text extraction limited)',
      format: format,
      metadata: { type: 'presentation' }
    };
  } catch (error) {
    throw new Error(`Presentation import failed: ${error.message}`);
  }
}

async function importPDF(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse(buffer);
    
    return {
      success: true,
      extractedText: data.text,
      format: 'pdf',
      metadata: {
        type: 'pdf',
        pages: data.numpages,
        info: data.info
      }
    };
  } catch (error) {
    throw new Error(`PDF import failed: ${error.message}`);
  }
}

async function importODT(filePath) {
  try {
    // ODT is a ZIP containing XML
    const zip = new AdmZip(filePath);
    const contentXml = zip.getEntry('content.xml');
    
    if (contentXml) {
      const content = contentXml.getData().toString('utf8');
      // Basic text extraction - remove XML tags
      const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      
      return {
        success: true,
        extractedText: text,
        format: 'odt',
        metadata: { type: 'opendocument_text' }
      };
    }
    
    throw new Error('Could not find content.xml in ODT file');
  } catch (error) {
    throw new Error(`ODT import failed: ${error.message}`);
  }
}

async function importRTF(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    // Basic RTF text extraction - remove RTF codes
    const text = content
      .replace(/\\[a-z]+\d*\s?/g, ' ')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    return {
      success: true,
      extractedText: text,
      format: 'rtf',
      metadata: { type: 'rich_text' }
    };
  } catch (error) {
    throw new Error(`RTF import failed: ${error.message}`);
  }
}

// ============================================================================
// TEXT FORMAT IMPORTERS
// ============================================================================

async function importText(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    
    return {
      success: true,
      extractedText: content,
      format: path.extname(filePath).slice(1),
      metadata: { type: 'plain_text' }
    };
  } catch (error) {
    throw new Error(`Text import failed: ${error.message}`);
  }
}

async function importCSV(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    
    // Parse CSV
    const rows = lines.map(line => {
      // Simple CSV parsing (handles quoted fields)
      const matches = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g) || [];
      return matches.map(m => m.replace(/^"|"$/g, '').trim());
    });
    
    return {
      success: true,
      extractedText: content,
      structuredData: rows,
      format: 'csv',
      metadata: {
        type: 'csv',
        rowCount: rows.length,
        columnCount: rows[0]?.length || 0
      }
    };
  } catch (error) {
    throw new Error(`CSV import failed: ${error.message}`);
  }
}

async function importTSV(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    const rows = lines.map(line => line.split('\t'));
    
    return {
      success: true,
      extractedText: content,
      structuredData: rows,
      format: 'tsv',
      metadata: {
        type: 'tsv',
        rowCount: rows.length,
        columnCount: rows[0]?.length || 0
      }
    };
  } catch (error) {
    throw new Error(`TSV import failed: ${error.message}`);
  }
}

// ============================================================================
// WEB FORMAT IMPORTERS
// ============================================================================

async function importHTML(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    // Extract text from HTML
    const text = content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    return {
      success: true,
      extractedText: text,
      htmlContent: content,
      format: 'html',
      metadata: { type: 'html' }
    };
  } catch (error) {
    throw new Error(`HTML import failed: ${error.message}`);
  }
}

async function importXML(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = await parseStringPromise(content);
    
    // Extract text from XML
    const extractText = (obj) => {
      if (typeof obj === 'string') return obj;
      if (Array.isArray(obj)) return obj.map(extractText).join(' ');
      if (typeof obj === 'object') {
        return Object.values(obj).map(extractText).join(' ');
      }
      return '';
    };
    
    const text = extractText(parsed);
    
    return {
      success: true,
      extractedText: text,
      structuredData: parsed,
      format: 'xml',
      metadata: { type: 'xml' }
    };
  } catch (error) {
    throw new Error(`XML import failed: ${error.message}`);
  }
}

// ============================================================================
// IMAGE IMPORTERS (OCR if needed)
// ============================================================================

async function importImage(filePath, format) {
  // For now, just return metadata
  // You could add Tesseract.js for OCR if needed
  try {
    const stats = await fs.stat(filePath);
    
    return {
      success: true,
      extractedText: `[Image file: ${path.basename(filePath)}]`,
      format: format,
      metadata: {
        type: 'image',
        size: stats.size,
        format: format
      }
    };
  } catch (error) {
    throw new Error(`Image import failed: ${error.message}`);
  }
}

// ============================================================================
// ARCHIVE IMPORTERS
// ============================================================================

async function importZIP(filePath) {
  try {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();
    
    const fileList = entries.map(e => ({
      name: e.entryName,
      size: e.header.size,
      compressed: e.header.compressedSize
    }));
    
    const text = `ZIP Archive Contents:\n${fileList.map(f => `- ${f.name} (${f.size} bytes)`).join('\n')}`;
    
    return {
      success: true,
      extractedText: text,
      structuredData: { files: fileList },
      format: 'zip',
      metadata: {
        type: 'archive',
        fileCount: entries.length
      }
    };
  } catch (error) {
    throw new Error(`ZIP import failed: ${error.message}`);
  }
}

async function importArchive(filePath, format) {
  // Basic archive info
  return {
    success: true,
    extractedText: `Archive file (${format.toUpperCase()})`,
    format: format,
    metadata: { type: 'archive' }
  };
}

// ============================================================================
// SPECIAL FORMAT IMPORTERS
// ============================================================================

async function importICS(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    
    return {
      success: true,
      extractedText: content,
      format: 'ics',
      metadata: { type: 'calendar' }
    };
  } catch (error) {
    throw new Error(`ICS import failed: ${error.message}`);
  }
}

async function importVCF(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    
    return {
      success: true,
      extractedText: content,
      format: 'vcf',
      metadata: { type: 'vcard' }
    };
  } catch (error) {
    throw new Error(`VCF import failed: ${error.message}`);
  }
}

async function importEmail(filePath, format) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    
    return {
      success: true,
      extractedText: content,
      format: format,
      metadata: { type: 'email' }
    };
  } catch (error) {
    throw new Error(`Email import failed: ${error.message}`);
  }
}

module.exports = {
  importFile
};