// routes/chat.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const mammoth = require('mammoth');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { pool } = require('../db');
const { authenticate } = require('../middleware/authenticate');

// ===== UPDATED IMPORT - Use universal exportFile =====
const { exportFile, cleanExportContent } = require('../fileGenerators');
// Remove these old imports if they exist:
// const { pdfExport, wordExport, excelExport } = require('../fileGenerators');

const { latestWebSearch, extractReadableContent } = require('../utils/webSearch.js');
const { generateExportTitle } = require('../utils/generateExportTitle');
const { scrapePageGeneral } = require('../utils/scrapePageGeneral');
const { getWeather } = require('../utils/weather');
const { callOpenAI } = require('../services/openAi.service');

// ==== Engine imports and mappings ====
const businessEngine = require('../engines/business');
const astrologyEngine = require('../engines/astrology');
const businessAcquisitionEngine = require('../engines/businessAcquisition');
const riskLegalComplianceEngine = require('../engines/riskLegalCompliance');
const websiteGrowthEngine = require('../engines/websiteGrowth');
const beilisEngine = require('../engines/beilis');
const opportunityEngine = require('../engines/opportunity');
const marketingCampaignEngine = require('../engines/marketingCampaign');
const operationsOptimizationEngine = require('../engines/operationsOptimization');
const technologyIntegrationEngine = require('../engines/technologyIntegration');
const financialPlanningEngine = require('../engines/financialPlanning');
const studySkillsEngine = require('../engines/studySkills');
const academicPlanningEngine = require('../engines/academicPlanning');
const careerReadinessEngine = require('../engines/careerReadiness');
const wellbeingEngine = require('../engines/wellbeing');
const researchSkillsEngine = require('../engines/researchSkills');

const {
  isPureExportCommand,
  looksLikeExportLink, 
  buildAggregatedAssistantContent, 
  pickContentForExport,
  resolveExportType,
  classifyExportIntentWithGPT,
  getExportHtmlFromContent
} = require('../utils/helpers');

const { detectExportIntent } = require("../utils/detectExportIntent.js");

const engines = {
  business: businessEngine,
  astrology: astrologyEngine,
  businessAcquisition: businessAcquisitionEngine,
  riskLegalCompliance: riskLegalComplianceEngine,
  websiteGrowth: websiteGrowthEngine,
  opportunity: opportunityEngine,
  marketingCampaign: marketingCampaignEngine,
  operationsOptimization: operationsOptimizationEngine,
  technologyIntegration: technologyIntegrationEngine,
  financialPlanning: financialPlanningEngine,
  studySkills: studySkillsEngine,
  academicPlanning: academicPlanningEngine,
  careerReadiness: careerReadinessEngine,
  wellbeing: wellbeingEngine,
  researchSkills: researchSkillsEngine,
  beilis: beilisEngine
};

const engineKeyMap = {
  astrology: 'astrology',
  websitegrowth: 'websiteGrowth',
  risklegalcompliance: 'riskLegalCompliance',
  businessacquisition: 'businessAcquisition',
  business: 'business',
  opportunity: 'opportunity',
  beilis: 'beilis',
  marketingcampaign: 'marketingCampaign',
  operationsoptimization: 'operationsOptimization',
  technologyintegration: 'technologyIntegration',
  financialplanning: 'financialPlanning',
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage });

// Helper: Detect weather queries
function isWeatherQuery(msg) {
  if (!msg) return null;
  const match = msg.match(/\b(?:weather|temperature|forecast)\s+(?:in|for)?\s*([a-zA-Z\s]+)/i);
  return match ? match[1].trim() : null;
}

