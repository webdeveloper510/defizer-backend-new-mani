// routes/chat.js - COMPLETE FILE - COPY AND PASTE THIS ENTIRE CODE

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const mammoth = require("mammoth");
const { modifyFileNatively } = require('../nativeFileEditor');
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");
const { modifyDocumentViaAIHTML } = require('../utils/aiDocumentModifier');

// ===== UPDATED IMPORT - Use universal exportFile =====
const { exportFile, cleanExportContent } = require("../fileGenerators");
const { importMultipleFiles } = require("../fileImportors");
const {
  processDocumentModification,
  detectModificationType,
} = require("../documentProcessor");
const {
  latestWebSearch,
  extractReadableContent,
} = require("../utils/webSearch.js");
const { generateExportTitle } = require("../utils/generateExportTitle");
const { scrapePageGeneral } = require("../utils/scrapePageGeneral");
const { getWeather } = require("../utils/weather");
const { callOpenAI } = require("../services/openAi.service");

// ==== Engine imports and mappings ====
const businessEngine = require("../engines/business");
const astrologyEngine = require("../engines/astrology");
const businessAcquisitionEngine = require("../engines/businessAcquisition");
const riskLegalComplianceEngine = require("../engines/riskLegalCompliance");
const websiteGrowthEngine = require("../engines/websiteGrowth");
const beilisEngine = require("../engines/beilis");
const opportunityEngine = require("../engines/opportunity");
const marketingCampaignEngine = require("../engines/marketingCampaign");
const operationsOptimizationEngine = require("../engines/operationsOptimization");
const technologyIntegrationEngine = require("../engines/technologyIntegration");
const financialPlanningEngine = require("../engines/financialPlanning");
const studySkillsEngine = require("../engines/studySkills");
const academicPlanningEngine = require("../engines/academicPlanning");
const careerReadinessEngine = require("../engines/careerReadiness");
const wellbeingEngine = require("../engines/wellbeing");
const researchSkillsEngine = require("../engines/researchSkills");

const {
  isPureExportCommand,
  looksLikeExportLink,
  buildAggregatedAssistantContent,
  pickContentForExport,
  resolveExportType,
  classifyExportIntentWithGPT,
  getExportHtmlFromContent,
} = require("../utils/helpers");

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
  beilis: beilisEngine,
};

const engineKeyMap = {
  astrology: "astrology",
  websitegrowth: "websiteGrowth",
  risklegalcompliance: "riskLegalCompliance",
  businessacquisition: "businessAcquisition",
  business: "business",
  opportunity: "opportunity",
  beilis: "beilis",
  marketingcampaign: "marketingCampaign",
  operationsoptimization: "operationsOptimization",
  technologyintegration: "technologyIntegration",
  financialplanning: "financialPlanning",
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + "-" + file.originalname.replace(/\s+/g, "_"));
  },
});
const upload = multer({ storage });

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Helper: Detect weather queries
function isWeatherQuery(msg) {
  if (!msg) return null;
  const match = msg.match(
    /\b(?:weather|temperature|forecast)\s+(?:in|for)?\s*([a-zA-Z\s]+)/i
  );
  return match ? match[1].trim() : null;
}

// Helper: clean extracted text
function cleanExtractedText(text) {
  return (text || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "")
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
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

// Helper: summarize chunk with OpenAI
async function summarizeChunkWithAI(chunk, filename, chunkIndex, totalChunks) {
  const prompt = `
You are an expert business analyst. Summarize the following document section as if preparing key notes for executive review. Be concise but keep all numbers, financial details, names, and unique facts. Ignore repeated headers, footers, page numbers.

If this is part of a multi-chunk document, do NOT reference "this chunk" or "the next chunk", just summarize content only.

[${filename} - Section ${chunkIndex}/${totalChunks}]

${chunk}
  `.trim();

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: prompt }],
      max_tokens: 512,
    }),
  });
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function getOrCreateConversation(session_id, user_id) {
  let [rows] = await pool.query(
    "SELECT id FROM conversations WHERE session_id = ? AND user_id = ?",
    [session_id, user_id]
  );
  if (rows.length) return rows[0].id;
  const [result] = await pool.query(
    "INSERT INTO conversations (session_id, user_id) VALUES (?, ?)",
    [session_id, user_id]
  );
  return result.insertId;
}

