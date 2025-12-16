const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const archiver = require('archiver');
const ExcelJS = require('exceljs');
const util = require('util');
const XLSX = require('xlsx');
const execAsync = util.promisify(require('child_process').exec);
async function exportToImage(content, outputPath, format) {
  const tempHtml = outputPath.replace(/\.(jpg|jpeg|png|bmp|tiff|gif)$/i, '.temp.html');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 900px;
      margin: 20px;
      background: #ffffff;
      color: #000;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-top: 16px;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
    }
    th {
      background: #f3f3f3;
      font-weight: bold;
    }
    pre {
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
${content}
</body>
</html>
`;

  try {
    fs.writeFileSync(tempHtml, html, 'utf8');
    const supportedFormats = ['jpg', 'jpeg', 'png', 'bmp'];
    const needsConversion = !supportedFormats.includes(format.toLowerCase());
    
    let intermediateFormat = 'png';
    let intermediatePath = outputPath;
    
    if (needsConversion) {
      intermediatePath = outputPath.replace(/\.(gif|tiff)$/i, '.temp.png');
      intermediateFormat = 'png';
    }
    await execAsync(
      `wkhtmltoimage --encoding utf-8 --format ${intermediateFormat} "${tempHtml}" "${intermediatePath}"`
    );
    if (needsConversion) {
      try {
        execSync('convert --version', { stdio: 'ignore' });
                await execAsync(`convert "${intermediatePath}" "${outputPath}"`);
                if (fs.existsSync(intermediatePath)) {
          fs.unlinkSync(intermediatePath);
        }
      } catch (convertErr) {
        console.warn(`ImageMagick not installed. Saving as PNG with ${format} extension.`);
        fs.renameSync(intermediatePath, outputPath);
      }
    }

    if (!fs.existsSync(outputPath)) {
      return new Error(`Failed to create ${format.toUpperCase()} file`);
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      return new Error(`Created ${format.toUpperCase()} file is empty`);
    }

  } catch (err) {
    return new Error(`Image export failed: ${err.message}`);
  } finally {
    if (fs.existsSync(tempHtml)) fs.unlinkSync(tempHtml);
  }
}

const FORMATS = {
  // A. Office & Documents (Pandoc-supported)
pdf: { ext: 'pdf', label: 'PDF', handler: 'pandoc', pandocArgs: '--pdf-engine=xelatex' },
  word: { ext: 'docx', label: 'Word document', handler: 'pandoc', pandocArgs: '' },
  docx: { ext: 'docx', label: 'Word document', handler: 'pandoc', pandocArgs: '' },
  doc: { ext: 'docx', label: 'Word document', handler: 'pandoc', pandocArgs: '' },
  pptx: { ext: 'pptx', label: 'PowerPoint presentation', handler: 'pandoc', pandocArgs: '' },
  
  // B. Text and Simple Docs (Pandoc-supported)
  txt: { ext: 'txt', label: 'Text file', handler: 'pandoc', pandocArgs: '' },
  rtf: { ext: 'rtf', label: 'RTF file', handler: 'pandoc', pandocArgs: '-s' },
  
  // C. Web and Markup (Pandoc-supported)
  html: { ext: 'html', label: 'HTML file', handler: 'pandoc', pandocArgs: '-s' },
  htm: { ext: 'html', label: 'HTML file', handler: 'pandoc', pandocArgs: '-s' },
  xml: { ext: 'xml', label: 'XML file', handler: 'custom', pandocArgs: '' },
  
  // D. Markdown (Pandoc-supported)
  markdown: { ext: 'md', label: 'Markdown file', handler: 'pandoc', pandocArgs: '' },
  md: { ext: 'md', label: 'Markdown file', handler: 'pandoc', pandocArgs: '' },
  
  // E. Other Office Suites (Pandoc-supported)
  odt: { ext: 'odt', label: 'OpenDocument text', handler: 'pandoc', pandocArgs: '' },
  odp: { ext: 'odp', label: 'OpenDocument presentation', handler: 'pandoc', pandocArgs: '' },
  ods: { ext: 'ods', label: 'OpenDocument spreadsheet', handler: 'custom', pandocArgs: '' },
  
  // F. Spreadsheets (Custom handlers)
  excel: { ext: 'xlsx', label: 'Excel spreadsheet', handler: 'custom', pandocArgs: '' },
  xlsx: { ext: 'xlsx', label: 'Excel spreadsheet', handler: 'custom', pandocArgs: '' },
  xls: { ext: 'xlsx', label: 'Excel spreadsheet', handler: 'custom', pandocArgs: '' },
  csv: { ext: 'csv', label: 'CSV file', handler: 'custom', pandocArgs: '' },
  tsv: { ext: 'tsv', label: 'TSV file', handler: 'custom', pandocArgs: '' },
  
  // G. Archives (Custom handlers)
  zip: { ext: 'zip', label: 'ZIP archive', handler: 'custom', pandocArgs: '' },
  
  // H. Calendar/Contacts (Custom handlers)
  ics: { ext: 'ics', label: 'Calendar file', handler: 'custom', pandocArgs: '' },
  vcf: { ext: 'vcf', label: 'vCard file', handler: 'custom', pandocArgs: '' },
  
  // I. Email formats (Custom handlers)
  eml: { ext: 'eml', label: 'Email file', handler: 'custom', pandocArgs: '' },
  
  // J. Images (Custom - just save as file)
 jpg:  { ext: 'jpg',  label: 'JPEG image', handler: 'image' },
jpeg: { ext: 'jpeg', label: 'JPEG image', handler: 'image' },
png:  { ext: 'png',  label: 'PNG image',  handler: 'image' },
bmp:  { ext: 'bmp',  label: 'BMP image',  handler: 'image' },
tiff: { ext: 'tiff', label: 'TIFF image', handler: 'image' },
gif:  { ext: 'gif',  label: 'GIF image', handler: 'image' },
ppt:  { ext: 'pptx', label: 'PowerPoint presentation', handler: 'pandoc', pandocArgs: '' },

// Email advanced
msg:  { ext: 'msg',  label: 'Outlook MSG email', handler: 'custom', pandocArgs: '' },
mbox: { ext: 'mbox', label: 'MBOX email archive', handler: 'custom', pandocArgs: '' },

// Databases (EXPORT AS CSV EQUIVALENT)
mdb:    { ext: 'csv', label: 'Access DB (CSV export)', handler: 'custom', pandocArgs: '' },
accdb:  { ext: 'csv', label: 'Access DB (CSV export)', handler: 'custom', pandocArgs: '' },

// Compressed formats (LIMITED EXPORT)
rar:    { ext: 'rar', label: 'RAR archive', handler: 'custom', pandocArgs: '' },
'7z':   { ext: '7z',  label: '7-Zip archive', handler: 'custom', pandocArgs: '' },
'tar.gz': { ext: 'tar.gz', label: 'TAR.GZ archive', handler: 'custom', pandocArgs: '' },

// Media (PACKAGE / PASS-THROUGH)
mp4: { ext: 'mp4', label: 'MP4 video', handler: 'custom', pandocArgs: '' },
mp3: { ext: 'mp3', label: 'MP3 audio', handler: 'custom', pandocArgs: '' },
wav: { ext: 'wav', label: 'WAV audio', handler: 'custom', pandocArgs: '' }
};

function makeFileName(promptText, ext) {
  let base = (promptText || 'file').replace(/[^a-zA-Z0-9 ]+/g, " ");
  base = base.trim().replace(/\s+/g, " ");
  base = base.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  if (base.length > 48) base = base.slice(0, 48);
  if (!base) base = "Document";
  
  const d = new Date();
  const timestamp = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const rand = Math.floor(10000 + Math.random() * 90000);
  
  return `${base} - ${timestamp} - ${rand}.${ext}`;
}

function cleanExportContent(content) {
  return (content || '')
    .replace(/^\s*(as an ai|i'?m (an )?ai|i cannot|i can't|i'm sorry|i apologize).*$/gim, '')
    .replace(/^\s*(ai generated|this is ai generated|language model).*$/gim, '')
    .replace(/^to (download|export|save).*(pdf|word|excel|file|document).*$/gim, '')
    .replace(/^you can now download.*$/gim, '')
    .replace(/^would you like me to.*$/gim, '')
    .replace(/^here('?s| is) (the )?(content|updated|final|rewritten|clean) version.*$/gim, '')
    .replace(/^feel free to (edit|modify|customize).*$/gim, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^```.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureUploadDir() {
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}
// Excel/Spreadsheet Handler
async function exportToExcel(content, outputPath) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  
  const lines = content.split('\n');
  let rowIndex = 1;
  let inTable = false;
  let tableStartRow = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Skip empty lines but add spacing
    if (!trimmedLine) {
      if (rowIndex > 1) rowIndex++;
      continue;
    }
    
    // Detect if this is a table line (contains | or multiple tabs)
    const isTableLine = trimmedLine.includes('|') || (line.split('\t').length > 2);
    
    // Check if it's a markdown table separator line (|---|---|)
    const isSeparator = /^\|?[\s\-:|]+\|?$/.test(trimmedLine);
    
    if (isTableLine && !isSeparator) {
      // Process table row
      if (!inTable) {
        inTable = true;
        tableStartRow = rowIndex;
      }
      
      let cells;
      if (trimmedLine.includes('|')) {
        cells = trimmedLine.split('|').map(c => c.trim()).filter(c => c);
      } else {
        cells = line.split('\t').map(c => c.trim());
      }
      
      const row = worksheet.getRow(rowIndex);
      cells.forEach((cell, idx) => {
        row.getCell(idx + 1).value = cell;
      });
      
      // Style header row (first row of table)
      if (rowIndex === tableStartRow) {
        row.font = { bold: true };
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        };
      }
      
      rowIndex++;
    } else if (!isSeparator) {
      // Regular text content - add as single cell spanning first column
      inTable = false;
      const row = worksheet.getRow(rowIndex);
      row.getCell(1).value = trimmedLine;
      
      // Style text content differently
      row.getCell(1).font = { italic: false };
      row.getCell(1).alignment = { wrapText: true };
      
      rowIndex++;
    }
  }
  
  // Auto-fit columns with better logic
  worksheet.columns.forEach((column, idx) => {
    let maxLength = 10;
    column.eachCell({ includeEmpty: false }, cell => {
      const cellLength = cell.value ? cell.value.toString().length : 0;
      if (cellLength > maxLength) maxLength = cellLength;
    });
    column.width = Math.min(Math.max(maxLength + 2, 12), 80);
  });
  
  // Ensure first column is wide enough for text content
  if (worksheet.getColumn(1).width < 50) {
    worksheet.getColumn(1).width = 50;
  }
  
  await workbook.xlsx.writeFile(outputPath);
}