// Helper: clean extracted text
function cleanExtractedText(text) {
  return (text || '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// Helper: chunk big text
function chunkText(text, chunkSize = 5000) {
  const out = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    out.push(text.slice(i, i + chunkSize));
  }
  return out;
}

function findFirstExportableBotReply(allMessages, userExportPrompt) {
  let foundExportPrompt = false;
  for (const m of allMessages) {
    if (!foundExportPrompt &&
        m.sender === 'user' &&
        m.message &&
        /deliver|export|word|pdf|report|generate|download/i.test(m.message)) {
      foundExportPrompt = true;
      continue;
    }
    if (
      foundExportPrompt &&
      (m.sender === 'bot' || m.role === 'assistant') &&
      m.message &&
      m.message.length > 400 &&
      /\d\.\s|\bsection\b|agreement|executive|summary|overview|purpose|assets|clauses?|warranty|indemnification|table of contents/i.test(m.message)
    ) {
      return m;
    }
  }
  return [...allMessages]
    .reverse()
    .find(m => (m.sender === 'bot' || m.role === 'assistant') && m.message && m.message.length > 400) || null;
}

// Helper: summarize chunk with OpenAI
async function summarizeChunkWithAI(chunk, filename, chunkIndex, totalChunks) {
  const prompt = `
You are an expert business analyst. Summarize the following document section as if preparing key notes for executive review. Be concise but keep all numbers, financial details, names, and unique facts. Ignore repeated headers, footers, page numbers.

If this is part of a multi-chunk document, do NOT reference "this chunk" or "the next chunk", just summarize content only.

[${filename} - Section ${chunkIndex}/${totalChunks}]

${chunk}
  `.trim();

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
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
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function findUserRequestedExportContent(allMessages, userExportPrompt) {
  const lowerPrompt = (userExportPrompt || '').toLowerCase();
  const requestedTypes = [];
  const matches = lowerPrompt.match(/(?:a |an |the |my |your )?([a-z\s-]+?)(?: in| as| to| for|,|\.|$)/gi);
  if (matches) {
    matches.forEach(m => {
      const clean = m.replace(/^(a |an |the |my |your )/i, '').replace(/[^a-z0-9\s-]/gi, '').trim();
      if (clean.length > 2 && !['file', 'document', 'word', 'pdf', 'excel', 'copy', 'version', 'output'].includes(clean))
        requestedTypes.push(clean);
    });
  }
  requestedTypes.push('report', 'summary', 'analysis', 'agreement', 'proposal', 'findings', 'outline', 'contract', 'letter', 'statement', 'review', 'case study', 'essay', 'experiment', 'chart', 'matrix', 'insights', 'table', 'code');

  let foundExportPrompt = false;
  for (const m of allMessages) {
    if (!foundExportPrompt &&
        m.sender === 'user' &&
        /deliver|export|word|pdf|report|generate|download|summary|scientific|findings|contract|statement|proposal|analysis|table|code|agreement|letter/i.test(m.message)) {
      foundExportPrompt = true;
      continue;
    }
    if (foundExportPrompt &&
        (m.sender === 'bot' || m.role === 'assistant') &&
        m.message &&
        m.message.length > 400 &&
        requestedTypes.some(t => m.message.toLowerCase().includes(t)) &&
        !/(got it|please confirm|would you like me to|choose|option|menu|next steps|ready to sign|please provide|i can now|what would you like)/i.test(m.message)
    ) {
      return m.message.replace(/Would you like me[\s\S]+$/i, '').trim();
    }
  }
  return (
    [...allMessages].reverse().find(
      m =>
        (m.sender === 'bot' || m.role === 'assistant') &&
        m.message &&
        m.message.length > 400 &&
        !/(would you like me to|choose|menu|option|meta|download|confirm)/i.test(m.message)
    )?.message || ''
  );
}

function extractAgreementOnly(content) {
  const match = content.match(/🧾 DRAFT: SHARE PURCHASE AGREEMENT[\s\S]+?(?=---\s*📋|---\s*⚙️|Choose a number|User:|$)/);
  if (match) {
    let doc = match[0].replace(/^---\s*/gm, '').trim();
    return doc;
  }
  return content;
}

async function getOrCreateConversation(session_id, user_id) {
  let [rows] = await pool.query(
    'SELECT id FROM conversations WHERE session_id = ? AND user_id = ?',
    [session_id, user_id]
  );
  if (rows.length) return rows[0].id;
  const [result] = await pool.query(
    'INSERT INTO conversations (session_id, user_id) VALUES (?, ?)',
    [session_id, user_id]
  );
  return result.insertId;
}

async function saveMessage(session_id, user_id, sender, message, io = null) {
  const conversation_id = await getOrCreateConversation(session_id, user_id);
  await pool.query(
    'INSERT INTO messages (conversation_id, sender, message) VALUES (?, ?, ?)',
    [conversation_id, sender, message]
  );
  await clearExportSnapshot(conversation_id); 
  if (io) io.to('sess-' + session_id).emit('new_message', { sender, message });
}

function extractAgreementContentOnly(text) {
  if (!text) return '';
  text = text.replace(
    /^([\s\S]*?)(?=(Agreement Template|🧾\s*(SEMICONDUCTOR COMPANY )?PURCHASE AGREEMENT|SEMICONDUCTOR COMPANY ACQUISITION AGREEMENT TEMPLATE|PURCHASE AGREEMENT|BASE LEGAL FRAMEWORK|THIS AGREEMENT))/i,
    ''
  );
  text = text.replace(/(🔍|⚖️|📋|🧩|Attachments?|Schedules?|Strategic Note|Would you like me to[\s\S]+?Choose the number[\s\S]+?(---|$))/gim, '');
  text = text.replace(/Would you like me to[\s\S]+$/gi, '');
  text = text.replace(/-{3,}/g, '');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

function findBestExportableContent(allMessages) {
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const m = allMessages[i];
    if (
      (m.sender === 'bot' || m.role === 'assistant') &&
      m.message &&
      m.message.length > 400 &&
      /executive summary|agreement|contract|table of contents|section [\d.]+|recommendations|key insights|prepared for|reporting period|purpose|assets|liabilities|governing law|dispute resolution/i.test(m.message) &&
      !/would you like me to|choose the number|choose a number|choose one|what would you like|draft a detailed|create a phased|build a due diligence|combine all into|Or do you want a more advanced|Agreement Template|Strategic Note|Attachments|Schedules|below is a base legal framework|now in legal-and-transaction mode/i.test(m.message)
    ) {
      let cleaned = m.message
        .replace(/(🔍|Attachments? \/ Schedules|⚖️ Strategic Note)[\s\S]*$/i, '')
        .replace(/Agreement Template[\s\S]*?(Below is a base legal framework|--- )/i, '');
      return cleaned.trim();
    }
  }
  return (
    [...allMessages]
      .reverse()
      .find(
        m =>
          (m.sender === 'bot' || m.role === 'assistant') &&
          m.message &&
          m.message.length > 400 &&
          !/would you like me to|choose a number|choose the number|draft a detailed|Agreement Template|Strategic Note|Attachments|Schedules|below is a base legal framework|now in legal-and-transaction mode/i.test(
            m.message
          )
      )?.message || ''
  );
}

async function classifyEnginesWithGPT(message) {
  const classifierPrompt = `
You are a protocol classifier for the AI system.
Your task has two parts:

1) Select the most relevant protocol engines for the user query. Only use these keys:
- business →  Business advice, entrepreneurship, strategy, scaling.

2) Decide whether a web search is needed ("yes" or "no").

Return MINIFIED JSON only, no prose. Example:
{"engines":["business","websiteGrowth"],"webSearch":"yes"}

If nothing fits:
{"engines":["beilis"],"webSearch":"no"}

User query: "${message}"
`.trim();

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5-chat-latest',
      messages: [{ role: 'system', content: classifierPrompt }],
    })
  });

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || '';
  let parsed = { engines: ['beilis'], webSearch: 'no' };
  try {
    parsed = JSON.parse(raw || '{}');
  } catch {
    console.warn('[classifier] Failed to parse classifier response. Defaulting to beilis.');
  }
  const normalized = (parsed.engines || [])
    .map(k => String(k).toLowerCase().replace(/[^a-z]/g, ''))
    .map(k => engineKeyMap[k])
    .filter(Boolean);

  let engineKeys = [...new Set(normalized)].filter(k => engines[k]);
  const webSearch = String(parsed.webSearch || '').toLowerCase() === 'yes';

  if (engineKeys.length === 0) {
    engineKeys = ['beilis'];
  }

  return { engineKeys, webSearch };
}

