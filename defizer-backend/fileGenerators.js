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

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function processMarkdownInText(text) {
    let result = text;
    
    // Bold
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');
    
    // Italic
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    result = result.replace(/_(.+?)_/g, '<em>$1</em>');
    
    // Inline code
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    return result;
  }

  function markdownTableToHtml(lines) {
    // Filter out separator lines
    const dataLines = lines.filter(l => !/^\|?\s*[-:]+(\s*\|\s*[-:]+)+\s*\|?$/.test(l));
    
    if (dataLines.length === 0) return '';

    // Parse all rows
    const rows = dataLines.map(line => {
      // Remove leading and trailing pipes, then split
      const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
      return trimmed.split('|').map(cell => cell.trim());
    });

    if (rows.length === 0) return '';

    // First row is header
    const header = rows[0];
    const bodyRows = rows.slice(1);

    let tableHtml = '<table class="data-table">\n';
    
    // Create header
    tableHtml += '  <thead>\n    <tr>';
    header.forEach(cell => {
      const escaped = escapeHtml(cell);
      const formatted = processMarkdownInText(escaped);
      tableHtml += `<th>${formatted}</th>`;
    });
    tableHtml += '</tr>\n  </thead>\n';
    
    // Create body
    if (bodyRows.length > 0) {
      tableHtml += '  <tbody>\n';
      bodyRows.forEach(row => {
        tableHtml += '    <tr>';
        row.forEach(cell => {
          const escaped = escapeHtml(cell);
          const formatted = processMarkdownInText(escaped);
          tableHtml += `<td>${formatted}</td>`;
        });
        tableHtml += '</tr>\n';
      });
      tableHtml += '  </tbody>\n';
    }
    
    tableHtml += '</table>\n';
    
    return tableHtml;
  }

  function processContent(content) {
    const lines = content.split('\n');
    let htmlBody = '';
    let inTable = false;
    let tableBuffer = [];
    let inCodeBlock = false;
    let codeBuffer = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check for code block markers
      if (trimmed.startsWith('```')) {
        if (inCodeBlock) {
          // End code block
          htmlBody += '<pre class="code-block"><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>\n';
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          // Start code block
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Check for table line
      const isTableLine = trimmed.includes('|') && trimmed.split('|').length > 2;

      if (isTableLine) {
        if (!inTable) {
          inTable = true;
          tableBuffer = [];
        }
        tableBuffer.push(trimmed);
        continue;
      } else if (inTable) {
        // End of table
        htmlBody += markdownTableToHtml(tableBuffer);
        tableBuffer = [];
        inTable = false;
      }

      // Process regular lines
      if (trimmed === '') {
        htmlBody += '<div style="height: 12px;"></div>\n';
        continue;
      }

      // Headers
      if (trimmed.startsWith('#')) {
        const match = trimmed.match(/^(#{1,6})\s+(.+)$/);
        if (match) {
          const level = match[1].length;
          const text = escapeHtml(match[2]);
          htmlBody += `<h${level}>${processMarkdownInText(text)}</h${level}>\n`;
          continue;
        }
      }

      // Lists
      if (/^[-*+]\s+/.test(trimmed)) {
        const text = trimmed.replace(/^[-*+]\s+/, '');
        const escaped = escapeHtml(text);
        htmlBody += `<li>${processMarkdownInText(escaped)}</li>\n`;
        continue;
      }

      if (/^\d+\.\s+/.test(trimmed)) {
        const text = trimmed.replace(/^\d+\.\s+/, '');
        const escaped = escapeHtml(text);
        htmlBody += `<li>${processMarkdownInText(escaped)}</li>\n`;
        continue;
      }

      // Blockquotes
      if (trimmed.startsWith('>')) {
        const text = trimmed.replace(/^>\s*/, '');
        const escaped = escapeHtml(text);
        htmlBody += `<blockquote>${processMarkdownInText(escaped)}</blockquote>\n`;
        continue;
      }

      // Horizontal rules
      if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
        htmlBody += '<hr>\n';
        continue;
      }

      // Regular paragraph
      const escaped = escapeHtml(trimmed);
      htmlBody += `<p>${processMarkdownInText(escaped)}</p>\n`;
    }

    // Handle remaining table
    if (inTable && tableBuffer.length > 0) {
      htmlBody += markdownTableToHtml(tableBuffer);
    }

    // Handle remaining code block
    if (inCodeBlock && codeBuffer.length > 0) {
      htmlBody += '<pre class="code-block"><code>' + escapeHtml(codeBuffer.join('\n')) + '</code></pre>\n';
    }

    return htmlBody;
  }

  const htmlBody = processContent(content);

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', Arial, sans-serif;
      max-width: 1200px;
      margin: 0;
      padding: 40px;
      color: #1a1a1a;
      line-height: 1.6;
      background: #ffffff;
    }
    
    h1, h2, h3, h4, h5, h6 {
      margin: 24px 0 16px 0;
      font-weight: 600;
      line-height: 1.3;
      color: #0f0f0f;
    
    h1 { font-size: 32px; border-bottom: 2px solid #e0e0e0; padding-bottom: 8px; }
    h2 { font-size: 28px; border-bottom: 1px solid #e8e8e8; padding-bottom: 6px; }
    h3 { font-size: 24px; }
    h4 { font-size: 20px; }
    h5 { font-size: 18px; }
    h6 { font-size: 16px; color: #555; }
    
    p {
      margin: 12px 0;
      font-size: 15px;
      line-height: 1.7;
    }
    
    table.data-table {
      border-collapse: collapse;
      width: 100%;
      margin: 20px 0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      font-size: 14px;
    }
    
    table.data-table th,
    table.data-table td {
      border: 1px solid #d0d0d0;
      padding: 14px 18px;
      text-align: left;
      vertical-align: top;
      line-height: 1.6;
      word-wrap: break-word;
    }
    
    table.data-table th {
      background: linear-gradient(to bottom, #f8f9fa, #e9ecef);
      font-weight: 600;
      color: #212529;
      border-bottom: 2px solid #adb5bd;
      font-size: 14px;
    }
    
    table.data-table tbody tr:nth-child(odd) {
      background: #ffffff;
    }
    
    table.data-table tbody tr:nth-child(even) {
      background: #f8f9fa;
    }
    
    table.data-table td {
      color: #495057;
    }
    
    ul, ol {
      margin: 16px 0;
      padding-left: 32px;
    }
    
    li {
      margin: 8px 0;
      font-size: 15px;
      line-height: 1.6;
    }
    
    pre.code-block {
      background: #f6f8fa;
      border: 1px solid #d0d7de;
      border-radius: 6px;
      padding: 16px;
      margin: 16px 0;
      overflow-x: auto;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    
    code {
      background: #eff1f3;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      color: #c7254e;
    }
    
    pre code {
      background: transparent;
      padding: 0;
      color: #24292e;
    }
    
    blockquote {
      border-left: 4px solid #0969da;
      padding-left: 16px;
      margin: 16px 0;
      color: #555;
      font-style: italic;
      background: #f8f9fa;
      padding: 12px 12px 12px 16px;
      border-radius: 0 4px 4px 0;
    }
    
    hr {
      border: none;
      border-top: 2px solid #e0e0e0;
      margin: 24px 0;
    }
    
    a {
      color: #0969da;
      text-decoration: none;
    }
    
    a:hover {
      text-decoration: underline;
    }
    
    strong {
      font-weight: 600;
      color: #0f0f0f;
    }
    
    em {
      font-style: italic;
    }
    
    br {
      line-height: 1;
    }
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;

  try {
    fs.writeFileSync(tempHtml, html, 'utf8');

    const supportedFormats = ['jpg', 'jpeg', 'png', 'bmp'];
    const needsConversion = !supportedFormats.includes(format.toLowerCase());

    let intermediatePath = outputPath;
    if (needsConversion) {
      intermediatePath = outputPath.replace(/\.(gif|tiff)$/i, '.temp.png');
    }

    // For GIF format, create a static PNG (GIFs don't animate from HTML)
    if (format.toLowerCase() === 'gif') {
      await execAsync(`wkhtmltoimage --quality 95 --width 1400 --enable-local-file-access "${tempHtml}" "${intermediatePath}"`);
      
      // Check if ImageMagick is available to convert to GIF
      try {
        execSync('convert --version', { stdio: 'ignore' });
        await execAsync(`convert "${intermediatePath}" "${outputPath}"`);
        fs.unlinkSync(intermediatePath);
      } catch {
        // ImageMagick not available, just rename PNG to GIF
        fs.renameSync(intermediatePath, outputPath);
        console.log('[INFO] GIF export created as static image (no animation)');
      }
    } else {
      // Standard image export
      await execAsync(`wkhtmltoimage --quality 95 --width 1400 --enable-local-file-access "${tempHtml}" "${intermediatePath}"`);

      if (needsConversion) {
        try {
          execSync('convert --version', { stdio: 'ignore' });
          await execAsync(`convert "${intermediatePath}" "${outputPath}"`);
          fs.unlinkSync(intermediatePath);
        } catch {
          fs.renameSync(intermediatePath, outputPath);
        }
      }
    }
  } finally {
    if (fs.existsSync(tempHtml)) fs.unlinkSync(tempHtml);
  }
}
const FORMATS = {
  // A. Core Office Formats
  pdf: { ext: 'pdf', label: 'PDF', handler: 'pandoc', pandocArgs: '--pdf-engine=xelatex' },
  
  // Word formats - DOC uses older format
  word: { ext: 'docx', label: 'Word document', handler: 'pandoc', pandocArgs: '' },
  docx: { ext: 'docx', label: 'Word document (DOCX)', handler: 'pandoc', pandocArgs: '' },
  doc: { ext: 'doc', label: 'Word document (DOC)', handler: 'pandoc', pandocArgs: '-t doc' },
  
  // Excel formats - XLS uses older format
  excel: { ext: 'xlsx', label: 'Excel spreadsheet', handler: 'custom', pandocArgs: '' },
  xlsx: { ext: 'xlsx', label: 'Excel spreadsheet (XLSX)', handler: 'custom', pandocArgs: '' },
  xls: { ext: 'xls', label: 'Excel spreadsheet (XLS)', handler: 'custom', pandocArgs: '' },
  
  csv: { ext: 'csv', label: 'CSV file', handler: 'custom', pandocArgs: '' },
  pptx: { ext: 'pptx', label: 'PowerPoint presentation', handler: 'pandoc', pandocArgs: '' },
  ppt: { ext: 'pptx', label: 'PowerPoint presentation', handler: 'pandoc', pandocArgs: '' },
  
  // Images
  jpg: { ext: 'jpg', label: 'JPEG image', handler: 'image' },
  jpeg: { ext: 'jpeg', label: 'JPEG image', handler: 'image' },
  png: { ext: 'png', label: 'PNG image', handler: 'image' },
  bmp: { ext: 'bmp', label: 'BMP image', handler: 'image' },
  tiff: { ext: 'tiff', label: 'TIFF image', handler: 'image' },
  gif: { ext: 'gif', label: 'GIF image', handler: 'image' },
  
  // B. Text and Simple Docs
  txt: { ext: 'txt', label: 'Text file', handler: 'pandoc', pandocArgs: '-t plain --wrap=none' },
  rtf: { ext: 'rtf', label: 'RTF file', handler: 'pandoc', pandocArgs: '-s' },
  
  // C. Web and Markup
  html: { ext: 'html', label: 'HTML file', handler: 'pandoc', pandocArgs: '-s' },
  htm: { ext: 'html', label: 'HTML file', handler: 'pandoc', pandocArgs: '-s' },
  xml: { ext: 'xml', label: 'XML file', handler: 'custom', pandocArgs: '' },
  
  // D. Other Spreadsheets / Databases
  tsv: { ext: 'tsv', label: 'TSV file', handler: 'custom', pandocArgs: '' },
  ods: { ext: 'ods', label: 'OpenDocument spreadsheet', handler: 'custom', pandocArgs: '' },
  mdb: { ext: 'csv', label: 'Access DB (CSV export)', handler: 'custom', pandocArgs: '' },
  accdb: { ext: 'csv', label: 'Access DB (CSV export)', handler: 'custom', pandocArgs: '' },
  
  // E. Other Office Suites
  odt: { ext: 'odt', label: 'OpenDocument text', handler: 'pandoc', pandocArgs: '' },
  odp: { ext: 'odp', label: 'OpenDocument presentation', handler: 'pandoc', pandocArgs: '' },
  
  // F. Calendars / Contacts
  ics: { ext: 'ics', label: 'Calendar file', handler: 'custom', pandocArgs: '' },
  vcf: { ext: 'vcf', label: 'vCard file', handler: 'custom', pandocArgs: '' },
  
  // G. Email / Archive
  eml: { ext: 'eml', label: 'Email file', handler: 'custom', pandocArgs: '' },
  msg: { ext: 'msg', label: 'Outlook MSG email', handler: 'custom', pandocArgs: '' },
  mbox: { ext: 'mbox', label: 'MBOX email archive', handler: 'custom', pandocArgs: '' },
  
  // H. Compressed
  zip: { ext: 'zip', label: 'ZIP archive', handler: 'custom', pandocArgs: '' },
  rar: { ext: 'rar', label: 'RAR archive', handler: 'custom', pandocArgs: '' },
  '7z': { ext: '7z', label: '7-Zip archive', handler: 'custom', pandocArgs: '' },
  'tar.gz': { ext: 'tar.gz', label: 'TAR.GZ archive', handler: 'custom', pandocArgs: '' },
  
  // I. Media
  mp4: { ext: 'mp4', label: 'MP4 video', handler: 'custom', pandocArgs: '' },
  mp3: { ext: 'mp3', label: 'MP3 audio', handler: 'custom', pandocArgs: '' },
  wav: { ext: 'wav', label: 'WAV audio', handler: 'custom', pandocArgs: '' },
  
  // D. Markdown
  markdown: { ext: 'md', label: 'Markdown file', handler: 'pandoc', pandocArgs: '' },
  md: { ext: 'md', label: 'Markdown file', handler: 'pandoc', pandocArgs: '' }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function makeFileName(promptText, ext) {
  let base = (promptText || 'file').replace(/[^a-zA-Z0-9 ]+/g, " ");
  base = base.trim().replace(/\s+/g, " ");
  base = base.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    base = base.replace(/%20/g, ' ').replace(/%[0-9A-F]{2}/gi, ' ');
  
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

    // 🔧 FIX: remove full "Would you like..." block (multi-line)
    .replace(/\n*\s*would you like[\s\S]*$/gi, '')

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
async function exportToExcel(content, outputPath, format = 'xlsx') {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('TechCorp Report');

  const lines = content.split('\n');
  let currentRow = 1;
  let isInTable = false;
  let tableHeaders = [];
  let tableRows = [];
  let tableStartRow = 0;
  function addStyledCell(row, column, value, isBold = false, isHeader = false, indent = 0) {
    const cell = row.getCell(column);
    cell.value = value;
        cell.font = {
      bold: isBold,
      size: isHeader ? 12 : 11
    };
    
    cell.alignment = {
      wrapText: true,
      vertical: 'top',
      horizontal: 'left',
      indent: indent
    };
    
    if (isHeader) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' } 
      };
      cell.font.color = { argb: 'FFFFFFFF' };
    }
    
    return cell;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (line === '') {
      currentRow++;
      continue;
    }
        if (line.includes('|') && line.split('|').length > 2) {
      if (!isInTable) {
        isInTable = true;
        tableStartRow = currentRow;
        tableHeaders = line.split('|')
          .map(cell => cell.trim())
          .filter(cell => cell !== '');
                const headerRow = worksheet.getRow(currentRow);
        tableHeaders.forEach((header, colIndex) => {
          addStyledCell(headerRow, colIndex + 1, header, true, true);
        });
        currentRow++;
                if (i + 1 < lines.length && lines[i + 1].includes('---')) {
          i++; 
        }
      } else {
        const cells = line.split('|')
          .map(cell => cell.trim())
          .filter(cell => cell !== '');
        
        const dataRow = worksheet.getRow(currentRow);
        cells.forEach((cell, colIndex) => {
          addStyledCell(dataRow, colIndex + 1, cell);
        });
        currentRow++;
      }
      continue;
    }
        if (isInTable && !line.includes('|')) {
      isInTable = false;
            const tableRange = `${worksheet.getCell(tableStartRow, 1).address}:${worksheet.getCell(currentRow - 1, tableHeaders.length).address}`;
      const table = worksheet.getCell(tableStartRow, 1).table;
      
      if (!table) {
        worksheet.addTable({
          name: 'ReportTable',
          ref: worksheet.getCell(tableStartRow, 1).address,
          headerRow: true,
          totalsRow: false,
          style: {
            theme: 'TableStyleMedium2',
            showRowStripes: true,
          },
          columns: tableHeaders.map(header => ({ name: header })),
          rows: tableRows
        });
      }
    }
    
    const row = worksheet.getRow(currentRow);
        if (line.startsWith('### ')) {
      addStyledCell(row, 1, line.replace('### ', ''), true);
      row.height = 25;
      currentRow++;
    }
    else if (line.startsWith('- ')) {
      addStyledCell(row, 1, line.replace('- ', '• '), false, false, 1);
      currentRow++;
    }    else if (line.match(/^\d+\.\s/)) {
      addStyledCell(row, 1, line, false, false, 1);
      currentRow++;
    }
    else if (line.includes('[ ]')) {
      addStyledCell(row, 1, line.replace('[ ]', '☐'), false, false, 1);
      currentRow++;
    }
    else if (line.includes('[x]') || line.includes('[X]')) {
      addStyledCell(row, 1, line.replace(/\[[xX]\]/, '☑'), false, false, 1);
      currentRow++;
    }
    else if (line.startsWith('---')) {
      const separatorRow = worksheet.getRow(currentRow);
      separatorRow.getCell(1).value = '────────────────────';
      separatorRow.getCell(1).font = { color: { argb: 'FFCCCCCC' } };
      currentRow++;
    }
    else {
      addStyledCell(row, 1, line);
      currentRow++;
    }
  }

  worksheet.columns.forEach((column, columnIndex) => {
    let maxLength = 0;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const cellLength = cell.value ? cell.value.toString().length : 0;
      maxLength = Math.max(maxLength, cellLength);
    });
    
    column.width = Math.min(Math.max(maxLength + 3, 15), 50);
  });

  worksheet.properties.defaultRowHeight = 20;

  if (format === 'xls') {
    const tempXlsxPath = outputPath.replace('.xls', '.temp.xlsx');
    try {
      await workbook.xlsx.writeFile(tempXlsxPath);
      
      const wb = XLSX.readFile(tempXlsxPath);
      XLSX.writeFile(wb, outputPath, { 
        bookType: 'xls',
        compression: true 
      });
      
      fs.unlinkSync(tempXlsxPath);
      console.log(`Excel file saved successfully: ${outputPath}`);
    } catch (err) {
      if (fs.existsSync(tempXlsxPath)) {
        fs.unlinkSync(tempXlsxPath);
      }
      console.error('Error saving XLS file:', err);
      throw err;
    }
  } else {
    await workbook.xlsx.writeFile(outputPath);
    console.log(`Excel file saved successfully: ${outputPath}`);
  }
}

function exportToCSV(content, outputPath) {
  const lines = content.split('\n');
  const csvRows = [];
  let inTable = false;
  let tableRows = [];
  let currentSection = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect section headers (### or numbered sections)
    if (trimmed.startsWith('###') || trimmed.startsWith('#')) {
      if (inTable && tableRows.length > 0) {
        // Flush existing table
        processTableRows(tableRows, csvRows);
        tableRows = [];
        inTable = false;
      }
      
      // Add section header
      const headerText = trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      if (headerText) {
        csvRows.push(''); // Blank line before section
        csvRows.push(`"${headerText}"`);
        csvRows.push(''); // Blank line after section
      }
      currentSection = headerText;
      continue;
    }

    // Check if this is a table line
    const isTableLine = trimmed.startsWith('|') && trimmed.split('|').length > 2;
    
    // Check if this is a separator line (|---|---|)
    const isSeparatorLine = isTableLine && /^(\|\s*[-:]+\s*)+\|?$/.test(trimmed);

    if (isTableLine && !isSeparatorLine) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }

      // Parse table row
      const cells = trimmed
        .split('|')
        .slice(1, -1) // Remove first and last empty elements
        .map(cell => cleanCell(cell.trim()));

      tableRows.push(cells);
    } else if (inTable && !isTableLine) {
      // End of table - process all accumulated rows
      if (tableRows.length > 0) {
        processTableRows(tableRows, csvRows);
        tableRows = [];
      }
      inTable = false;

      // Add non-table line
      if (trimmed && !isSeparatorLine) {
        // Handle bullet points and numbered lists
        let textLine = trimmed;
        
        // Convert bullet points to readable format
        if (/^[-*+]\s+/.test(textLine)) {
          textLine = '• ' + textLine.replace(/^[-*+]\s+/, '');
        } else if (/^\d+\.\s+/.test(textLine)) {
          // Keep numbered lists as is
          textLine = textLine;
        }
        
        csvRows.push(`"${textLine.replace(/"/g, '""')}"`);
      } else if (!trimmed && csvRows.length > 0) {
        // Preserve blank lines for readability
        csvRows.push('');
      }
    } else if (!isSeparatorLine && trimmed && !inTable) {
      // Regular text line
      let textLine = trimmed;
      
      // Convert bullet points
      if (/^[-*+]\s+/.test(textLine)) {
        textLine = '• ' + textLine.replace(/^[-*+]\s+/, '');
      }
      
      csvRows.push(`"${textLine.replace(/"/g, '""')}"`);
    }
  }

  // Handle any remaining table rows
  if (inTable && tableRows.length > 0) {
    processTableRows(tableRows, csvRows);
  }

  fs.writeFileSync(outputPath, csvRows.join('\n'), 'utf8');
}

function exportToTSV(content, outputPath) {
  const lines = content.split('\n');
  const tsvRows = [];
  let inTable = false;
  let tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect section headers
    if (trimmed.startsWith('###') || trimmed.startsWith('#')) {
      if (inTable && tableRows.length > 0) {
        processTableRowsTSV(tableRows, tsvRows);
        tableRows = [];
        inTable = false;
      }
      
      const headerText = trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '');
      if (headerText) {
        tsvRows.push(''); // Blank line before section
        tsvRows.push(headerText);
        tsvRows.push(''); // Blank line after section
      }
      continue;
    }

    // Check if this is a table line
    const isTableLine = trimmed.startsWith('|') && trimmed.split('|').length > 2;
    const isSeparatorLine = isTableLine && /^(\|\s*[-:]+\s*)+\|?$/.test(trimmed);

    if (isTableLine && !isSeparatorLine) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }

      const cells = trimmed
        .split('|')
        .slice(1, -1)
        .map(cell => cleanCell(cell.trim()));

      tableRows.push(cells);
    } else if (inTable && !isTableLine) {
      if (tableRows.length > 0) {
        processTableRowsTSV(tableRows, tsvRows);
        tableRows = [];
      }
      inTable = false;

      if (trimmed && !isSeparatorLine) {
        let textLine = trimmed;
        
        if (/^[-*+]\s+/.test(textLine)) {
          textLine = '• ' + textLine.replace(/^[-*+]\s+/, '');
        }
        
        tsvRows.push(textLine.replace(/\t/g, ' '));
      } else if (!trimmed && tsvRows.length > 0) {
        tsvRows.push('');
      }
    } else if (!isSeparatorLine && trimmed && !inTable) {
      let textLine = trimmed;
      
      if (/^[-*+]\s+/.test(textLine)) {
        textLine = '• ' + textLine.replace(/^[-*+]\s+/, '');
      }
      
      tsvRows.push(textLine.replace(/\t/g, ' '));
    }
  }

  if (inTable && tableRows.length > 0) {
    processTableRowsTSV(tableRows, tsvRows);
  }

  fs.writeFileSync(outputPath, tsvRows.join('\n'), 'utf8');
}