// CSV Handler
function exportToCSV(content, outputPath) {
  const lines = content.split('\n');
  const csvLines = lines.map(line => {
    // If line contains commas, wrap in quotes
    if (line.includes(',') || line.includes('"')) {
      return `"${line.replace(/"/g, '""')}"`;
    }
    return line;
  });
  
  fs.writeFileSync(outputPath, csvLines.join('\n'), 'utf8');
}

// TSV Handler
function exportToTSV(content, outputPath) {
  const lines = content.split('\n');
  const tsvLines = lines.map(line => line.replace(/,/g, '\t'));
  fs.writeFileSync(outputPath, tsvLines.join('\n'), 'utf8');
}

// XML Handler
function exportToXML(content, outputPath) {
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<document>
  <metadata>
    <created>${new Date().toISOString()}</created>
    <generator>Defizer Export System</generator>
  </metadata>
  <content><![CDATA[${content}]]></content>
</document>`;
  
  fs.writeFileSync(outputPath, xmlContent, 'utf8');
}

// ICS (Calendar) Handler
function exportToICS(content, outputPath) {
  const now = new Date();
  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Defizer//Export System//EN
BEGIN:VEVENT
UID:${now.getTime()}@defizer.com
DTSTAMP:${now.toISOString().replace(/[-:]/g, '').split('.')[0]}Z
SUMMARY:Exported Document
DESCRIPTION:${content.replace(/\n/g, '\\n')}
END:VEVENT
END:VCALENDAR`;
  
  fs.writeFileSync(outputPath, icsContent, 'utf8');
}