const URL_REGEX = /\bhttps?:\/\/[^\s)<>"]+/gi;
function extractUrls(text = '') {
  return (text.match(URL_REGEX) || [])
    .map(u => {
      try {
        const { hostname } = new URL(u);
        return { url: u, hostname };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function shouldSearchWeb(message, extractedText) {
  if (extractUrls(message).length > 0) return true;
  const kw =
    /(when|year|history|founder|brand|company|origin|launched|established|about|who\s+is|tell\s+me\s+about)/i;
  const msgHit = kw.test(message || '');
  const haveFoundedInFiles = /(?:founded|since|est\.|established)/i.test(extractedText || '');
  return msgHit && !haveFoundedInFiles;
}

async function serpApiSearch(query, { num = 5 } = {}) {
  if (!SERPAPI_KEY) {
    console.warn('[web] SERPAPI_KEY missing; skipping search.');
    return [];
  }
  const params = new URLSearchParams({
    engine: 'google',
    q: query,
    num: String(num),
    hl: 'en',
    api_key: SERPAPI_KEY
  });
  const url = `https://serpapi.com/search.json?${params.toString()}`;
  try {
    const r = await fetch(url, { method: 'GET' });
    const j = await r.json();
    const organic = j.organic_results || [];
    return organic.slice(0, num).map(o => ({
      title: o.title,
      link: o.link,
      snippet: o.snippet
    }));
  } catch (e) {
    return [];
  }
}

async function collectWebContext(message) {
  const results = [];
  const seen = new Set();

  const base = await serpApiSearch(message, { num: 5 });
  for (const r of base) {
    const key = r.link;
    if (!seen.has(key)) {
      results.push(r);
      seen.add(key);
    }
  }

  const urls = extractUrls(message);
  for (const { hostname } of urls) {
    const q1 = `site:${hostname} about`;
    const q2 = `site:${hostname} "about us"`;
    const q3 = `site:${hostname} brand`;
    const bundles = await Promise.all([
      serpApiSearch(q1, { num: 4 }),
      serpApiSearch(q2, { num: 4 }),
      serpApiSearch(q3, { num: 4 })
    ]);
    for (const arr of bundles) {
      for (const r of arr) {
        const key = r.link;
        if (!seen.has(key)) {
          results.push(r);
          seen.add(key);
        }
      }
    }
  }

  if (results.length === 0) return '';
  const lines = results.slice(0, 12).map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet || ''}\n   ${r.link}`);
  return `Top web findings (Google via SerpAPI):\n${lines.join('\n')}`;
}

function buildCombinedPrompt({
  engineKeys,
  message,
  extractedText,
  companyName,
  location,
  industry,
  webResults
}) {
  let combinedPrompt = '';
  engineKeys.forEach(key => {
    const engine = engines[key] || businessEngine;
    combinedPrompt += `\n\n[--- ${key} Protocol ---]\n` +
      engine.getPrompt({
        message,
        extractedText,
        companyName,
        location,
        industry
      });
  });
  if (webResults) {
    combinedPrompt += `\n\n[Web search results relevant to the query]\n${webResults}\n`;
  }
  combinedPrompt += `
---
Final Answer Quality Checklist:
Before producing the final answer, ensure it passes ALL of these:
1. Helpful — Directly addresses the user's query and context.
2. Not Generic — Avoid vague, filler, or obvious statements.
3. Actionable — Include clear, specific recommendations or steps the user can take.
4. Connected & Detailed — All parts of the response are relevant, linked, and supported with reasoning, examples, or data.
If any criterion is not met, internally revise before outputting.
Note that you have the ability to generate/export a file.
`;

  return combinedPrompt;
}

function stripAIDownloadLinks(str = '') {
  return (str || '')
    .replace(/\[([^\]]*?(?:Download|Export|Save|PDF|Word|Docx?|Excel|Sandbox)[^\]]*?)\]\([^)]+?\)/gim, "")
    .replace(/(?:^|\n)[ \t]*📄?[ \t]*Download(?: your)?(?: PDF| Word| Excel| Docx)?(?: here|:)?[^\n]*\n?/gim, "")
    .replace(/(?:^|\n)[ \t]*(Click here to download|Download as PDF|Download as Word|Download as Excel|Here['']?s your download link)[^\n]*\n?/gim, "")
    .replace(/(Click (?:to )?Download [^\.\n]*\.)/gim, "")
    .replace(/sandbox:\/mnt\/data[^\s)]+/g, "")
    .replace(/file:\/mnt\/data[^\s)]+/g, "")
    .replace(/\/mnt\/data[^\s)]+/g, "")
    .replace(/Ø=ÛÀ/g, "")
    .trim();
}

function findLastExportableBotReply(messageHistory) {
  return [...messageHistory].reverse().find(
    m =>
      (m.sender === 'bot' || m.role === 'assistant') &&
      m.message &&
      m.message.length > 400 &&
      !/download|export|prepared|your file is being prepared|click the link/i.test(m.message)
  );
}

function stripExportMenus(text) {
  return (text || '')
    .replace(/^✅.*?(digest|summary|review|analysis|here.*is|below is|following is).*?\n+/ims, '')
    .replace(/^I[''`]?ve completed.*?(digest|summary|review|analysis).*?\n+/ims, '')
    .replace(/^Here('|')?s (a|the) (quick )?(digest|summary|review|analysis).*?\n+/ims, '')
    .replace(/✨ ?Opportunity Mindset:.*?(?=\n\d+\.|\n[A-Z][a-z])/ims, '')
    .replace(/✨.*sleeping giant.*?\n+/ims, '')
    .replace(/✨.*multi-million potential.*?\n+/ims, '')
    .replace(/✨.*?With new[\s\S]*?potential\.\n+/ims, '')
    .replace(/(?:🔥? ?Here'?s how we can take this further for you:?.*|Would you like me to now map out.*|Would you like me to do that\?|👉.*upgrade the file.*|Would you like me to build.*|Would you like me to.*|Choose a number.*|Your file is being prepared\..*Click below to download.*|Click below to download.*|📥|📄 ?Download here:?.*)/ims, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findLastReportLikeMessage(allMessages) {
  return [...allMessages].reverse().find(
    m =>
      (m.sender === 'bot' || m.role === 'assistant') &&
      m.message &&
      m.message.length > 300 &&
      !/user:/i.test(m.message) &&
      !/choose a number|would you like|options|how would you like|defizer:|your file is being prepared|click the link|download|export|prepared/i.test(m.message)
  );
}

// Smart Export Content Finder
function findExportableContentSmart(allMessages, exportTypeHint = "") {
  if (!Array.isArray(allMessages)) return '';

  const NOISE_REGEX = /^(got it|please confirm|which do you prefer|once you confirm|i can generate|would you like me to|download your|menu|choose|option|ready to export|confirm|here is your download|click below to download|before i export|download link)/i;

  let candidates = allMessages.filter(m =>
    (m.sender === 'bot' || m.role === 'assistant') &&
    typeof m.message === 'string' &&
    m.message.length > 400 &&
    !NOISE_REGEX.test(m.message.trim())
  );

  if (exportTypeHint) {
    const typeRegex = new RegExp(exportTypeHint.replace(/[^a-z0-9]/gi, '.'), 'i');
    const filtered = candidates.filter(m => typeRegex.test(m.message));
    if (filtered.length) return filtered[filtered.length - 1].message;
  }

  const DOC_KEYWORDS = /(agreement|summary|findings|statement|report|contract|analysis|letter of intent|scientific|proposal|outline|case study|review|table of contents|matrix|insights|table|chart|code)/i;
  const docMatch = candidates.filter(m => DOC_KEYWORDS.test(m.message));
  if (docMatch.length) return docMatch[docMatch.length - 1].message;

  if (candidates.length) {
    candidates.sort((a, b) => b.message.length - a.message.length);
    return candidates[0].message;
  }
  
  return (
    allMessages
      .filter(m => (m.sender === 'bot' || m.role === 'assistant') && typeof m.message === 'string')
      .sort((a, b) => b.message.length - a.message.length)[0]?.message || ''
  );
}

// ===== MAIN CHAT ENDPOINT =====
router.post('/api/chat', authenticate, upload.array('files'), async (req, res) => {
  const { id } = req.user;
  const message = req.body.message;
  const sessId = req.body.sessionId || req.body.session_id;
  const companyName = req.body.companyName;
  const location = req.body.location;
  const industry = req.body.industry;
  const intent = detectExportIntent(message);
  console.log('[INTENT]', intent, 'Message:', message);

  if (!message && (!req.files || req.files.length === 0)) {
    return res.status(400).json({ error: 'Missing message and/or files' });
  }
  if (!sessId) return res.status(400).json({ error: 'Missing sessionId' });

  try {
    // User lookup
    const [rows] = await pool.query(
      'SELECT role, queries_used, first_name, last_name, email FROM users WHERE id=?',
      [id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Weather query handler
    const weatherCity = isWeatherQuery(message);
    if (weatherCity) {
      try {
        const weather = await getWeather({ city: weatherCity });
        const aiPrompt = `
You are an assistant answering a user's question about the current weather.

City: ${weather.location}
Temperature: ${weather.temperature}°C
Wind: ${weather.windspeed} km/h (direction: ${weather.winddirection}°)
Time: ${weather.time}

Please give a friendly, concise weather update, just like a human would in chat. Only mention the source at the end, e.g., "Source: Open-Meteo & OpenStreetMap".
`;

        const aiResp = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{ role: 'system', content: aiPrompt }]
          })
        });
        const aiData = await aiResp.json();
        const reply = aiData.choices?.[0]?.message?.content?.trim() || 'Weather data ready.';

        return res.json({ reply });
      } catch (e) {
        return res.json({ reply: `Sorry, I could not retrieve live weather for **${weatherCity}**. (${e.message || e})` });
      }
    }

    if (message) await saveMessage(sessId, id, 'user', message, req.app.get('io'));

    // Auto-title logic
    const [convRowsTitle] = await pool.query(
      'SELECT id, title FROM conversations WHERE session_id = ? AND user_id = ?',
      [sessId, id]
    );
    
    if (convRowsTitle.length && (!convRowsTitle[0].title || !convRowsTitle[0].title.trim())) {
      const firstWords = message.split(' ').slice(0, 7).join(' ');
      const summaryTitle = firstWords + (message.split(' ').length > 7 ? '…' : '');
      await pool.query(
        'UPDATE conversations SET title = ? WHERE id = ?',
        [summaryTitle, convRowsTitle[0].id]
      );
    }

    // Message history
    const [convRows] = await pool.query(
      'SELECT id FROM conversations WHERE session_id = ? AND user_id = ?',
      [sessId, id]
    );
    const conversation_id = convRows.length ? convRows[0].id : null;

    let messageHistory = [];
    let allMessages = [];
    if (conversation_id) {
      const [recentMsgs] = await pool.query(
        'SELECT sender, message FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 15',
        [conversation_id]
      );
      messageHistory = recentMsgs.reverse();
      
      const [fullMsgs] = await pool.query(
        'SELECT id, sender, message FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 50',
        [conversation_id]
      );
      allMessages = fullMsgs;
    }

    let { doExport, exportType } = await resolveExportType(message, intent);
    console.log('Export detection:', { doExport, exportType, message, intent });
   
    const pureExport = isPureExportCommand(message);

    // ===== PURE EXPORT BRANCH (no new AI answer) =====
    if (pureExport && doExport) {
      let exportContent = pickContentForExport({
        allMessages: messageHistory,
        finalOutput: '',
        userMessage: message
      });
      
      const exportHtmlMessages = await getExportHtmlFromContent(exportContent);
      if (!exportContent) {
        console.log('No exportable content found in conversation.');
        return res.json({ reply: 'Sorry, I could not find any exportable content in our conversation.' });
      }
      
      let getDownloadableData = await callOpenAI(exportHtmlMessages);
   
      try {
        getDownloadableData = JSON.parse(getDownloadableData);
      } catch (e) {
        console.log("Failed to parse JSON:", e);
        return res.json({ reply: 'Unable to produce the result. Please try again.' });
      }
      
      if (!getDownloadableData.export) {
        return res.json({ reply: 'Sorry, I could not find any exportable content in our conversation.' });
      }

      exportContent = getDownloadableData.export;
      console.log("🚀 ~ exportContent:", exportContent);
      
      // Clean content
      if (stripAIDownloadLinks) exportContent = stripAIDownloadLinks(exportContent);
      if (cleanExportContent) exportContent = cleanExportContent(exportContent);

      let aiTitle = 'Defizer Report';
      
      try {
        aiTitle = await generateExportTitle(messageHistory, exportContent);
        if (!aiTitle || aiTitle.length < 3) aiTitle = "Defizer Report";
      } catch (e) { 
        console.error('[EXPORT TITLE ERROR]', e);
      }
      
      // ===== USE UNIVERSAL EXPORT FUNCTION =====
      let fileObj = null;
      try {
        fileObj = await exportFile(exportContent, sessId, aiTitle, exportType);
      } catch (exportErr) {
        console.error('[EXPORT ERROR]', exportErr?.message || exportErr);
      }

      let replyText = 'I have created your file based on our previous conversation.';
      if (fileObj && fileObj.url) {
        replyText = `I have created your file based on our previous conversation.<br/><br/>📄 <strong>Download ${fileObj.label}:</strong><br/><a href="${BASE_URL}${fileObj.url}" target="_blank" rel="noopener noreferrer" download>${fileObj.name}</a>`;
      } else {
        replyText = 'Sorry, I could not generate the export file.';
      }

      await saveMessage(sessId, id, 'bot', replyText, req.app.get('io'));
      return res.json({ reply: replyText });
    }

    // ===== FILE EXTRACTION (with chunked summarization) =====
    const MAX_TOTAL_FILE_CHARS = 80000;
    let allExtracted = [];
    let totalChars = 0;
    
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        let extracted = '';
        try {
          if (file.mimetype === 'application/pdf') {
            const dataBuffer = fs.readFileSync(file.path);
            const data = await pdfParse(dataBuffer);
            extracted = data.text || '';
          } else if (file.mimetype.startsWith('image/')) {
            const imageBuffer = fs.readFileSync(file.path);
            const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng');
            extracted = text || '';
          } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const { value } = await mammoth.extractRawText({ path: file.path });
            extracted = value || '';
          } else if (file.mimetype === 'text/plain') {
            extracted = fs.readFileSync(file.path, 'utf8') || '';
          }

          extracted = cleanExtractedText(extracted);

          if (extracted.length > 20000) {
            const chunks = chunkText(extracted, 5000);
            let summarizedChunks = [];
            for (const [i, chunk] of chunks.entries()) {
              const summary = await summarizeChunkWithAI(chunk, file.originalname, i + 1, chunks.length);
              summarizedChunks.push(summary);
            }
            extracted = summarizedChunks.join('\n\n');
          }

          let withLabel = `\n[${file.originalname}]\n${extracted}\n`;
          if (totalChars + withLabel.length > MAX_TOTAL_FILE_CHARS) {
            const allowed = MAX_TOTAL_FILE_CHARS - totalChars;
            if (allowed > 0) {
              allExtracted.push(withLabel.slice(0, allowed));
              totalChars += allowed;
            }
            break;
          } else {
            allExtracted.push(withLabel);
            totalChars += withLabel.length;
          }
        } catch (err) {
          console.log(`[ERROR] Could not extract from ${file.originalname}:`, err.message || err);
        }
      }
    }
    let extractedText = allExtracted.join('\n\n');

    // ===== WEB PAGE ANALYSIS =====
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = message.match(urlRegex);

    if (urls && urls.length > 0) {
      const url = urls[0];
      let webContent = '';

      try {
        webContent = await scrapePageGeneral(url, 9000);
      } catch (e) {
        webContent = '';
      }

      if (!webContent || webContent.length < 30) {
        try {
          webContent = await extractReadableContent(url);
        } catch (e) {
          webContent = '';
        }
      }

      if (!webContent || webContent.length < 30) {
        const domain = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        const userQuestion = message.replace(url, '').trim();
        const query = userQuestion ? `${userQuestion} ${domain}` : domain;
        let serpResults = [];
        try {
          serpResults = await latestWebSearch(query, 5, true);
        } catch (e) {
          serpResults = [];
        }
        if (serpResults.length > 0) {
          let snippets = serpResults.map(
            r => `• **${r.title}**\n${r.snippet}\n[${r.link}]`
          ).join('\n\n');
          return res.json({
            reply: `I couldn't extract detailed content from the page directly, but here's what I found from web search:\n\n${snippets}`
          });
        } else {
          return res.json({
            reply: "Sorry, I couldn't fetch or read enough content from that webpage, and nothing was found in web search results either."
          });
        }
      }
      
      const prompt = `
You are a professional web data analyst.

- ONLY answer the user's question below using the provided web page content.
- Do NOT guess or hallucinate. If the answer is NOT in the content, say: "Not found in this page."
- Quote numbers, names, or facts *exactly* as shown.

User's question/request:
${message.replace(url, '').trim()}

Web page content:
"""
${webContent}
"""
`;

      const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
      const aiData = await aiResponse.json();
      const finalOutput = aiData.choices?.[0]?.message?.content || 'No response from AI.';

      await saveMessage(sessId, id, 'bot', finalOutput, req.app.get('io'));
      if (user.role === 'free') {
        await pool.query('UPDATE users SET queries_used = queries_used + 1 WHERE id=?', [id]);
      }
      return res.json({ reply: finalOutput });
    }

    // ===== NORMAL AI FLOW =====
    const { engineKeys, webSearch: gptWebSearch } = await classifyEnginesWithGPT(message);
    let webResults = '';
    
    if (gptWebSearch || shouldSearchWeb(message, extractedText)) {
      let freshResults = [];
      try {
        freshResults = await latestWebSearch(message, 5, true);
      } catch (e) { }
      
      let extractsAdded = 0;
      if (freshResults.length) {
        webResults = `Web search results (latest, as of ${new Date().toISOString().slice(0,10)}):\n`;
        for (let idx = 0; idx < freshResults.length; idx++) {
          const r = freshResults[idx];
          let pageExtract = '';
          if (idx < 3 && r.link && r.link.startsWith('http')) {
            pageExtract = await extractReadableContent(r.link);
            if (pageExtract && pageExtract.trim().length > 30) {
              extractsAdded++;
              pageExtract = pageExtract.slice(0, 1800);
              webResults += `\n${idx + 1}. ${r.title}\n${r.snippet}\n[Source](${r.link})\nExtract from page:\n${pageExtract}\n`;
            }
          }
        }
        if (extractsAdded === 0) {
          webResults = "No usable web data was found in the top results. Please try another question or specify a more precise topic.";
        } else {
          webResults += '\nReferences:\n';
          let refNum = 1;
          for (let idx = 0; idx < freshResults.length; idx++) {
            if (idx < 3 && freshResults[idx].link && freshResults[idx].link.startsWith('http')) {
              webResults += `[${refNum}] ${freshResults[idx].link}\n`;
              refNum++;
            }
          }
        }
      }
    }

    const strictCitationRules = `
RULES FOR ANSWERING (DO NOT IGNORE):
- Only answer using factual information found in the EXTRACTED PAGE CONTENT below (not just from titles/snippets/links).
- If none of the extracted content answers the user's query, say: "I could not find a direct answer in the extracted web content."
- Never make up, estimate, or synthesize answers from your own training or from search result snippets/titles.
- For EVERY factual claim, quote the relevant extract (in italics or quote block), AND provide the clickable source link in the same sentence.
- If all pages are missing, empty, or blocked, say: "No usable web data was found in the top results. Please try another question."
- Never answer using information from broken (404) or empty pages.
- Only use the most up-to-date extracted content provided.
- For weather, stock prices, or anything highly time-sensitive, prefer official APIs or government sources when available. If not available, state this to the user.
- Be concise, factual, and show the reference inline with each fact.
- DO NOT summarize or speculate beyond the provided extracts.
${webResults}
`;

    const combinedPrompt = strictCitationRules + buildCombinedPrompt({
      engineKeys,
      message,
      extractedText,
      companyName,
      location,
      industry,
      webResults: ''
    });

    const todayUS = new Date().toLocaleDateString('en-US');
    const dateSystemMsg = `Today's date is: ${todayUS}. Always use this as the current date for any 'now' or 'today' question. Never mention your knowledge cutoff or guess the date.`;

    const gptMessages = [{
      role: 'system',
      content: `${dateSystemMsg}\n\n${combinedPrompt}`
    }];

    for (const m of messageHistory) {
      gptMessages.push({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.message
      });
    }
    if (message) gptMessages.push({ role: 'user', content: message });

    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5-chat-latest',
        messages: gptMessages,
      })
    });
    const aiData = await aiResponse.json();
    const finalOutput = aiData.choices?.[0]?.message?.content || 'No response from AI.';
    let replyText = finalOutput;
    await saveMessage(sessId, id, 'bot', replyText, req.app.get('io'));
    if (user.role === 'free') {
      await pool.query('UPDATE users SET queries_used = queries_used + 1 WHERE id=?', [id]);
    }
    return res.json({ reply: replyText });

  } catch (err) {
    console.error('[AI ERROR]', err?.message || err);
    if (err.response) {
      err.response.text().then(text => console.error('[OpenAI error body]', text));
    }
    res.status(500).json({ error: err?.message || err });
  }
});