async function saveMessage(session_id, user_id, sender, message, io = null) {
  const conversation_id = await getOrCreateConversation(session_id, user_id);
  await pool.query(
    "INSERT INTO messages (conversation_id, sender, message) VALUES (?, ?, ?)",
    [conversation_id, sender, message]
  );
  const { clearExportSnapshot } = require("../utils/exportSnapshot");
  await clearExportSnapshot(conversation_id);
  if (io) io.to("sess-" + session_id).emit("new_message", { sender, message });
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

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [{ role: "system", content: classifierPrompt }],
    }),
  });

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "";
  let parsed = { engines: ["beilis"], webSearch: "no" };
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    console.warn(
      "[classifier] Failed to parse classifier response. Defaulting to beilis."
    );
  }
  const normalized = (parsed.engines || [])
    .map((k) =>
      String(k)
        .toLowerCase()
        .replace(/[^a-z]/g, "")
    )
    .map((k) => engineKeyMap[k])
    .filter(Boolean);

  let engineKeys = [...new Set(normalized)].filter((k) => engines[k]);
  const webSearch = String(parsed.webSearch || "").toLowerCase() === "yes";

  if (engineKeys.length === 0) {
    engineKeys = ["beilis"];
  }

  return { engineKeys, webSearch };
}

const URL_REGEX = /\bhttps?:\/\/[^\s)<>"]+/gi;
function extractUrls(text = "") {
  return (text.match(URL_REGEX) || [])
    .map((u) => {
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
  const msgHit = kw.test(message || "");
  const haveFoundedInFiles = /(?:founded|since|est\.|established)/i.test(
    extractedText || ""
  );
  return msgHit && !haveFoundedInFiles;
}

async function serpApiSearch(query, { num = 5 } = {}) {
  if (!SERPAPI_KEY) {
    console.warn("[web] SERPAPI_KEY missing; skipping search.");
    return [];
  }
  const params = new URLSearchParams({
    engine: "google",
    q: query,
    num: String(num),
    hl: "en",
    api_key: SERPAPI_KEY,
  });
  const url = `https://serpapi.com/search.json?${params.toString()}`;
  try {
    const r = await fetch(url, { method: "GET" });
    const j = await r.json();
    const organic = j.organic_results || [];
    return organic.slice(0, num).map((o) => ({
      title: o.title,
      link: o.link,
      snippet: o.snippet,
    }));
  } catch (e) {
    return [];
  }
}

function buildCombinedPrompt({
  engineKeys,
  message,
  extractedText,
  companyName,
  location,
  industry,
  webResults,
}) {
  let combinedPrompt = "";
  engineKeys.forEach((key) => {
    const engine = engines[key] || businessEngine;
    combinedPrompt +=
      `\n\n[--- ${key} Protocol ---]\n` +
      engine.getPrompt({
        message,
        extractedText,
        companyName,
        location,
        industry,
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

function stripAIDownloadLinks(str = "") {
  return (str || "")
    .replace(
      /\[([^\]]*?(?:Download|Export|Save|PDF|Word|Docx?|Excel|Sandbox)[^\]]*?)\]\([^)]+?\)/gim,
      ""
    )
    .replace(
      /(?:^|\n)[ \t]*📄?[ \t]*Download(?: your)?(?: PDF| Word| Excel| Docx)?(?: here|:)?[^\n]*\n?/gim,
      ""
    )
    .replace(
      /(?:^|\n)[ \t]*(Click here to download|Download as PDF|Download as Word|Download as Excel|Here['']?s your download link)[^\n]*\n?/gim,
      ""
    )
    .replace(/(Click (?:to )?Download [^\.\n]*\.)/gim, "")
    .replace(/sandbox:\/mnt\/data[^\s)]+/g, "")
    .replace(/file:\/mnt\/data[^\s)]+/g, "")
    .replace(/\/mnt\/data[^\s)]+/g, "")
    .replace(/Ø=ÛÀ/g, "")
    .trim();
}

// ============================================================================
// NEW: COMBINED REQUEST DETECTION HELPERS
// ============================================================================

/**
 * Detects if the user message contains both content generation and export intent
 * Example: "Explain blockchain and download as PDF"
 */
function isCombinedRequest(message, hasExportIntent) {
  if (!message || !hasExportIntent) return false;

  // Content generation patterns - MORE COMPREHENSIVE
  const contentPatterns = [
    /^(explain|describe|tell me|what is|what are|how|why|compare|analyze|discuss)/i,
    /\b(advantages?|disadvantages?|benefits?|drawbacks?|pros?|cons?)\b/i,
    /\b(differences?|similarities|comparison|versus|vs\.?|compared to)\b/i,
    /\b(list|create|write|generate|provide|give me|show me|make)\b/i,
    /\b(summarize|outline|elaborate|define|detail|breakdown)\b/i,
    /\b(bullet points?|table|chart|comparison table)\b/i,
  ];

  const hasContentIntent = contentPatterns.some((pattern) =>
    pattern.test(message)
  );

  // Export patterns - Check if export keywords exist
  const exportPatterns = [
    /\b(download|export|save|convert|turn|make|give me|provide)\b.*?\b(as|into|in|to)\b.*?\b(pdf|word|docx?|excel|xlsx?|tsv|csv|ppt|pptx|txt|html|xml|md|markdown|zip|rar|7z|ods|odt|odp|rtf|ics|vcf|eml|msg|mbox|jpg|jpeg|png|gif|bmp|tiff)\b/i,
    /\b(as|into|in|to)\b\s+(pdf|word|docx?|excel|xlsx?|tsv|csv|ppt|pptx|txt|html|xml|md|markdown)\b/i,
    /\b(download|export|save)\b.*?\b(it|this|that|the)\b.*?\b(as|into|in|to)\b/i,
    /\b(into|as|in|to)\b\s+(tsv|csv|excel|pdf|word)\b/i,
  ];

  const hasExportPattern = exportPatterns.some((pattern) =>
    pattern.test(message)
  );

  // Check if message has reasonable length (combined requests are typically longer)
  const wordCount = message.split(/\s+/).length;
  const hasReasonableLength = wordCount >= 5; // Reduced from 6 to 5

  console.log("[COMBINED REQUEST CHECK]", {
    hasContentIntent,
    hasExportPattern,
    hasExportIntent,
    hasReasonableLength,
    wordCount,
    message: message.slice(0, 100),
  });

  // If we have content intent AND (export pattern OR export intent flag), it's combined
  return (
    hasContentIntent &&
    (hasExportPattern || hasExportIntent) &&
    hasReasonableLength
  );
}

/**
 * Extracts the content generation part from a combined request
 * Removes export instructions to send clean query to AI
 */
function extractContentRequest(message) {
  if (!message) return message;

  // Remove export-related phrases from the end or middle
  let cleaned = message
    // Pattern 1: "and download/export as FORMAT"
    .replace(
      /\s*(and|then)?\s*(download|export|save|convert|turn|make|give me|provide|deliver|send)\s+(it|this|that|the result|the output)?\s*(as|into|in|to)\s+(pdf|word|docx?|excel|xlsx?|tsv|csv|ppt|pptx|txt|html|xml|md|markdown|zip|rar|7z|tar\.gz|ods|odt|odp|rtf|ics|vcf|eml|msg|mbox|jpg|jpeg|png|gif|bmp|tiff)\b.*$/i,
      ""
    )

    // Pattern 2: "in FORMAT format"
    .replace(
      /\s*(and|then)?\s*(in|as|into|to)\s+(pdf|word|docx?|excel|xlsx?|tsv|csv|ppt|pptx|txt|html|xml|md|markdown)\s*(format|file|document)?\s*$/i,
      ""
    )

    // Pattern 3: "as a FORMAT file"
    .replace(
      /\s*(and|then)?\s*as\s+a\s+(pdf|word|docx?|excel|xlsx?|tsv|csv)\s+file\s*$/i,
      ""
    )

    // Pattern 4: Just "and FORMAT" at the end
    .replace(
      /\s*(and|then)?\s*(pdf|word|docx?|excel|xlsx?|tsv|csv|ppt|pptx|txt)\s*$/i,
      ""
    )

    // Pattern 5: "download it into FORMAT"
    .replace(
      /\s*(download|export|save)\s+(it|this|that)\s+(as|into|in|to)\s+\w+\s*$/i,
      ""
    )

    // Pattern 6: Specific case like "adn download it into tsv"
    .replace(
      /\s*a[dn]d\s+(download|export|save)\s+(it|this|that)?\s*(as|into|in|to)\s+\w+\s*$/i,
      ""
    )

    .trim();

  console.log("[EXTRACT CONTENT]", {
    original: message,
    cleaned: cleaned,
    removed: message.length - cleaned.length,
  });

  return cleaned;
}
// ============================================================================
// MAIN CHAT ENDPOINT
// ============================================================================
router.post(
  "/api/chat",
  authenticate,
  upload.array("files"),
  async (req, res) => {
    const { id } = req.user;
    const message = req.body.message;
    const sessId = req.body.sessionId || req.body.session_id;
    const companyName = req.body.companyName;
    const location = req.body.location;
    const industry = req.body.industry;

    if (!message && (!req.files || req.files.length === 0)) {
      return res.status(400).json({ error: "Missing message and/or files" });
    }
    if (!sessId) return res.status(400).json({ error: "Missing sessionId" });

    try {
      // User lookup
      const [rows] = await pool.query(
        "SELECT role, queries_used, first_name, last_name, email FROM users WHERE id=?",
        [id]
      );
      const user = rows[0];
      if (!user) return res.status(404).json({ error: "User not found" });

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

          const aiResp = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${OPENAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: "gpt-4o",
                messages: [{ role: "system", content: aiPrompt }],
              }),
            }
          );
          const aiData = await aiResp.json();
          const reply =
            aiData.choices?.[0]?.message?.content?.trim() ||
            "Weather data ready.";

          return res.json({ reply });
        } catch (e) {
          return res.json({
            reply: `Sorry, I could not retrieve live weather for **${weatherCity}**. (${
              e.message || e
            })`,
          });
        }
      }

      if (message) {
        await saveMessage(sessId, id, "user", message, req.app.get("io"));
      }

      // Auto-title logic
      const [convRowsTitle] = await pool.query(
        "SELECT id, title FROM conversations WHERE session_id = ? AND user_id = ?",
        [sessId, id]
      );

      if (
        convRowsTitle.length &&
        (!convRowsTitle[0].title || !convRowsTitle[0].title.trim())
      ) {
        const firstWords = message.split(" ").slice(0, 7).join(" ");
        const summaryTitle =
          firstWords + (message.split(" ").length > 7 ? "…" : "");
        await pool.query("UPDATE conversations SET title = ? WHERE id = ?", [
          summaryTitle,
          convRowsTitle[0].id,
        ]);
      }

      // Message history
      const [convRows] = await pool.query(
        "SELECT id FROM conversations WHERE session_id = ? AND user_id = ?",
        [sessId, id]
      );
      const conversation_id = convRows.length ? convRows[0].id : null;

      let messageHistory = [];
      let allMessages = [];
      if (conversation_id) {
        const [recentMsgs] = await pool.query(
          "SELECT sender, message FROM messages WHERE conversation_id = ? ORDER BY timestamp DESC LIMIT 15",
          [conversation_id]
        );
        messageHistory = recentMsgs.reverse();

        const [fullMsgs] = await pool.query(
          "SELECT id, sender, message FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT 50",
          [conversation_id]
        );
        allMessages = fullMsgs;
      }

      const intent = detectExportIntent(message);
      let { doExport, exportType } = await resolveExportType(message, intent);

      console.log("[EXPORT DETECTION]", {
        doExport,
        exportType,
        intentKeys: Object.keys(intent).filter((k) => intent[k]),
      });

      const pureExport = isPureExportCommand(message);

      // FIX: Better combined request detection
      const hasContentRequest = /^(explain|describe|tell|what|how|why|compare|list|create|write|generate|provide|give|show|make|summarize|outline|discuss|elaborate|define|detail|advantages|disadvantages|benefits|drawbacks|pros|cons|differences|similarities|comparison|versus|bullet|table|chart|get|find|search)/i.test(
        message
      );

      const combinedRequest =
        doExport &&
        hasContentRequest &&
        !pureExport &&
        message.split(/\s+/).length >= 5;

      console.log("[REQUEST TYPE]", {
        pureExport,
        combinedRequest,
        hasContentRequest,
        doExport,
        exportType,
        wordCount: message.split(/\s+/).length,
      });

      // ===== FILE EXTRACTION WITH FORMAT TRACKING =====
      let extractedText = "";
      let importedFiles = [];
      let originalFileFormat = null;
      let originalFileName = null;
      let structuredData = null;
      let originalFilePath = null; // Save the original file path

      if (req.files && req.files.length > 0) {
        console.log("[CHAT] Processing", req.files.length, "uploaded file(s)");

        try {
          // Save original file path BEFORE processing
          originalFilePath = req.files[0].path;
          originalFileName = req.files[0].originalname;

          // Extract format
          const ext = path.extname(originalFileName).toLowerCase().replace('.', '');
          originalFileFormat = ext;

          console.log('[CHAT] Original file saved at:', originalFilePath);
          console.log('[CHAT] Original format:', originalFileFormat);

          // Prepare files for import
          const files = req.files.map((file) => ({
            path: file.path,
            mimetype: file.mimetype,
            originalname: file.originalname,
          }));

          // Use your universal import function
          const importResult = await importMultipleFiles(files, {
            OPENAI_API_KEY,
            summarize: true,
            maxTotalChars: 80000,
          });

          if (importResult.combined) {
            extractedText = importResult.combined;
            importedFiles = importResult.files;

            if (importedFiles.length > 0) {
              const firstFile = importedFiles[0];
              if (firstFile.structured) {
                structuredData = firstFile.structured;
              }
            }

            console.log(
              "[CHAT] Successfully imported",
              importResult.totalChars,
              "characters from",
              importedFiles.length,
              "files"
            );
          }
        } catch (importError) {
          console.error("[CHAT IMPORT ERROR]", importError);
          extractedText = "";
        }
      }