// VCF (vCard) Handler
function exportToVCF(content, outputPath) {
  const vcfContent = `BEGIN:VCARD
VERSION:3.0
FN:Exported Contact
NOTE:${content.replace(/\n/g, '\\n')}
END:VCARD`;
  
  fs.writeFileSync(outputPath, vcfContent, 'utf8');
}

// EML (Email) Handler
function exportToEML(content, outputPath) {
  const emlContent = `From: export@defizer.com
To: user@example.com
Subject: Exported Document
Date: ${new Date().toUTCString()}
Content-Type: text/plain; charset=utf-8

${content}`;
  
  fs.writeFileSync(outputPath, emlContent, 'utf8');
}

// ZIP Handler
async function exportToZIP(content, outputPath, fileName) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    
    archive.pipe(output);
    
    // Add main content as text file
    archive.append(content, { name: fileName.replace('.zip', '.txt') });
    
    // You can add more files here if needed
    // archive.file('path/to/file', { name: 'filename.ext' });
    
    archive.finalize();
  });
}

// =============================================================================
// MAIN EXPORT FUNCTION
// =============================================================================

async function exportFile(content, sessId, promptText = '', format = 'docx') {
  try {
    const formatConfig = FORMATS[format.toLowerCase()];
    if (!formatConfig) {
      throw new Error(`Unsupported format: ${format}. Supported formats: ${Object.keys(FORMATS).join(', ')}`);
    }

    const cleaned = cleanExportContent(content);
    const fileName = makeFileName(promptText || cleaned, formatConfig.ext);
    const uploadsDir = ensureUploadDir();
    const outputPath = path.join(uploadsDir, fileName);
    
    switch(formatConfig.handler) {
      case 'pandoc':
        await exportWithPandoc(cleaned, outputPath, formatConfig);
        break;
        
      case 'custom':
        await exportWithCustomHandler(cleaned, outputPath, format, fileName);
        break;
        
      case 'image':
    await exportToImage(cleaned, outputPath, formatConfig.ext);
    break;
      default:
        throw new Error(`Unknown handler type: ${formatConfig.handler}`);
    }
    
    return { 
      url: `/uploads/${fileName}`, 
      name: fileName,
      label: formatConfig.label,
      format: formatConfig.ext
    };
    
  } catch (error) {
    console.error(`Export Error (${format}):`, error);
    throw new Error(`Failed to generate ${format.toUpperCase()}: ${error.message}`);
  }
}