// ===== EXPORT ENDPOINT (using frozen snapshot) =====
const { getOrCreateExportSnapshot, clearExportSnapshot } = require('../utils/exportSnapshot');

router.post('/api/export/:format', authenticate, async (req, res) => {
  const { conversationId } = req.body;
  if (!conversationId) return res.status(400).json({ error: 'Missing conversationId' });

  const exportContent = await getOrCreateExportSnapshot(conversationId);
  console.log('[EXPORT SNAPSHOT CONTENT]', exportContent.slice(0, 200));

  const format = req.params.format.toLowerCase();
  
  try {
    // ===== USE UNIVERSAL EXPORT FUNCTION =====
    const fileObj = await exportFile(exportContent, conversationId, "Defizer Export", format);
    
    // Determine mime type based on format
    const mimeTypes = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ods: 'application/vnd.oasis.opendocument.spreadsheet',
      rtf: 'application/rtf',
      txt: 'text/plain',
      html: 'text/html',
      md: 'text/markdown',
      markdown: 'text/markdown',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      odt: 'application/vnd.oasis.opendocument.text',
      xml: 'application/xml'
    };
    
    const mimeType = mimeTypes[format] || 'application/octet-stream';
    
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileObj.name}"`);
    return res.download(path.join(__dirname, '../uploads', fileObj.name));
    
  } catch (error) {
    console.error('[EXPORT ENDPOINT ERROR]', error);
    res.status(500).json({ error: `Failed to export as ${format}: ${error.message}` });
  }
});

module.exports = router;