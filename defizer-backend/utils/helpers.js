const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const { EXPORT_CLEANER_SYSTEM_PROMPT } = require('./promts');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)
);
function isPureExportCommand(msg = '') {
  const text = String(msg || '').toLowerCase().trim();

  // Very long messages usually contain real content instructions
  if (text.length > 220) return false;

  const hasExportKeyword = /(export|word|pdf|docx?|excel|file|download|document|doc file|word file|save as)/.test(text);

  // If no export keywords at all, definitely not pure export
  if (!hasExportKeyword) return false;

  // Content / modification intent → then it's NOT pure export
  const hasContentKeyword = /(what is|who is|explain|write|generate|create|draft|prepare|make|analysis|report|summary|summarize|article|blog|email|letter|proposal|contract|terms and conditions|policy|combine|merge|update|edit|improve|rewrite|continue|add section|add point|add more|describe|change|modify|convert|transform|alter|switch|replace|make it|turn|bullets?|numbered|list|analyze|review|check|read)/.test(text);

  // If it has both export AND content/modification words, it's NOT pure export
  if (hasContentKeyword) {
    return false;
  }

  // Check if it's a standalone export command
  const standaloneExportPatterns = [
    /^\s*(download|export|save)\s+(?:it|this|that|the)\s+(?:as|into|in|to)\s+\w+\s*$/i,
    /^\s*(give me|provide)\s+(?:a|an)?\s*(pdf|word|docx?|excel|xlsx?|csv|tsv)\s*(?:file)?\s*$/i,
    /^\s*(convert|turn)\s+(?:it|this|that|the)\s+(?:into|to|as)\s+\w+\s*$/i,
    /^\s*(download|export)\s+(?:our|this)?\s*(?:conversation|chat)\s*$/i,
  ];

  const isStandaloneExport = standaloneExportPatterns.some(pattern => pattern.test(text));
  
  return isStandaloneExport;
}

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