// Helper function to clean cell content
function cleanCell(cell) {
  return cell
    .replace(/\*\*(.+?)\*\*/g, '$1')  // Bold
    .replace(/\*(.+?)\*/g, '$1')      // Italic
    .replace(/__(.+?)__/g, '$1')      // Bold alternative
    .replace(/_(.+?)_/g, '$1')        // Italic alternative
    .replace(/`(.+?)`/g, '$1')        // Inline code
    .trim();
}

// Process table rows for CSV
function processTableRows(tableRows, csvRows) {
  if (tableRows.length === 0) return;

  // Get max column count
  const maxCols = Math.max(...tableRows.map(row => row.length));

  // Process each row
  tableRows.forEach((row, rowIndex) => {
    // Pad row to max columns
    while (row.length < maxCols) {
      row.push('');
    }
    
    // Create CSV row with proper escaping
    const csvRow = row.map(cell => {
      return `"${cell.replace(/"/g, '""')}"`;
    }).join(',');

    csvRows.push(csvRow);
  });

  // Add blank line after table
  csvRows.push('');
}

// Process table rows for TSV
function processTableRowsTSV(tableRows, tsvRows) {
  if (tableRows.length === 0) return;

  const maxCols = Math.max(...tableRows.map(row => row.length));

  tableRows.forEach(row => {
    while (row.length < maxCols) {
      row.push('');
    }
    
    const tsvRow = row.map(cell => cell.replace(/\t/g, ' ')).join('\t');
    tsvRows.push(tsvRow);
  });

  tsvRows.push('');
}
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function exportToXML(content, outputPath) {
  const lines = content.split('\n');

  let xml = [];
  let inList = false;
  let listType = null;

  xml.push('<?xml version="1.0" encoding="UTF-8"?>');
  xml.push('<document>');
  xml.push('  <metadata>');
  xml.push(`    <created>${new Date().toISOString()}</created>`);
  xml.push('    <generator>Defizer Export System</generator>');
  xml.push('  </metadata>');
  xml.push('  <content>');

  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Headings ###, ##, #
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      if (inList) {
        xml.push('    </list>');
        inList = false;
      }
      const level = headingMatch[1].length;
      xml.push(`    <heading level="${level}">${escapeXml(headingMatch[2])}</heading>`);
      continue;
    }

    // Bullet list
    if (/^[-*+]\s+/.test(trimmed)) {
      if (!inList) {
        inList = true;
        listType = 'bullet';
        xml.push(`    <list type="${listType}">`);
      }
      xml.push(`      <item>${escapeXml(trimmed.replace(/^[-*+]\s+/, ''))}</item>`);
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inList) {
        inList = true;
        listType = 'numbered';
        xml.push(`    <list type="${listType}">`);
      }
      xml.push(`      <item>${escapeXml(trimmed.replace(/^\d+\.\s+/, ''))}</item>`);
      continue;
    }

    // Close list if needed
    if (inList) {
      xml.push('    </list>');
      inList = false;
    }

    // Paragraph
    xml.push(`    <paragraph>${escapeXml(trimmed)}</paragraph>`);
  }

  if (inList) {
    xml.push('    </list>');
  }

  xml.push('  </content>');
  xml.push('</document>');

  fs.writeFileSync(outputPath, xml.join('\n'), 'utf8');
}

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