// ===== DOCUMENT MODIFICATION SECTION - FIXED =====
if (extractedText && message && originalFilePath) {
  const modificationType = detectModificationType(message);

  console.log("[CHAT] Modification type detected:", modificationType);

  if (modificationType !== 'analyze') {
    console.log("[CHAT] Processing document modification with AI HTML Pipeline");

    try {
      // Use AI-generated HTML approach (as per TL's request)
      const result = await modifyDocumentViaAIHTML({
        extractedText: extractedText,
        originalFilePath: originalFilePath,
        originalFormat: originalFileFormat || 'txt',
        originalFileName: originalFileName || 'document',
        userRequest: message,
        sessionId: sessId
      });

      if (result.success) {
        console.log('[CHAT] AI HTML modification successful!');

        // Read the modified file
        const modifiedFileContent = await fs.promises.readFile(result.modifiedFilePath);
        
        // Generate clean filename
        const baseFilename = originalFileName 
          ? originalFileName.replace(/\.[^/.]+$/, '') 
          : 'Modified_Document';
        
        const cleanBaseFilename = baseFilename
          .replace(/\s+/g, '_')
          .replace(/[^a-zA-Z0-9_-]/g, '');

        const finalFileName = `${Date.now()}-${cleanBaseFilename}_modified.${originalFileFormat}`;
        const finalFilePath = path.join(uploadDir, finalFileName);
        
        // Copy to uploads directory
        await fs.promises.copyFile(result.modifiedFilePath, finalFilePath);

        // Verify file exists
        if (!fs.existsSync(finalFilePath)) {
          throw new Error('Failed to create final file');
        }

        // Create download URL
        const downloadUrl = `/uploads/${finalFileName}`;
        
        console.log('[DOWNLOAD URL]', {
          downloadUrl,
          fullUrl: `${BASE_URL}${downloadUrl}`,
          fileExists: fs.existsSync(finalFilePath)
        });

        // Cleanup temporary files
        try {
          await fs.promises.unlink(originalFilePath);
          await fs.promises.unlink(result.modifiedFilePath);
          console.log('[CLEANUP] Temporary files removed successfully');
        } catch (cleanupError) {
          console.error('[CLEANUP ERROR]', cleanupError);
        }

        const methodNote = '<br/><em>✅ Modified using AI-generated HTML pipeline!</em>';

        const replyText = `✅ I've modified your document using AI-generated HTML approach!${methodNote}<br/><br/>📄 <strong>Download Modified Document:</strong><br/><a href="${BASE_URL}${downloadUrl}" target="_blank" rel="noopener noreferrer" download="${finalFileName}">${finalFileName}</a>`;

        await saveMessage(
          sessId,
          id,
          "bot",
          replyText,
          req.app.get("io")
        );

        if (user.role === "free") {
          await pool.query(
            "UPDATE users SET queries_used = queries_used + 1 WHERE id=?",
            [id]
          );
        }

        return res.json({ reply: replyText });
      } else {
        throw new Error(result.error || 'AI HTML modification failed');
      }

    } catch (modifyError) {
      console.error('[MODIFY ERROR]', modifyError);
      
      // Cleanup on error
      if (originalFilePath) {
        try {
          await fs.promises.unlink(originalFilePath);
        } catch (e) {
          console.error("[CLEANUP ERROR]", e);
        }
      }

      return res.json({
        reply: `Sorry, I encountered an error while modifying your document: ${modifyError.message}`
      });
    }
  }
}
      // CLEANUP: Delete uploaded files if not used for modification
      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          try {
            if (fs.existsSync(file.path)) {
              await fs.promises.unlink(file.path);
            }
          } catch (e) {
            console.error("[FILE CLEANUP ERROR]", e);
          }
        }
      }

      // ===== BRANCH 1: PURE EXPORT (existing conversation content) =====
      if (pureExport && doExport) {
        console.log("[PURE EXPORT] Exporting existing content...");

        let exportContent = pickContentForExport({
          allMessages: messageHistory,
          finalOutput: "",
          userMessage: message,
        });

        if (!exportContent) {
          return res.json({
            reply:
              "Sorry, I could not find any exportable content in our conversation.",
          });
        }

        const exportHtmlMessages = await getExportHtmlFromContent(
          exportContent
        );
        let getDownloadableData = await callOpenAI(exportHtmlMessages);

        try {
          getDownloadableData = JSON.parse(getDownloadableData);
        } catch (e) {
          console.log("Failed to parse JSON:", e);
          return res.json({
            reply: "Unable to produce the result. Please try again.",
          });
        }

        if (!getDownloadableData.export) {
          return res.json({
            reply:
              "Sorry, I could not find any exportable content in our conversation.",
          });
        }

        exportContent = getDownloadableData.export;
        exportContent = stripAIDownloadLinks(exportContent);
        exportContent = cleanExportContent(exportContent);

        let aiTitle = "Defizer Report";
        try {
          aiTitle = await generateExportTitle(messageHistory, exportContent);
          if (!aiTitle || aiTitle.length < 3) aiTitle = "Defizer Report";
        } catch (e) {
          console.error("[EXPORT TITLE ERROR]", e);
        }

        let fileObj = null;
        try {
          fileObj = await exportFile(
            exportContent,
            sessId,
            aiTitle,
            exportType
          );
        } catch (exportErr) {
          console.error("[EXPORT ERROR]", exportErr?.message || exportErr);
          return res.json({
            reply: "Sorry, I could not generate the export file.",
          });
        }

        let replyText =
          "I have created your file based on our previous conversation.";
        if (fileObj && fileObj.url) {
          replyText = `I have created your file based on our previous conversation.<br/><br/>📄 <strong>Download ${fileObj.label}:</strong><br/><a href="${BASE_URL}${fileObj.url}" target="_blank" rel="noopener noreferrer" download>${fileObj.name}</a>`;
        }

        await saveMessage(sessId, id, "bot", replyText, req.app.get("io"));
        return res.json({ reply: replyText });
      }

      // ===== BRANCH 2: COMBINED REQUEST (generate content + export) =====
      if (combinedRequest) {
        console.log("[COMBINED REQUEST] Generating content and export file...");

        // Clean the message - remove export instructions
        let contentRequest = message
          .replace(
            /\s*(and|then|adn)?\s*(download|export|save|convert|turn|make|give|provide)\s+(it|this|that)?\s*(as|into|in|to)\s+(pdf|word|docx?|excel|xlsx?|tsv|csv|ppt|pptx|txt|html|xml|md|markdown|zip|rar|7z|ods|odt|odp|rtf|ics|vcf|eml|msg|mbox|jpg|jpeg|png|gif|bmp|tiff)\b.*$/i,
            ""
          )
          .replace(
            /\s*(and|then|adn)?\s*(in|as|into|to)\s+(pdf|word|tsv|csv|excel|txt|html|xml)\s*(format|file)?\s*$/i,
            ""
          )
          .trim();

        console.log("[COMBINED] Original message:", message);
        console.log("[COMBINED] Content request:", contentRequest);
        console.log("[COMBINED] Export format:", exportType);

        // Get engines and web search
        const { engineKeys, webSearch: gptWebSearch } =
          await classifyEnginesWithGPT(contentRequest);
        let webResults = "";

        if (gptWebSearch || shouldSearchWeb(contentRequest, extractedText)) {
          let freshResults = [];
          try {
            freshResults = await latestWebSearch(contentRequest, 5, true);
          } catch (e) {
            console.error("[WEB SEARCH ERROR]", e);
          }

          let extractsAdded = 0;
          if (freshResults.length) {
            webResults = `Web search results (latest, as of ${new Date()
              .toISOString()
              .slice(0, 10)}):\n`;
            for (let idx = 0; idx < freshResults.length; idx++) {
              const r = freshResults[idx];
              let pageExtract = "";
              if (idx < 3 && r.link && r.link.startsWith("http")) {
                pageExtract = await extractReadableContent(r.link);
                if (pageExtract && pageExtract.trim().length > 30) {
                  extractsAdded++;
                  pageExtract = pageExtract.slice(0, 1800);
                  webResults += `\n${idx + 1}. ${r.title}\n${
                    r.snippet
                  }\n[Source](${r.link})\nExtract from page:\n${pageExtract}\n`;
                }
              }
            }
            if (extractsAdded > 0) {
              webResults += "\nReferences:\n";
              let refNum = 1;
              for (let idx = 0; idx < freshResults.length; idx++) {
                if (
                  idx < 3 &&
                  freshResults[idx].link &&
                  freshResults[idx].link.startsWith("http")
                ) {
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
- Be concise, factual, and show the reference inline with each fact.
- DO NOT summarize or speculate beyond the provided extracts.
${webResults}
`;

        const combinedPrompt =
          strictCitationRules +
          buildCombinedPrompt({
            engineKeys,
            message: contentRequest,
            extractedText,
            companyName,
            location,
            industry,
            webResults: "",
          });

        const todayUS = new Date().toLocaleDateString("en-US");
        const dateSystemMsg = `Today's date is: ${todayUS}. Always use this as the current date for any 'now' or 'today' question.`;

        const gptMessages = [
          {
            role: "system",
            content: `${dateSystemMsg}\n\n${combinedPrompt}`,
          },
        ];

        for (const m of messageHistory) {
          gptMessages.push({
            role: m.sender === "user" ? "user" : "assistant",
            content: m.message,
          });
        }

        gptMessages.push({ role: "user", content: contentRequest });

        // Get AI response
        const aiResponse = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: gptMessages,
            }),
          }
        );
        const aiData = await aiResponse.json();
        let finalOutput =
          aiData.choices?.[0]?.message?.content || "No response from AI.";

        // Save the AI response first
        await saveMessage(sessId, id, "bot", finalOutput, req.app.get("io"));

        // Generate export file
        let exportContent = finalOutput;
        exportContent = stripAIDownloadLinks(exportContent);
        exportContent = cleanExportContent(exportContent);

        console.log("[COMBINED] Generating export file...");
        console.log("[COMBINED] Format:", exportType);
        console.log("[COMBINED] Content length:", exportContent.length);

        // Generate title
        let aiTitle = contentRequest.split(" ").slice(0, 6).join(" ");
        try {
          aiTitle = await generateExportTitle(
            [
              { sender: "user", message: contentRequest },
              { sender: "bot", message: finalOutput },
            ],
            exportContent
          );
          if (!aiTitle || aiTitle.length < 3) {
            aiTitle = contentRequest.split(" ").slice(0, 6).join(" ");
          }
        } catch (e) {
          console.error("[EXPORT TITLE ERROR]", e);
        }

        // Generate file
        let fileObj = null;
        try {
          fileObj = await exportFile(
            exportContent,
            sessId,
            aiTitle,
            exportType
          );
          console.log("[COMBINED] File generated successfully:", fileObj);
        } catch (exportErr) {
          console.error(
            "[COMBINED EXPORT ERROR]",
            exportErr?.message || exportErr
          );
        }

        // Create response with download link
        let replyText = finalOutput;
        if (fileObj && fileObj.url) {
          replyText += `<br/><br/>📄 <strong>Download ${fileObj.label}:</strong><br/><a href="${BASE_URL}${fileObj.url}" target="_blank" rel="noopener noreferrer" download>${fileObj.name}</a>`;
        } else {
          replyText +=
            "<br/><br/><em>Note: File export encountered an issue.</em>";
        }

        // Update the saved message with download link
        await pool.query(
          "UPDATE messages SET message = ? WHERE conversation_id = ? AND sender = ? ORDER BY id DESC LIMIT 1",
          [replyText, conversation_id, "bot"]
        );

        if (user.role === "free") {
          await pool.query(
            "UPDATE users SET queries_used = queries_used + 1 WHERE id=?",
            [id]
          );
        }

        return res.json({ reply: replyText });
      }

      // ===== BRANCH 3: NORMAL FLOW (no export, just content generation) =====
      console.log("[NORMAL FLOW] Processing content request...");

      // ===== WEB PAGE ANALYSIS =====
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urls = message.match(urlRegex);

      if (urls && urls.length > 0) {
        const url = urls[0];
        let webContent = "";

        try {
          webContent = await scrapePageGeneral(url, 9000);
        } catch (e) {
          webContent = "";
        }

        if (!webContent || webContent.length < 30) {
          try {
            webContent = await extractReadableContent(url);
          } catch (e) {
            webContent = "";
          }
        }

        if (!webContent || webContent.length < 30) {
          const domain = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
          const userQuestion = message.replace(url, "").trim();
          const query = userQuestion ? `${userQuestion} ${domain}` : domain;
          let serpResults = [];
          try {
            serpResults = await latestWebSearch(query, 5, true);
          } catch (e) {
            serpResults = [];
          }
          if (serpResults.length > 0) {
            let snippets = serpResults
              .map((r) => `• **${r.title}**\n${r.snippet}\n[${r.link}]`)
              .join("\n\n");
            return res.json({
              reply: `I couldn't extract detailed content from the page directly, but here's what I found from web search:\n\n${snippets}`,
            });
          } else {
            return res.json({
              reply:
                "Sorry, I couldn't fetch or read enough content from that webpage, and nothing was found in web search results either.",
            });
          }
        }

        const prompt = `
You are a professional web data analyst.

- ONLY answer the user's question below using the provided web page content.
- Do NOT guess or hallucinate. If the answer is NOT in the content, say: "Not found in this page."
- Quote numbers, names, or facts *exactly* as shown.

User's question/request:
${message.replace(url, "").trim()}

Web page content:
"""
${webContent}
"""
`;

        const aiResponse = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [{ role: "system", content: prompt }],
            }),
          }
        );
        const aiData = await aiResponse.json();
        const finalOutput =
          aiData.choices?.[0]?.message?.content || "No response from AI.";

        await saveMessage(sessId, id, "bot", finalOutput, req.app.get("io"));
        if (user.role === "free") {
          await pool.query(
            "UPDATE users SET queries_used = queries_used + 1 WHERE id=?",
            [id]
          );
        }
        return res.json({ reply: finalOutput });
      }

      // ===== NORMAL AI FLOW =====
      const { engineKeys, webSearch: gptWebSearch } =
        await classifyEnginesWithGPT(message);
      let webResults = "";

      if (gptWebSearch || shouldSearchWeb(message, extractedText)) {
        let freshResults = [];
        try {
          freshResults = await latestWebSearch(message, 5, true);
        } catch (e) {
          console.error("[WEB SEARCH ERROR]", e);
        }

        let extractsAdded = 0;
        if (freshResults.length) {
          webResults = `Web search results (latest, as of ${new Date()
            .toISOString()
            .slice(0, 10)}):\n`;
          for (let idx = 0; idx < freshResults.length; idx++) {
            const r = freshResults[idx];
            let pageExtract = "";
            if (idx < 3 && r.link && r.link.startsWith("http")) {
              pageExtract = await extractReadableContent(r.link);
              if (pageExtract && pageExtract.trim().length > 30) {
                extractsAdded++;
                pageExtract = pageExtract.slice(0, 1800);
                webResults += `\n${idx + 1}. ${r.title}\n${
                  r.snippet
                }\n[Source](${r.link})\nExtract from page:\n${pageExtract}\n`;
              }
            }
          }
          if (extractsAdded === 0) {
            webResults =
              "No usable web data was found in the top results. Please try another question or specify a more precise topic.";
          } else {
            webResults += "\nReferences:\n";
            let refNum = 1;
            for (let idx = 0; idx < freshResults.length; idx++) {
              if (
                idx < 3 &&
                freshResults[idx].link &&
                freshResults[idx].link.startsWith("http")
              ) {
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

      const combinedPrompt =
        strictCitationRules +
        buildCombinedPrompt({
          engineKeys,
          message,
          extractedText,
          companyName,
          location,
          industry,
          webResults: "",
        });

      const todayUS = new Date().toLocaleDateString("en-US");
      const dateSystemMsg = `Today's date is: ${todayUS}. Always use this as the current date for any 'now' or 'today' question. Never mention your knowledge cutoff or guess the date.`;

      const gptMessages = [
        {
          role: "system",
          content: `${dateSystemMsg}\n\n${combinedPrompt}`,
        },
      ];

      for (const m of messageHistory) {
        gptMessages.push({
          role: m.sender === "user" ? "user" : "assistant",
          content: m.message,
        });
      }
      if (message) gptMessages.push({ role: "user", content: message });

      const aiResponse = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: gptMessages,
          }),
        }
      );
      const aiData = await aiResponse.json();
      const finalOutput =
        aiData.choices?.[0]?.message?.content || "No response from AI.";
      let replyText = finalOutput;

      await saveMessage(sessId, id, "bot", replyText, req.app.get("io"));
      if (user.role === "free") {
        await pool.query(
          "UPDATE users SET queries_used = queries_used + 1 WHERE id=?",
          [id]
        );
      }
      return res.json({ reply: replyText });
    } catch (err) {
      console.error("[AI ERROR]", err?.message || err);
      if (err.response) {
        try {
          const text = await err.response.text();
          console.error("[OpenAI error body]", text);
        } catch (e) {
          console.error("[Error reading response]", e);
        }
      }
      res.status(500).json({ error: err?.message || err });
    }
  }
);
// ===== FIXED EXPORT ENDPOINT with ALL MIME types =====
router.post("/api/export/:format", authenticate, async (req, res) => {
  const { conversationId } = req.body;
  if (!conversationId)
    return res.status(400).json({ error: "Missing conversationId" });

  const exportContent = await getOrCreateExportSnapshot(conversationId);
  console.log("[EXPORT SNAPSHOT CONTENT]", exportContent.slice(0, 200));

  const format = req.params.format.toLowerCase();

  try {
    const fileObj = await exportFile(
      exportContent,
      conversationId,
      "Defizer Export",
      format
    );

    const mimeTypes = {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      doc: "application/msword",
      word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      xls: "application/vnd.ms-excel",
      excel:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ppt: "application/vnd.ms-powerpoint",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
      odt: "application/vnd.oasis.opendocument.text",
      odp: "application/vnd.oasis.opendocument.presentation",
      rtf: "application/rtf",
      txt: "text/plain",
      csv: "text/csv",
      tsv: "text/tab-separated-values",
      html: "text/html",
      htm: "text/html",
      xml: "application/xml",
      md: "text/markdown",
      markdown: "text/markdown",
      eml: "message/rfc822",
      msg: "application/vnd.ms-outlook",
      mbox: "application/mbox",
      ics: "text/calendar",
      vcf: "text/vcard",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      bmp: "image/bmp",
      tiff: "image/tiff",
      zip: "application/zip",
      rar: "application/x-rar-compressed",
      "7z": "application/x-7z-compressed",
      "tar.gz": "application/gzip",
    };

    const mimeType = mimeTypes[format] || "application/octet-stream";
    const filePath = path.join(__dirname, "../uploads", fileObj.name);

    if (!fs.existsSync(filePath)) {
      console.error("[EXPORT ERROR] File not found:", filePath);
      return res
        .status(500)
        .json({ error: `Export file was not created: ${fileObj.name}` });
    }

    console.log("[EXPORT SUCCESS]", {
      format,
      mimeType,
      fileName: fileObj.name,
      fileSize: fs.statSync(filePath).size,
    });

    res.setHeader("Content-Type", mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileObj.name}"`
    );
             
    return res.sendFile(filePath, (err) => {
      if (err) {
        console.error("[SENDFILE ERROR]", err);
        if (!res.headersSent) {
          res
            .status(500)
            .json({ error: `Failed to send file: ${err.message}` });
        }
      }
    });
  } catch (error) {
    console.error("[EXPORT ENDPOINT ERROR]", error);
    res
      .status(500)
      .json({ error: `Failed to export as ${format}: ${error.message}` });
  }
});
module.exports = router;
