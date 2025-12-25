const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const { detectExportIntent } = require('./detectExportIntent');
const { EXPORT_CLEANER_SYSTEM_PROMPT } = require('./promts');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)
);

function detectExportScope(msg = '') {
  const text = String(msg || '').toLowerCase();
  const hasExportKeyword = /(export|word|pdf|docx?|excel|file|download|document|doc file|word file|save as)/.test(text);

  const mentionsAll = hasExportKeyword && /(all content|everything together|entire chat|entire conversation|whole chat|all the above|all we discussed|complete report|full report|full conversation|entire history|all your answers|entire discussion)/.test(text);
  if (mentionsAll) return 'all';

  const mentionsPrevious = hasExportKeyword && /\b(this|above|that answer|that response|last reply|previous reply|previous answer|last message|last explanation)\b/.test(text);
  if (mentionsPrevious) return 'previous';

  return 'current';
}

function looksLikeExportLink(text = '') {
  const lower = String(text || '').toLowerCase();
  if (!lower) return false;

  if (lower.includes('download your pdf')) return true;
  if (lower.includes('download your word document')) return true;
  if (lower.includes('download your excel file')) return true;
  if (lower.includes('download the file')) return true;
  if (/\[.*download.*\]\(https?:\/\//i.test(text)) return true;

  return false;
}
async function detectDocumentIntent(userMessage, OPENAI_API_KEY) {
  const prompt = `You are analyzing user intent for document operations.

USER MESSAGE: "${userMessage}"

Classify the intent into ONE of these categories:

1. "ANALYZE" - User wants to READ, UNDERSTAND, or GET INFORMATION from the document
   Examples: summarize, explain, what's in this, tell me about, analyze, review, extract info

2. "MODIFY" - User wants to CHANGE, EDIT, or UPDATE the document content
   Examples: change, replace, update, edit, modify, add, remove, delete, fix, correct

3. "EXPORT" - User wants to CONVERT or DOWNLOAD in a different format
   Examples: convert to PDF, export as Excel, download as Word

Return ONLY a JSON object:
{
  "intent": "ANALYZE" | "MODIFY" | "EXPORT",
  "confidence": "high" | "medium" | "low",
  "reason": "brief explanation"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini', // Faster and cheaper for classification
        messages: [
          { 
            role: 'system', 
            content: 'You are a document intent classifier. Return only valid JSON.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 150
      })
    });

    const data = await response.json();
    let result = data.choices?.[0]?.message?.content?.trim() || '{}';
    
    // Clean markdown artifacts
    result = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    const parsed = JSON.parse(result);
    
    console.log('[DOCUMENT INTENT]', parsed);
    
    return {
      intent: parsed.intent || 'ANALYZE',
      confidence: parsed.confidence || 'low',
      reason: parsed.reason || 'Default classification'
    };
    
  } catch (error) {
    console.error('[DOCUMENT INTENT ERROR]', error);
    // Safe fallback: default to ANALYZE (safer than modifying)
    return {
      intent: 'ANALYZE',
      confidence: 'low',
      reason: 'Error in classification, defaulting to safe mode'
    };
  }
}

module.exports = { detectDocumentIntent };
// Build a clean “combined report” from big assistant replies only
function buildAggregatedAssistantContent(allMessages = []) {
  const safeMessages = Array.isArray(allMessages) ? allMessages : [];
  const MIN_LEN = 80;
  const MAX_SECTIONS = 10;

  const sections = [];

  for (const m of safeMessages) {
    if (!m || m.sender !== 'bot') continue;
    const text = (m.message || '').trim();
    if (!text || text.length < MIN_LEN) continue;
    if (looksLikeExportLink(text)) continue;

    sections.push(text);
  }

  if (!sections.length) return '';

  const selected = sections.slice(-MAX_SECTIONS);

  return selected.join('\n\n---\n\n');
}
async function extractContentRequest(message, OPENAI_API_KEY) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `
You remove export/download instructions from user messages in ANY language.

Return ONLY JSON:
{
  "contentRequest": string
}

Rules:
- Remove phrases related to exporting, downloading, saving, converting, or file formats
- Preserve the original language of the content request
- Do NOT translate
- Do NOT rephrase unless required
- If message is ONLY export-related, return empty string

Examples:
"Explain JWT and export as PDF"
→ { "contentRequest": "Explain JWT" }

"JWT क्या है इसे PDF में डाउनलोड करें"
→ { "contentRequest": "JWT क्या है" }

"Crear un informe y descargar en Word"
→ { "contentRequest": "Crear un informe" }
`
          },
          { role: "user", content: message }
        ],
      }),
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    return result.contentRequest || "";

  } catch (e) {
    console.error("[CONTENT EXTRACTION ERROR]", e);
    return message; // safe fallback
  }
}


// Decide WHAT EXACT TEXT to export
function pickContentForExport({ allMessages = [], finalOutput = '', userMessage = '',isPureExport }) {
  console.log("🚀 ~ pickContentForExport ~ finalOutput:", finalOutput)
  console.log("🚀 ~ pickContentForExport ~ isPureExport:", isPureExport)
  console.log("🚀 ~ pickContentForExport ~ allMessages:", allMessages)
  const safeMessages = Array.isArray(allMessages) ? allMessages : [];
  const scope = detectExportScope(userMessage);
  if (!isPureExport) {
    return finalOutput || '';
  }

  // PURE export message
  if (scope === 'all') {
    const aggregated = buildAggregatedAssistantContent(safeMessages);
    return aggregated || finalOutput || '';
  }

  // 'previous' or 'current' → last meaningful bot answer
  const reversed = [...safeMessages].reverse();
  const lastBotReply = reversed.find(m =>
    m &&
    m.sender === 'bot' &&
    typeof m.message === 'string' &&
    m.message.trim().length > 80 &&
    !looksLikeExportLink(m.message)
  );

  if (lastBotReply && lastBotReply.message) {
    return lastBotReply.message;
  }

  // Fallback
  return finalOutput || '';
}


async function resolveExportType(message = '', intent = {}) {
  let doExport = false;
  let exportType = 'docx';

  const msg = message.toLowerCase();
  const intentMap = {
    pdf: 'pdf',
    docx: 'docx',
    doc: 'docx',
    word: 'docx',
    excel: 'xlsx',
    xlsx: 'xlsx',
    xls: 'xlsx',
    csv: 'csv',
    tsv: 'tsv',
    txt: 'txt',
    rtf: 'rtf',
    html: 'html',
    xml: 'xml',
    md: 'md',
    markdown: 'md',
    ppt: 'pptx',
    pptx: 'pptx',
    zip: 'zip',
    rar: 'rar',
    '7z': '7z',
    ods: 'ods',
    odt: 'odt',
    odp: 'odp',
    mdb: 'mdb',
    accdb: 'accdb',
    mp4: 'mp4',
    mp3: 'mp3',
    wav: 'wav',
    gif: 'gif',
    jpg: 'jpg',
    jpeg: 'jpg',
    png: 'png',
    bmp: 'bmp',
    tiff: 'tiff'
  };
  for (const key in intentMap) {
    if (intent[key]) {
      doExport = true;
      exportType = intentMap[key];
      return { doExport, exportType };
    }
  }
  const exportKeywords =
    /\b(export|download|save|convert|generate|create|give me|send)\b/i;

  if (!exportKeywords.test(msg)) {
    return { doExport, exportType };
  }

  doExport = true;

  const regexMap = [
    { r: /\bpdf\b/, f: 'pdf' },
    { r: /\bexcel|xlsx\b/, f: 'xlsx' },
    { r: /\bword|docx?\b/, f: 'docx' },
    { r: /\bcsv\b/, f: 'csv' },
    { r: /\btxt\b/, f: 'txt' },
    { r: /\bhtml?\b/, f: 'html' },
    { r: /\bmd|markdown\b/, f: 'md' },
    { r: /\bpng\b/, f: 'png' },
    { r: /\bjpe?g\b/, f: 'jpg' },
    { r: /\bgif\b/, f: 'gif' }
  ];

  for (const { r, f } of regexMap) {
    if (r.test(msg)) {
      exportType = f;
      break;
    }
  }

  console.log('[EXPORT RESOLUTION]', { doExport, exportType });

  return { doExport, exportType };
}

async function classifyExportIntentWithGPT(message) {
  const prompt = `
User message: "${message}"

Does the user want to export or download content? If yes, what file type? Only output minified JSON.

Supported formats: pdf, word, excel, rtf, txt, html, markdown, pptx, odt, xml, jpg, jpeg, png, gif, bmp, tiff

Examples:
- {"export": true, "type": "pdf"}
- {"export": true, "type": "word"}
- {"export": true, "type": "jpg"}
- {"export": true, "type": "png"}
- {"export": true, "type": "excel"}
- {"export": false}

If unsure, output {"export": false}.
`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: prompt }]
    })
  });
  const data = await resp.json();
  try {
    return JSON.parse(data.choices?.[0]?.message?.content.trim());
  } catch {
    return { export: false };
  }
}

async function getExportHtmlFromContent(fullContent) {
  const messages = await [
    {
      role: 'system',
      content: EXPORT_CLEANER_SYSTEM_PROMPT                                                       
    },
    {
      role: 'user',
      content: `
                Here is the full content (may include CTAs, questions, etc.).
                Extract ONLY the export-ready version as clean HTML and respond as JSON.

                [CONTENT_START]
                ${fullContent}
                [CONTENT_END]
                      `.trim()
    }
  ];

  return messages
}

module.exports = {
  detectExportScope,
  looksLikeExportLink,
  buildAggregatedAssistantContent,
  pickContentForExport,
  resolveExportType,
  classifyExportIntentWithGPT,
  extractContentRequest,
  getExportHtmlFromContent,
  detectDocumentIntent
};