function exportToVCF(content, outputPath) {
  const vcfContent = `BEGIN:VCARD
VERSION:3.0
FN:Exported Contact
NOTE:${content.replace(/\n/g, '\\n')}
END:VCARD`;
  fs.writeFileSync(outputPath, vcfContent, 'utf8');
}

// ============================================================================
// EMAIL HANDLERS
// ============================================================================
function exportToEML(content, outputPath) {
  const emlContent = `From: export@defizer.com
To: user@example.com
Subject: Exported Document
Date: ${new Date().toUTCString()}
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 8bit

${content}`;
  fs.writeFileSync(outputPath, emlContent, 'utf8');
}
function exportToMSG(content, outputPath) {
  // Simple MSG placeholder (you can use libraries for full MSG structure if needed)
  const msgContent = `From: export@defizer.com
To: user@example.com
Subject: Exported Document
Date: ${new Date().toUTCString()}

${content}`;
  fs.writeFileSync(outputPath, msgContent, 'utf8');
}

function exportToMBOX(content, outputPath) {
  // Simple MBOX placeholder
  const now = new Date().toUTCString();
  const mboxContent = `From export@defizer.com ${now}
${content.replace(/\n/g, '\n')}
`;
  fs.writeFileSync(outputPath, mboxContent, 'utf8');
}
// ============================================================================
// COMPRESSION HANDLERS
// ============================================================================
async function exportToZIP(content, outputPath, fileName) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    
    archive.pipe(output);
    archive.append(content, { name: fileName.replace(/\.(zip|rar|7z|tar\.gz)$/i, '.txt') });
    archive.finalize();
  });
}

