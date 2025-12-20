// utils/aiHtmlGenerator.js - NEW FILE

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * AI generates HTML from document content
 * This is what your TL wants - AI creates the HTML structure
 */
async function generateHTMLFromContent(extractedText, originalFormat, metadata = {}) {
  const prompt = `You are an expert HTML generator. Convert this document content into clean, semantic HTML.

DOCUMENT CONTENT:
"""
${extractedText}
"""

ORIGINAL FORMAT: ${originalFormat}
${metadata.hasImages ? 'Document contains images (preserve image placeholders)' : ''}
${metadata.hasTables ? 'Document contains tables (convert to HTML tables)' : ''}
${metadata.hasLists ? 'Document contains lists (use <ul>/<ol> tags)' : ''}

INSTRUCTIONS:
1. Generate complete, valid HTML5 document
2. Preserve document structure (headings, paragraphs, lists, tables)
3. Use semantic HTML tags (<article>, <section>, <header>, etc.)
4. Add proper CSS for styling (inline or <style> tag)
5. Maintain the original document's visual hierarchy
6. For tables: use <table>, <thead>, <tbody>, <tr>, <th>, <td>
7. For lists: use <ul>/<ol> with <li>
8. For emphasis: use <strong>, <em>, <mark>
9. Make it look professional and clean
10. Return ONLY the HTML code, no explanations

GENERATE HTML:`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: 'You are an HTML generator. Return only valid HTML code, no markdown formatting.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2 // Lower temperature for more consistent HTML
    })
  });

  const data = await response.json();
  let html = data.choices?.[0]?.message?.content || '';
  
  // Clean up any markdown code blocks AI might add
  html = html
    .replace(/```html\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();
  
  // Ensure it's valid HTML
  if (!html.includes('<html') && !html.includes('<!DOCTYPE')) {
    html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Document</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
${html}
</body>
</html>`;
  }
  
  console.log('[AI HTML GENERATOR] Generated HTML:', html.length, 'characters');
  return html;
}

/**
 * AI modifies existing HTML based on user request
 */
async function modifyHTMLWithAI(currentHTML, userRequest) {
  const prompt = `You are an HTML editor. Modify the HTML document according to the user's request.

CURRENT HTML:
\`\`\`html
${currentHTML}
\`\`\`

USER REQUEST: "${userRequest}"

INSTRUCTIONS:
1. Make the requested changes to the HTML
2. Preserve the overall structure and styling
3. Keep all valid HTML tags and attributes
4. Maintain proper HTML5 syntax
5. If adding content, match the existing style
6. If removing content, ensure HTML remains valid
7. If reformatting, maintain semantic structure
8. Return ONLY the complete modified HTML, no explanations

MODIFIED HTML:`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { 
          role: 'system', 
          content: 'You are an HTML editor. Return only valid HTML code, no markdown or explanations.' 
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    })
  });

  const data = await response.json();
  let modifiedHTML = data.choices?.[0]?.message?.content || currentHTML;
  
  // Clean up markdown formatting
  modifiedHTML = modifiedHTML
    .replace(/```html\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();
  
  console.log('[AI HTML MODIFIER] Modified HTML:', modifiedHTML.length, 'characters');
  return modifiedHTML;
}

/**
 * Detect document metadata for better HTML generation
 */
function analyzeDocumentStructure(extractedText) {
  return {
    hasTables: /\|.*\|/.test(extractedText) || /\t.*\t/.test(extractedText),
    hasLists: /^[\s]*[-*•]\s/m.test(extractedText) || /^\d+\.\s/m.test(extractedText),
    hasHeadings: /^#{1,6}\s/m.test(extractedText) || /^[A-Z][^.!?]*$/m.test(extractedText),
    hasImages: /\[image\]|\(image\)|<img/i.test(extractedText),
    hasBold: /\*\*.*\*\*|__.*__/g.test(extractedText),
    hasItalic: /\*.*\*|_.*_/g.test(extractedText),
    wordCount: extractedText.split(/\s+/).length,
    lineCount: extractedText.split('\n').length
  };
}

module.exports = {
  generateHTMLFromContent,
  modifyHTMLWithAI,
  analyzeDocumentStructure
};