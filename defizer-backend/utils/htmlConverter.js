// utils/htmlConverter.js - NEW FILE

const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const htmlDocx = require('html-docx-js');
const XLSX = require('xlsx');
const { JSDOM } = require('jsdom');
const { TurndownService } = require('turndown');

const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

async function convertHTMLToFormat(html, targetFormat, outputPath) {
  console.log('[HTML CONVERTER] Converting to', targetFormat);

  switch(targetFormat.toLowerCase()) {
    case 'docx':
    case 'doc':
      await convertHTMLToDocx(html, outputPath);
      break;

    case 'pdf':
      await convertHTMLToPDF(html, outputPath);
      break;

    case 'xlsx':
    case 'xls':
      await convertHTMLToExcel(html, outputPath);
      break;

    case 'txt':
      await convertHTMLToText(html, outputPath);
      break;

    case 'md':
    case 'markdown':
      await convertHTMLToMarkdown(html, outputPath);
      break;

    case 'html':
    case 'htm':
      await fs.writeFile(outputPath, html);
      break;

    default:
      throw new Error(`Conversion to ${targetFormat} not supported`);
  }

  console.log('[HTML CONVERTER] File created:', outputPath);
}

/**
 * HTML → DOCX (using html-docx-js)
 */
async function convertHTMLToDocx(html, outputPath) {
  try {
    const dom = new JSDOM(html);
    const body = dom.window.document.body;
    
    const children = [];
    
    // Process all elements including tables
    const allElements = body.children;
    
    for (const element of allElements) {
      const tagName = element.tagName.toLowerCase();
      
      if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
        const text = element.textContent.trim();
        if (text) {
          children.push(
            new Paragraph({
              text: text,
              heading: tagName === 'h1' ? HeadingLevel.HEADING_1 : 
                       tagName === 'h2' ? HeadingLevel.HEADING_2 : 
                       HeadingLevel.HEADING_3
            })
          );
        }
      } else if (tagName === 'p') {
        const text = element.textContent.trim();
        if (text) {
          children.push(
            new Paragraph({
              children: [new TextRun(text)]
            })
          );
        }
      } else if (tagName === 'ul' || tagName === 'ol') {
        // Process list items
        const items = element.querySelectorAll('li');
        items.forEach(li => {
          const text = li.textContent.trim();
          if (text) {
            children.push(
              new Paragraph({
                text: text,
                bullet: { level: 0 }
              })
            );
          }
        });
      } else if (tagName === 'table') {
        // Process table
        const tableElement = processHTMLTable(element);
        if (tableElement) {
          children.push(tableElement);
        }
      }
    }
    function processHTMLTable(tableElement) {
  try {
    const rows = tableElement.querySelectorAll('tr');
    if (rows.length === 0) return null;
    
    const tableRows = [];
    
    rows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      const tableCells = [];
      
      cells.forEach(cell => {
        const text = cell.textContent.trim();
        tableCells.push(
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun(text)]
              })
            ]
          })
        );
      });
      
      if (tableCells.length > 0) {
        tableRows.push(new TableRow({ children: tableCells }));
      }
    });
    
    if (tableRows.length > 0) {
      return new Table({
        rows: tableRows
      });
    }
    
    return null;
  } catch (error) {
    console.error('[TABLE PROCESSING ERROR]', error);
    return null;
  }
}
    // Fallback: if no children, add all text
    if (children.length === 0) {
      const allText = body.textContent.trim();
      const lines = allText.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        children.push(
          new Paragraph({
            children: [new TextRun(line.trim())]
          })
        );
      }
    }
    
    // Create document
    const doc = new Document({
      sections: [{
        children: children
      }]
    });
    
    // Generate buffer
    const buffer = await Packer.toBuffer(doc);
    
    // Write to file
    await fs.writeFile(outputPath, buffer);
    console.log('[HTML CONVERTER] DOCX created with tables successfully');
    
  } catch (error) {
    console.error('[HTML CONVERTER ERROR]', error);
    throw new Error(`Failed to convert HTML to DOCX: ${error.message}`);
  }
}
/**
 * HTML → PDF (using Puppeteer)
 */
async function convertHTMLToPDF(html, outputPath) {
  const browser = await puppeteer.launch({ 
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  await page.pdf({
    path: outputPath,
    format: 'A4',
    margin: {
      top: '20mm',
      right: '20mm',
      bottom: '20mm',
      left: '20mm'
    },
    printBackground: true
  });
  
  await browser.close();
}

/**
 * HTML → Excel (extract tables)
 */
async function convertHTMLToExcel(html, outputPath) {
  const dom = new JSDOM(html);
  const tables = dom.window.document.querySelectorAll('table');
  
  if (tables.length === 0) {
    // No tables, convert content to spreadsheet
    const text = dom.window.document.body.textContent;
    const lines = text.split('\n').filter(line => line.trim());
    const data = lines.map(line => [line]);
    
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, outputPath);
  } else {
    // Convert tables to Excel
    const workbook = XLSX.utils.book_new();
    
    tables.forEach((table, index) => {
      const worksheet = XLSX.utils.table_to_sheet(table);
      XLSX.utils.book_append_sheet(workbook, worksheet, `Sheet${index + 1}`);
    });
    
    XLSX.writeFile(workbook, outputPath);
  }
}

/**
 * HTML → Plain Text
 */
async function convertHTMLToText(html, outputPath) {
  const dom = new JSDOM(html);
  const text = dom.window.document.body.textContent
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  
  await fs.writeFile(outputPath, text);
}

/**
 * HTML → Markdown (using Turndown)
 */
async function convertHTMLToMarkdown(html, outputPath) {
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced'
  });
  
  const markdown = turndownService.turndown(html);
  await fs.writeFile(outputPath, markdown);
}

module.exports = {
  convertHTMLToFormat,
  convertHTMLToDocx,
  convertHTMLToPDF,
  convertHTMLToExcel,
  convertHTMLToText,
  convertHTMLToMarkdown
};