// Pandoc Export Handler
async function exportWithPandoc(content, outputPath, formatConfig) {
  const tempMdPath = outputPath.replace(new RegExp(`\\.${formatConfig.ext}$`), '.temp.md');
  
  try {
    fs.writeFileSync(tempMdPath, content, 'utf8');
    
    let pandocCmd = `pandoc "${tempMdPath}" -o "${outputPath}" ${formatConfig.pandocArgs}`.trim();
    
    execSync(pandocCmd, { stdio: 'inherit' });
    
  } finally {
    if (fs.existsSync(tempMdPath)) {
      fs.unlinkSync(tempMdPath);
    }
  }
}
// Custom Format Handler Router
async function exportWithCustomHandler(content, outputPath, format, fileName) {
  switch(format.toLowerCase()) {
    case 'excel':
    case 'xlsx':
    case 'xls':
      await exportToExcel(content, outputPath);
      break;                              
      
   case 'ods':
  const tempXlsxPath = outputPath.replace('.ods', '.temp.xlsx');
  try {
    await exportToExcel(content, tempXlsxPath);
        const workbook = XLSX.readFile(tempXlsxPath);
    XLSX.writeFile(workbook, outputPath, { 
      bookType: 'ods',
      compression: true 
    });
    
  } catch (err) {
    console.error('ODS export failed:', err);
    throw err;
  } finally {
    if (fs.existsSync(tempXlsxPath)) {
      fs.unlinkSync(tempXlsxPath);
    }
  }
  break;
      
    case 'csv':
      exportToCSV(content, outputPath);
      break;
      
    case 'tsv':
      exportToTSV(content, outputPath);
      break;
      
    case 'xml':
      exportToXML(content, outputPath);
      break;
      
    case 'ics':
      exportToICS(content, outputPath);
      break;
      
    case 'vcf':
      exportToVCF(content, outputPath);
      break;
      
    case 'eml':
      exportToEML(content, outputPath);
      break;
      
    case 'zip':
      await exportToZIP(content, outputPath, fileName);
      break;
      
    case 'gif':
      await exportToImage(content, outputPath, 'gif');
      break;

    case 'msg':
    case 'mbox':
      fs.writeFileSync(
        outputPath,
        `This ${format.toUpperCase()} file is an archived export.\n\n${content}`,
        'utf8'
      );
      break;
    case 'mdb':
    case 'accdb':
      exportToCSV(content, outputPath);
      console.log(`[MDB/ACCDB] Exported as CSV: ${outputPath}`);
      break;
    case 'rar':
    case '7z':
    case 'tar.gz':
      await exportToZIP(content, outputPath.replace(/\.(rar|7z|tar\.gz)$/, '.zip'), fileName);
      break;

    case 'mp4':
    case 'mp3':
    case 'wav':
      fs.writeFileSync(
        outputPath,
        `Media placeholder file.\n\nContent metadata:\n${content}`,
        'utf8'
      );
      break;

    default:
      throw new Error(`Custom handler not implemented for format: ${format}`);
  }
}
async function exportBatch(content, sessId, promptText = '', formats = ['docx', 'pdf']) {
  const results = [];
  const errors = [];
  
  for (const format of formats) {
    try {
      const result = await exportFile(content, sessId, promptText, format);
      results.push(result);
    } catch (error) {
      errors.push({ format, error: error.message });
    }
  }
  
  return { results, errors };
}
module.exports = { 
  exportFile,
  exportBatch,
  makeFileName, 
  cleanExportContent,
  FORMATS,
  getSupportedFormats: () => Object.keys(FORMATS)
};