async function exportToRAR(content, outputPath, fileName) {
  // Create temp text file
  const tempTxtPath = outputPath.replace('.rar', '.temp.txt');
  fs.writeFileSync(tempTxtPath, content, 'utf8');
  
  try {
    // Check if RAR is available
    try {
      execSync('rar', { stdio: 'ignore' });
    } catch (e) {
      // RAR not available, fallback to ZIP
      console.warn('RAR not available, creating ZIP instead');
      await exportToZIP(content, outputPath.replace('.rar', '.zip'), fileName);
      fs.unlinkSync(tempTxtPath);
      throw new Error('RAR_NOT_AVAILABLE');
    }
    
    // Create RAR archive
    const txtFileName = fileName.replace('.rar', '.txt');
    execSync(`rar a -ep "${outputPath}" "${tempTxtPath}"`, { stdio: 'inherit' });
    
    // Clean up
    fs.unlinkSync(tempTxtPath);
  } catch (err) {
    if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
    throw err;
  }
}

async function exportTo7Z(content, outputPath, fileName) {
  const tempTxtPath = outputPath.replace('.7z', '.temp.txt');
  fs.writeFileSync(tempTxtPath, content, 'utf8');
  
  try {
    // Check if 7z is available
    try {
      execSync('7z', { stdio: 'ignore' });
    } catch (e) {
      console.warn('7-Zip not available, creating ZIP instead');
      await exportToZIP(content, outputPath.replace('.7z', '.zip'), fileName);
      fs.unlinkSync(tempTxtPath);
      throw new Error('7Z_NOT_AVAILABLE');
    }
    
    execSync(`7z a "${outputPath}" "${tempTxtPath}"`, { stdio: 'inherit' });
    fs.unlinkSync(tempTxtPath);
  } catch (err) {
    if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
    throw err;
  }
}

