// utils/aiDocumentReader.js - NEW FILE

const fs = require('fs').promises;
const path = require('path');

/**
 * AI READS DOCUMENT DIRECTLY and generates HTML
 * Uses OpenAI's file/document understanding capability
 */
async function aiReadDocumentAndGenerateHTML(filePath, originalFormat, userRequest = '', OPENAI_API_KEY) {
  console.log('[AI DOCUMENT READER] Reading file directly:', filePath);

  try {
    // Read file as base64 (for sending to AI)
    const fileBuffer = await fs.readFile(filePath);
    const base64File = fileBuffer.toString('base64');
    
    // Determine MIME type
    const mimeTypes = {
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'doc': 'application/msword',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xls': 'application/vnd.ms-excel',
      'pdf': 'application/pdf',
      'txt': 'text/plain',
      'md': 'text/markdown'
    };
    
    const mimeType = mimeTypes[originalFormat.toLowerCase()] || 'application/octet-stream';

    const prompt = `You are a document processor with the ability to read and understand documents.

TASK: 
1. Read and analyze this ${originalFormat.toUpperCase()} document
2. Understand its complete structure (headings, paragraphs, tables, lists, formatting)
3. Generate a well-structured HTML representation of this document
${userRequest ? `4. Apply this modification: "${userRequest}"` : ''}

REQUIREMENTS:
- Generate clean, semantic HTML5
- Preserve document structure (headings → <h1>/<h2>, lists → <ul>/<ol>, tables → <table>)
- Add professional CSS styling
- Make it readable and well-organized
${userRequest ? `- Apply the user's requested modifications` : ''}

Return ONLY complete HTML code (with <!DOCTYPE>, <html>, <head>, <style>, <body>).
No explanations, no markdown formatting, just pure HTML.

HTML OUTPUT:`;

    // Call OpenAI with document
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o', // gpt-4o supports document understanding
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: base64File
                }
              }
            ]
          }
        ],
        temperature: 0.3
      })
    });

    const data = await response.json();
    
    if (data.error) {
      console.error('[AI DOCUMENT READER ERROR]', data.error);
      throw new Error(data.error.message || 'AI failed to read document');
    }

    let html = data.choices?.[0]?.message?.content || '';
    
    // Clean up markdown formatting
    html = html
      .replace(/```html\n?/gi, '')
      .replace(/```\n?/g, '')
      .trim();
    
    // Ensure complete HTML
    if (!html.includes('<!DOCTYPE') && !html.includes('<html')) {
      html = wrapInHTMLDocument(html);
    }
    
    console.log('[AI DOCUMENT READER] ✓ Generated HTML:', html.length, 'characters');
    return html;

  } catch (error) {
    console.error('[AI DOCUMENT READER ERROR]', error);
    throw error;
  }
}

/**
 * AI modifies existing HTML
 */
async function aiModifyHTML(html, userRequest, OPENAI_API_KEY) {
  console.log('[AI HTML MODIFIER] Modifying HTML...');

  const prompt = `You are an HTML editor.

CURRENT HTML:
\`\`\`html
${html}
\`\`\`

USER REQUEST: "${userRequest}"

TASK: Modify the HTML according to the user's request.
- Keep all existing structure unless modification requires changes
- Apply modifications accurately
- Return complete, valid HTML

Return ONLY the modified HTML code.

MODIFIED HTML:`;

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
          content: 'You are an HTML editor. Return only valid HTML code.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();
  let modifiedHTML = data.choices?.[0]?.message?.content || html;
  
  modifiedHTML = modifiedHTML
    .replace(/```html\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();
  
  console.log('[AI HTML MODIFIER] ✓ Modified HTML:', modifiedHTML.length, 'characters');
  return modifiedHTML;
}

function wrapInHTMLDocument(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 900px;
            margin: 30px auto;
            padding: 30px;
            line-height: 1.8;
            color: #333;
        }
        h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
        h2 { color: #34495e; margin-top: 30px; border-left: 4px solid #3498db; padding-left: 15px; }
        h3 { color: #555; margin-top: 20px; }
        table { border-collapse: collapse; width: 100%; margin: 25px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        th, td { border: 1px solid #ddd; padding: 14px; text-align: left; }
        th { background-color: #3498db; color: white; font-weight: bold; }
        tr:nth-child(even) { background-color: #f9f9f9; }
        ul, ol { margin: 20px 0; padding-left: 35px; }
        li { margin: 10px 0; }
        p { margin: 15px 0; }
        strong { color: #2c3e50; font-weight: 600; }
    </style>
</head>
<body>
${content}
</body>
</html>`;
}

module.exports = {
  aiReadDocumentAndGenerateHTML,
  aiModifyHTML
};