// Decide WHAT EXACT TEXT to export
function pickContentForExport({ allMessages = [], finalOutput = '', userMessage = '' }) {
  const safeMessages = Array.isArray(allMessages) ? allMessages : [];
  const scope = detectExportScope(userMessage);
  const pureExport = isPureExportCommand(userMessage);

  // NOT pure export → user asked for new content + export
  // e.g. "What is Angular and give me a Word document for this"
  if (!pureExport) {
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

function detectExportIntent(message = '') {
  if (!message) return { pdf: false, word: false, excel: false, image: false, generic: false };

  const msg = message.toLowerCase();

  // Add typo-tolerant patterns!
  const wordType = /\b(word|docx?|document|documnet|documnt)\b/;
  const pdfType = /\b(pdf|\.pdf)\b/;
  const excelType = /\b(excel|xlsx?|\.xlsx?)\b/;
  const imageType = /\b(jpg|jpeg|png|gif|bmp|tiff|image|picture|photo|screenshot)\b/;

  // "as word", "as docx", etc
  const wordPhrase = /(in|as|into|to|on|as a|as an)\s+(word|docx?|docoument|documnet|documnt)\b/;
  const pdfPhrase = /(in|as|into|to|on|as a|as an)\s+pdf\b/;
  const excelPhrase = /(in|as|into|to|on|as a|as an)\s+(excel|xlsx?)\b/;
  const imagePhrase = /(in|as|into|to|on|as a|as an)\s+(jpg|jpeg|png|gif|bmp|tiff|image|picture|photo)\b/;

  const exportVerbs = /(export|download|save|generate|create|deliver|send|prepare|produce|turn|make|give|get|provide|output|issue|write|print|capture|screenshot|snap)\b/;
  const genericExport = /(report|summary|print\s?out|copy of this|copy of|send me|deliver|can i have|give me a copy|get a file|get this file|get a version|file version|downloadable|output this)\b/;

  // Prioritize: Image > Word > Excel > PDF
  const image = (imageType.test(msg) || imagePhrase.test(msg));
  const word = (wordType.test(msg) || wordPhrase.test(msg)) && !image;
  const excel = (excelType.test(msg) || excelPhrase.test(msg)) && !word && !image;
  const pdf = (pdfType.test(msg) || pdfPhrase.test(msg)) && !word && !excel && !image;
  const generic = (exportVerbs.test(msg) || genericExport.test(msg)) && !(pdf || word || excel || image);

  return { pdf, word, excel, image, generic };
}
async function resolveExportType(message, intent) {
  let doExport = false;
  let exportType = 'docx';
  
  // First check the intent object
  if (intent) {
    if (intent.image) {
      doExport = true;
      // Determine which image format
      const msg = (message || '').toLowerCase();
      if (/\bjpe?g\b/.test(msg)) exportType = 'jpg';
      else if (/\bpng\b/.test(msg)) exportType = 'png';
      else if (/\bgif\b/.test(msg)) exportType = 'gif';
      else if (/\bbmp\b/.test(msg)) exportType = 'bmp';
      else if (/\btiff?\b/.test(msg)) exportType = 'tiff';
      else exportType = 'png'; // default
    } else if (intent.mdb) {
      doExport = true;
      exportType = 'mdb';
    } else if (intent.accdb) {
      doExport = true;
      exportType = 'accdb';
    } else if (intent.ods) {
      doExport = true;
      exportType = 'ods';
    } else if (intent.odt) {
      doExport = true;
      exportType = 'odt';
    } else if (intent.odp) {
      doExport = true;
      exportType = 'odp';
    } else if (intent.csv) {
      doExport = true;
      exportType = 'csv';
    } else if (intent.tsv) {
      doExport = true;
      exportType = 'tsv';
    } else if (intent.word || intent.docx || intent.doc) {
      doExport = true;
      exportType = 'docx';
    } else if (intent.excel || intent.xlsx || intent.xls) {
      doExport = true;
      exportType = 'xlsx';
    } else if (intent.pdf) {
      doExport = true;
      exportType = 'pdf';
    } else if (intent.pptx || intent.ppt) {
      doExport = true;
      exportType = 'pptx';
    } else if (intent.txt) {
      doExport = true;
      exportType = 'txt';
    } else if (intent.rtf) {
      doExport = true;
      exportType = 'rtf';
    } else if (intent.html || intent.htm) {
      doExport = true;
      exportType = 'html';
    } else if (intent.xml) {
      doExport = true;
      exportType = 'xml';
    } else if (intent.markdown || intent.md) {
      doExport = true;
      exportType = 'md';
    } else if (intent.zip) {
      doExport = true;
      exportType = 'zip';
    } else if (intent.rar) {
      doExport = true;
      exportType = 'rar';
    } else if (intent['7z']) {
      doExport = true;
      exportType = '7z';
    } else if (intent.targz) {
      doExport = true;
      exportType = 'tar.gz';
    } else if (intent.ics) {
      doExport = true;
      exportType = 'ics';
    } else if (intent.vcf || intent.vcard) {
      doExport = true;
      exportType = 'vcf';
    } else if (intent.eml) {
      doExport = true;
      exportType = 'eml';
    } else if (intent.msg) {
      doExport = true;
      exportType = 'msg';
    } else if (intent.mbox) {
      doExport = true;
      exportType = 'mbox';
    } else if (intent.mp4) {
      doExport = true;
      exportType = 'mp4';
    } else if (intent.mp3) {
      doExport = true;
      exportType = 'mp3';
    } else if (intent.wav) {
      doExport = true;
      exportType = 'wav';
    } else if (intent.gif) {
      doExport = true;
      exportType = 'gif';
    } else if (intent.jpg || intent.jpeg) {
      doExport = true;
      exportType = 'jpg';
    } else if (intent.png) {
      doExport = true;
      exportType = 'png';
    } else if (intent.bmp) {
      doExport = true;
      exportType = 'bmp';
    } else if (intent.tiff) {
      doExport = true;
      exportType = 'tiff';
    } else if (intent.generic) {
      doExport = true;
      exportType = 'docx'; 
    }
  }
  
  if (!doExport || !exportType) {
    const msg = (message || '').toLowerCase();
    const formatPatterns = [
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(mdb|access\s+database|ms\s+access)\b/i, format: 'mdb' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(accdb|access\s+2007)\b/i, format: 'accdb' },
      { regex: /\b(mdb|\.mdb|access\s+database)\b/i, format: 'mdb' },
      { regex: /\b(accdb|\.accdb)\b/i, format: 'accdb' },
      
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(ods|opendocument\s+spreadsheet)\b/i, format: 'ods' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(odt|opendocument\s+text)\b/i, format: 'odt' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(odp|opendocument\s+presentation)\b/i, format: 'odp' },
      { regex: /\b(ods|\.ods|libreoffice\s+spreadsheet)\b/i, format: 'ods' },
      { regex: /\b(odt|\.odt|libreoffice\s+document)\b/i, format: 'odt' },
      { regex: /\b(odp|\.odp|libreoffice\s+presentation)\b/i, format: 'odp' },
      
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(jpg|jpeg)\b/i, format: 'jpg' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(png)\b/i, format: 'png' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(gif)\b/i, format: 'gif' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(bmp)\b/i, format: 'bmp' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(tiff?)\b/i, format: 'tiff' },
      
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(xlsx|excel)\b/i, format: 'xlsx' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(csv)\b/i, format: 'csv' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(tsv)\b/i, format: 'tsv' },
      
       { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(docx?|word)\b/i, format: 'docx' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(pdf)\b/i, format: 'pdf' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(pptx?|powerpoint)\b/i, format: 'pptx' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(txt|text)\b/i, format: 'txt' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(html?)\b/i, format: 'html' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(rtf)\b/i, format: 'rtf' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(md|markdown)\b/i, format: 'md' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(xml)\b/i, format: 'xml' },
      { regex: /\b(?:into|as|to|in)\s+(?:an?\s+)?(zip)\b/i, format: 'zip' },
      
      { regex: /\b(jpg|jpeg)\s+(?:file|image|format)\b/i, format: 'jpg' },
      { regex: /\b(png)\s+(?:file|image|format)\b/i, format: 'png' },
      { regex: /\b(gif)\s+(?:file|image|format)\b/i, format: 'gif' },
      { regex: /\b(xlsx|excel)\s+(?:file|document)\b/i, format: 'xlsx' },
      { regex: /\b(csv)\s+(?:file|format)\b/i, format: 'csv' },
      { regex: /\b(ods)\s+(?:file|spreadsheet)\b/i, format: 'ods' },
      { regex: /\b(odt)\s+(?:file|document)\b/i, format: 'odt' },
      { regex: /\b(docx?|word)\s+(?:file|document)\b/i, format: 'docx' },
      { regex: /\b(pdf)\s+(?:file|document)\b/i, format: 'pdf' },
      
      { regex: /\bjpe?g\b/i, format: 'jpg' },
      { regex: /\bpng\b/i, format: 'png' },
      { regex: /\bgif\b/i, format: 'gif' },
      { regex: /\bods\b/i, format: 'ods' },
      { regex: /\bodt\b/i, format: 'odt' },
      { regex: /\bexcel\b/i, format: 'xlsx' },
      { regex: /\bword\b/i, format: 'docx' },
      { regex: /\bpdf\b/i, format: 'pdf' }
    ];

    const hasExportKeyword = /\b(export|download|save|generate|create|deliver|send|give me|convert|turn|make|capture|screenshot|snap)\b/i.test(msg);
    
    if (hasExportKeyword) {
      doExport = true;
      
      for (const pattern of formatPatterns) {
        if (pattern.regex.test(msg)) {
          exportType = pattern.format;
          break;
        }
      }
    }
  }

  console.log('[RESOLVE EXPORT TYPE]', { 
    message: message?.slice(0, 100),
    intent,
    doExport, 
    exportType 
  });

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
  isPureExportCommand,
  detectExportScope,
  looksLikeExportLink,
  buildAggregatedAssistantContent,
  pickContentForExport,
  detectExportIntent,
  resolveExportType,
  classifyExportIntentWithGPT,
  getExportHtmlFromContent
};