async function exportToTARGZ(content, outputPath, fileName) {
  const tempTxtPath = outputPath.replace('.tar.gz', '.temp.txt');
  fs.writeFileSync(tempTxtPath, content, 'utf8');
  
  try {
    const txtFileName = fileName.replace('.tar.gz', '.txt');
    execSync(`tar -czf "${outputPath}" --transform='s|.*|${txtFileName}|' "${tempTxtPath}"`, { 
      stdio: 'inherit' 
    });
    fs.unlinkSync(tempTxtPath);
  } catch (err) {
    if (fs.existsSync(tempTxtPath)) fs.unlinkSync(tempTxtPath);
    throw err;
  }
}

// ============================================================================
// PANDOC EXPORT HANDLER
// ============================================================================
async function exportWithPandoc(content, outputPath, formatConfig) {
  const tempMdPath = outputPath.replace(
    new RegExp(`\\.${formatConfig.ext}$`),
    '.temp.md'
  );

  try {
    let normalized = content;
    normalized = normalized
      .replace(/:\s*-\s+/g, ':\n- ')
      .replace(/\s+-\s+/g, '\n- ')
      .replace(/\s+(\d+)\.\s+/g, '\n$1. ');

    fs.writeFileSync(tempMdPath, normalized, 'utf8');

    const pandocCmd = `pandoc "${tempMdPath}" -o "${outputPath}" ${formatConfig.pandocArgs}`.trim();
    execSync(pandocCmd, { stdio: 'inherit' });

    // ✅ Post-process TXT only
    if (formatConfig.ext === 'txt') {
      let txt = fs.readFileSync(outputPath, 'utf8');
      txt = txt
        .replace(/^\s*-\s+/gm, '• ')
        .replace(/^\s*\[\s\]\s+/gm, '☐ ')
        .replace(/^\s*\[\s*x\s*\]\s+/gim, '☑ ');
      fs.writeFileSync(outputPath, txt, 'utf8');
    }
  } finally {
    if (fs.existsSync(tempMdPath)) fs.unlinkSync(tempMdPath);
  }
}

// ============================================================================
// CUSTOM FORMAT HANDLER ROUTER
// ============================================================================
async function exportWithCustomHandler(content, outputPath, format, fileName) {
  switch(format.toLowerCase()) {
    case 'excel':
    case 'xlsx':
      await exportToExcel(content, outputPath, 'xlsx');
      break;
      
    case 'xls':
      await exportToExcel(content, outputPath, 'xls');
      break;
      
    case 'ods':
      const tempXlsxPath = outputPath.replace('.ods', '.temp.xlsx');
      try {
        await exportToExcel(content, tempXlsxPath, 'xlsx');
        const workbook = XLSX.readFile(tempXlsaxPath);
        XLSX.writeFile(workbook, outputPath, { 
          bookType: 'ods',
          compression: true 
        });
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
      await exportToTSV(content, outputPath);
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
      
    case 'msg':
      exportToMSG(content, outputPath);
      break;
      
    case 'mbox':
      exportToMBOX(content, outputPath);
      break;
      
    case 'zip':
      await exportToZIP(content, outputPath, fileName);
      break;
      
    case 'rar':
      try {
        await exportToRAR(content, outputPath, fileName);
      } catch (err) {
        if (err.message === 'RAR_NOT_AVAILABLE') {
          const newPath = outputPath.replace('.rar', '.zip');
          const newFileName = fileName.replace('.rar', '.zip');
          return { fallback: true, newPath, newFileName, format: 'zip' };
        }
        throw err;
      }
      break;
      
    case '7z':
      try {
        await exportTo7Z(content, outputPath, fileName);
      } catch (err) {
        if (err.message === '7Z_NOT_AVAILABLE') {
          const newPath = outputPath.replace('.7z', '.zip');
          const newFileName = fileName.replace('.7z', '.zip');
          return { fallback: true, newPath, newFileName, format: 'zip' };
        }
        throw err;
      }
      break;
      
    case 'tar.gz':
      await exportToTARGZ(content, outputPath, fileName);
      break;
      
    case 'mdb':
    case 'accdb':
      exportToCSV(content, outputPath);
      console.log(`[MDB/ACCDB] Exported as CSV: ${outputPath}`);
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
  
  return null; // No fallback needed
}
// ============================================================================
// MAIN EXPORT FUNCTION
// ============================================================================
async function exportFile(content, sessId, promptText = '', format = 'docx') {
  try {
    const formatConfig = FORMATS[format.toLowerCase()];
    if (!formatConfig) {
      throw new Error(`Unsupported format: ${format}. Supported formats: ${Object.keys(FORMATS).join(', ')}`);
    }

    const cleaned = cleanExportContent(content);
    let fileName = makeFileName(promptText || cleaned, formatConfig.ext);
    const uploadsDir = ensureUploadDir();
    let outputPath = path.join(uploadsDir, fileName);
    
    let fallbackResult = null;
    
    switch(formatConfig.handler) {
      case 'pandoc':
        await exportWithPandoc(cleaned, outputPath, formatConfig);
        break;
        
      case 'custom':
        fallbackResult = await exportWithCustomHandler(cleaned, outputPath, format, fileName);
        
        // Handle fallback to ZIP for RAR/7Z
        if (fallbackResult && fallbackResult.fallback) {
          fileName = fallbackResult.newFileName;
          outputPath = fallbackResult.newPath;
          console.log(`[FALLBACK] ${format.toUpperCase()} → ZIP: ${fileName}`);
        }
        break;
        
      case 'image':
        await exportToImage(cleaned, outputPath, formatConfig.ext);
        break;
        
      default:
        throw new Error(`Unknown handler type: ${formatConfig.handler}`);
    }
    
    // Verify file exists
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Export file was not created: ${outputPath}`);
    }
    
    return { 
      url: `/uploads/${fileName}`, 
      url: `/uploads/${fileName}`, 
      name: fileName,
      label: fallbackResult ? 'ZIP archive (fallback)' : formatConfig.label,
      format: fallbackResult ? fallbackResult.format : formatConfig.ext
    };
    
  } catch (error) {
    console.error(`Export Error (${format}):`, error);
    throw new Error(`Failed to generate ${format.toUpperCase()}: ${error.message}`);
  }
}

// ============================================================================
// BATCH EXPORT
// ============================================================================
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

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = { 
  exportFile,
  exportBatch,
  makeFileName, 
  cleanExportContent,
  FORMATS,
  getSupportedFormats: () => Object.keys(FORMATS)
};