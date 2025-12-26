// routes/chat.js - COMPLETE FILE - COPY AND PASTE THIS ENTIRE CODE

const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const Tesseract = require("tesseract.js");
const mammoth = require("mammoth");
const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));
const { pool } = require("../db");
const { authenticate } = require("../middleware/authenticate");
const {
  modifyDocumentEnhanced,
  isFormatModifiable,
} = require("../utils/directDocumentModifier");
const { detectModificationType } = require("../documentProcessor");
// ===== UPDATED IMPORT - Use universal exportFile =====
const { exportFile, cleanExportContent } = require("../fileGenerators");
const { importFile } = require("../fileImportors");
const { getOrCreateExportSnapshot } = require("../utils/exportSnapshot");
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
  pickContentForExport,
  resolveExportType,
  classifyExportIntentWithGPT,
  getExportHtmlFromContent,
  hasContentRequest,
  detectDocumentIntent
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
async function getAIResponse(
  message,
  messageHistory,
  extractedText,
  companyName,
  location,
  industry
) {
  console.log("[AI FLOW] Preparing normal AI response...");
  console.log("[AI FLOW] Extracted text available:", extractedText ? `${extractedText.length} chars` : "none");

  const { engineKeys, webSearch: gptWebSearch } = await classifyEnginesWithGPT(
    message
  );

  let webResults = "";
  let hasWebResults = false;
  
  if (gptWebSearch || shouldSearchWeb(message, extractedText)) {
    console.log("[AI FLOW] Performing web search...");
    let freshResults = [];
    try {
      freshResults = await latestWebSearch(message, 5, true);
    } catch (e) {
      console.error("[AI FLOW] Web search error:", e);
    }

    let extractsAdded = 0;
    if (freshResults.length) {
      hasWebResults = true;
      webResults = `Web search results (latest, as of ${new Date()
        .toISOString()
        .slice(0, 10)}):\n`;
      for (let idx = 0; idx < freshResults.length; idx++) {
        const r = freshResults[idx];
        if (idx < 3 && r.link && r.link.startsWith("http")) {
          let pageExtract = await extractReadableContent(r.link);
          if (pageExtract && pageExtract.trim().length > 30) {
            extractsAdded++;
            pageExtract = pageExtract.slice(0, 1800);
            webResults += `\n${idx + 1}. ${r.title}\n${r.snippet}\n[Source](${
              r.link
            })\nExtract:\n${pageExtract}\n`;
          }
        }
      }
      if (extractsAdded === 0) {
        hasWebResults = false;
        webResults = "";
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

  // ===== BUILD APPROPRIATE PROMPT BASED ON AVAILABLE DATA =====
  let systemInstructions = "";
  
  if (extractedText && extractedText.trim().length > 50) {
    // User uploaded a document - prioritize that
    console.log("[AI FLOW] Using document-focused prompt");
    systemInstructions = `
You are an AI assistant analyzing uploaded documents.

UPLOADED DOCUMENT CONTENT:
${extractedText}

${webResults ? `\n\nADDITIONAL WEB CONTEXT:\n${webResults}\n` : ''}

Instructions:
- Answer the user's question based primarily on the uploaded document content above
- Provide detailed, insightful analysis
- Quote relevant sections when helpful
- If web results are provided, you may reference them as supplementary context
- Be thorough and professional
`;
  } else if (hasWebResults) {
    // Only web search results available
    console.log("[AI FLOW] Using web-search-focused prompt");
    systemInstructions = `
RULES FOR ANSWERING:
- Only answer using factual info in the EXTRACTED PAGE CONTENT below.
- If content does not answer query, say: "I could not find a direct answer."
- Always quote extracts and show source inline.

${webResults}
`;
  } else {
    // No document, no web results - use general knowledge
    console.log("[AI FLOW] Using general knowledge prompt");
    systemInstructions = `
You are a helpful AI assistant. Answer the user's question using your knowledge and the conversation context.
Be helpful, detailed, and professional.
`;
  }

  const combinedPrompt =
    systemInstructions +
    "\n\n" +
    buildCombinedPrompt({
      engineKeys,
      message,
      extractedText: "", // Already included in systemInstructions
      companyName,
      location,
      industry,
      webResults: "", // Already included in systemInstructions
    });

  const todayUS = new Date().toLocaleDateString("en-US");
  const dateSystemMsg = `Today's date is: ${todayUS}. Always use this as current date.`;

  const gptMessages = [
    { role: "system", content: `${dateSystemMsg}\n\n${combinedPrompt}` },
    ...messageHistory.map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.message,
    })),
    { role: "user", content: message },
  ];

  console.log("[AI FLOW] Sending request to OpenAI...");
  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: gptMessages,
    }),
  });

  const aiData = await aiResponse.json();
  const finalOutput =
    aiData.choices?.[0]?.message?.content || "No response from AI.";
  console.log("[AI FLOW] AI response received");

  return finalOutput;
}
async function handlePureExport(
  allMessages,
  messageHistory,
  userMessage,
  sessId,
  exportType
) {
  console.log("[EXPORT] Handling pure export...");
  let exportContent = pickContentForExport({
    allMessages,
    finalOutput: "",
    userMessage,
    isPureExport: true,
  });

  if (!exportContent) {
    console.log("[EXPORT] No exportable content found");
    return "Sorry, no exportable content found in conversation.";
  }

  const exportHtmlMessages = await getExportHtmlFromContent(exportContent);
  let getDownloadableData = await callOpenAI(exportHtmlMessages);

  try {
    getDownloadableData = JSON.parse(getDownloadableData);
  } catch (e) {
    console.error("[EXPORT] JSON parse failed:", e);
    return "Unable to produce the result. Please try again.";
  }

  if (!getDownloadableData.export) {
    return "No exportable content found in conversation.";
  }

  exportContent = stripAIDownloadLinks(getDownloadableData.export);
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
    fileObj = await exportFile(exportContent, sessId, aiTitle, exportType);
  } catch (exportErr) {
    console.error("[EXPORT ERROR]", exportErr);
    return "Could not generate export file.";
  }

  const replyText = fileObj?.url
    ? `I created your file.<br/><a href="${BASE_URL}${fileObj.url}" target="_blank" download>${fileObj.name}</a>`
    : "I created your file but download link failed.";

  console.log("[EXPORT] Pure export completed");
  return replyText;
}
async function handleCombinedRequest(
  contentRequest,
  extractedText,
  messageHistory,
  sessId,
  user,
  exportType,
  companyName,
  location,
  industry,
  req
) {
  console.log("[COMBINED] Generating content + export...");
  console.log("[COMBINED] User info:", { userId: user?.id, sessId });

  if (!user || !user.id) {
    console.error("[COMBINED] ERROR: user or user.id is missing", user);
    throw new Error("User information is missing");
  }

  const [convRows] = await pool.query(
    "SELECT id FROM conversations WHERE session_id = ? AND user_id = ?",
    [sessId, user.id]
  );
  const conversation_id = convRows.length ? convRows[0].id : null;

  if (!conversation_id) {
    console.error("[COMBINED] No conversation found");
    throw new Error("Conversation not found");
  }

  const [allMessages] = await pool.query(
    "SELECT id, sender, message FROM messages WHERE conversation_id = ? ORDER BY id ASC",
    [conversation_id]
  );

  const detectionPrompt = `
Analyze this user request and determine:
- Does the user want to export the EXISTING conversation/chat? Reply: EXPORT_CONVERSATION
- Does the user want to CREATE/GENERATE something new and export it? Reply: GENERATE_CONTENT

User request: "${contentRequest}"

Reply with ONLY one word: EXPORT_CONVERSATION or GENERATE_CONTENT
`;

  let isPureExportRequest = false;
  
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
        messages: [
          { role: "user", content: detectionPrompt }
        ],
      }),
    });

    const data = await response.json();
    const result = data.choices[0].message.content.trim();
    
    console.log("[COMBINED] AI Detection Result:", result);
    
    isPureExportRequest = result === "EXPORT_CONVERSATION";
    
  } catch (error) {
    console.error("[COMBINED] Detection failed:", error);
    isPureExportRequest = false; 
  }

  if (isPureExportRequest) {
    console.log("[COMBINED] Exporting existing conversation...");
    
    let exportContent = allMessages
      .map(msg => {
        const label = msg.sender === 'user' ? '👤 User' : '🤖 Assistant';
        return `${label}:\n${msg.message}\n`;
      })
      .join('\n---\n\n');

    exportContent = stripAIDownloadLinks(exportContent);
    exportContent = cleanExportContent(exportContent);

    let aiTitle = "Defizer Conversation";
    try {
      aiTitle = await generateExportTitle(messageHistory, exportContent);
      if (!aiTitle || aiTitle.length < 3) aiTitle = "Defizer Conversation";
    } catch (e) {
      console.error("[COMBINED EXPORT TITLE ERROR]", e);
    }

    let fileObj = null;
    try {
      fileObj = await exportFile(exportContent, sessId, aiTitle, exportType);
    } catch (e) {
      console.error("[COMBINED EXPORT ERROR]", e);
    }

    const replyText = fileObj?.url
      ? `✅ I've exported the conversation for you.<br/><br/>📄 Download: <a href="${BASE_URL}${fileObj.url}" target="_blank" download>${fileObj.name}</a>`
      : "I've prepared the export but the download link failed. Please try again.";

    await saveMessage(sessId, user.id, "bot", replyText, req.app.get("io"));

    console.log("[COMBINED] Pure export completed");
    return replyText;
  }
  console.log("[COMBINED] Generating new content...");
  
  const { engineKeys, webSearch: gptWebSearch } = await classifyEnginesWithGPT(
    contentRequest
  );

  let webResults = "";
  if (gptWebSearch || shouldSearchWeb(contentRequest, extractedText)) {
    console.log("[COMBINED] Performing web search...");
    let freshResults = [];
    try {
      freshResults = await latestWebSearch(contentRequest, 5, true);
    } catch (e) {
      console.error("[COMBINED] Web search error:", e);
    }

    let extractsAdded = 0;
    if (freshResults.length) {
      webResults = `Web search results (latest, ${new Date()
        .toISOString()
        .slice(0, 10)}):\n`;
      for (let idx = 0; idx < freshResults.length; idx++) {
        const r = freshResults[idx];
        if (idx < 3 && r.link && r.link.startsWith("http")) {
          let pageExtract = await extractReadableContent(r.link);
          if (pageExtract?.trim().length > 30) {
            extractsAdded++;
            pageExtract = pageExtract.slice(0, 1800);
            webResults += `\n${idx + 1}. ${r.title}\n${r.snippet}\n[Source](${
              r.link
            })\nExtract:\n${pageExtract}\n`;
          }
        }
      }
    }
  }

  const combinedPrompt = buildCombinedPrompt({
    engineKeys,
    message: contentRequest,
    extractedText,
    companyName,
    location,
    industry,
    webResults,
  });

  const todayUS = new Date().toLocaleDateString("en-US");
  const dateSystemMsg = `Today's date is: ${todayUS}.`;

  const gptMessages = [
    { role: "system", content: `${dateSystemMsg}\n\n${combinedPrompt}` },
    ...messageHistory.map((m) => ({
      role: m.sender === "user" ? "user" : "assistant",
      content: m.message,
    })),
    { role: "user", content: contentRequest },
  ];

  console.log("[COMBINED] Sending request to OpenAI...");
  const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: "gpt-4o", messages: gptMessages }),
  });

  const aiData = await aiResponse.json();
  let finalOutput =
    aiData.choices?.[0]?.message?.content || "No response from AI.";

  try {
    await saveMessage(sessId, user.id, "bot", finalOutput, req.app.get("io"));
    console.log("[COMBINED] Message saved");
  } catch (saveError) {
    console.error("[COMBINED] Failed to save message:", saveError);
  }

  let exportContent = stripAIDownloadLinks(finalOutput);
  exportContent = cleanExportContent(exportContent);
  const aiTitle = contentRequest.split(" ").slice(0, 6).join(" ");
  
  let fileObj = null;
  try {
    fileObj = await exportFile(exportContent, sessId, aiTitle, exportType);
  } catch (e) {
    console.error("[COMBINED EXPORT ERROR]", e);
  }

  const replyText = fileObj?.url
    ? `${finalOutput}<br/><br/>📄 Download: <a href="${BASE_URL}${fileObj.url}" target="_blank" download>${fileObj.name}</a>`
    : finalOutput + "<br/><br/><em>Note: File export failed.</em>";

  console.log("[COMBINED] Combined request completed");
  return replyText;
}
async function handleDocumentModification(
  file,
  userMessage,
  sessId,
  user,
  req,
  messageHistory = []
) {
  console.log("[DOC MOD] Starting modification for file:", file.originalname);

  const originalFilePath = file.path;
  const originalFileName = file.originalname;
  const originalFileFormat = path
    .extname(originalFileName)
    .replace(".", "")
    .toLowerCase();

  if (!isFormatModifiable(originalFileFormat)) {
    console.log("[DOC MOD] File format not modifiable:", originalFileFormat);
    return {
      success: false,
      reply: `⚠️ The format **${originalFileFormat.toUpperCase()}** does not support modification. Export to DOCX, TXT, or CSV first.`,
    };
  }

  try {
    const modificationType = await detectModificationType(userMessage);
    if (modificationType === "analyze") {
      console.log(
        "[DOC MOD] Modification type is 'analyze', skipping changes."
      );
      return {
        success: false,
        reply: null,
      };
    }

    console.log(
      `[DOC MOD] Modifying file (${originalFileFormat.toUpperCase()})...`
    );
    const result = await modifyDocumentEnhanced(
      originalFilePath,
      userMessage,
      OPENAI_API_KEY,
      {
        originalFormat: originalFileFormat,
        filename: originalFileName || "document",
        messageHistory: messageHistory 
      }
    );

    if (!result.success) {
      console.error("[DOC MOD] Modification failed:", result.error);
      return {
        success: false,
        reply: `⚠️ Unable to modify document. Reason: ${result.error}`,
      };
    }
    const baseFilename = originalFileName
      .replace(/\.[^/.]+$/, "")
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "");
    const finalFileName = `${Date.now()}-${baseFilename}_modified.${originalFileFormat}`;
    const finalFilePath = path.join(uploadDir, finalFileName);
    await fs.promises.copyFile(result.modifiedFilePath, finalFilePath);

    try {
      await fs.promises.unlink(originalFilePath);
    } catch (e) {
      console.error("[DOC MOD] Failed to delete original:", e.message);
    }
    try {
      await fs.promises.unlink(result.modifiedFilePath);
    } catch (e) {
      console.error(
        "[DOC MOD] Failed to delete temp modified file:",
        e.message
      );
    }

    const downloadUrl = `/uploads/${finalFileName}`;
    const replyText = `✅ Modified **${originalFileFormat.toUpperCase()}** document!\n📄 Download: <a href="${BASE_URL}${downloadUrl}" target="_blank" download="${finalFileName}">${finalFileName}</a>${
      result.metadata?.note ? `\n⚠️ Note: ${result.metadata.note}` : ""
    }`;

    console.log("[DOC MOD] Modification completed:", finalFileName);

    // Save message to database
    await saveMessage(sessId, user.id, "bot", replyText, req?.app?.get("io"));

    // Increment usage for free users
    if (user.role === "free") {
      await pool.query(
        "UPDATE users SET queries_used = queries_used + 1 WHERE id=?",
        [user.id]
      );
    }

    return {
      success: true,
      reply: replyText,
    };
  } catch (error) {
    console.error("[DOC MOD ERROR]", error);
    return {
      success: false,
      reply: `⚠️ Error modifying document: ${error.message}`,
    };
  }
}

function isWeatherQuery(msg) {
  if (!msg) return null;
  const match = msg.match(
    /\b(?:weather|temperature|forecast)\s+(?:in|for)?\s*([a-zA-Z\s]+)/i
  );
  return match ? match[1].trim() : null;
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

/**
 * Extracts the content generation part from a combined request
 * Removes export instructions to send clean query to AI
 */
/**
 * Extracts the content generation part from a combined request using AI
 * Removes export instructions to send clean query to AI
 */
async function extractContentRequest(message, OPENAI_API_KEY) {
  if (!message || typeof message !== "string") {
    return message;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `
You are a query refinement assistant.

Your task: Extract ONLY the content creation/generation part from user messages, removing all export/download instructions.

Return JSON with this exact structure:
{
  "cleanedRequest": "the content request without export instructions",
  "wasModified": boolean
}

Rules:
- Keep: what to create, generate, explain, analyze, write, summarize, compare, describe
- Remove: all mentions of export, download, save, convert, file formats, delivery methods
- Preserve: the core question/request exactly as stated
- If no export instructions found, return original message

Examples:

Input: "create a marketing plan and export as PDF"
Output: { "cleanedRequest": "create a marketing plan", "wasModified": true }

Input: "explain quantum physics in docx format"
Output: { "cleanedRequest": "explain quantum physics", "wasModified": true }

Input: "analyze sales data adn download it into tsv"
Output: { "cleanedRequest": "analyze sales data", "wasModified": true }

Input: "write a business proposal and save as word"
Output: { "cleanedRequest": "write a business proposal", "wasModified": true }

Input: "summarize this document"
Output: { "cleanedRequest": "summarize this document", "wasModified": false }

Input: "what's the weather today?"
Output: { "cleanedRequest": "what's the weather today?", "wasModified": false }

Important:
- Never add content that wasn't in the original
- Preserve all technical terms, names, and specifics
- Handle typos gracefully (e.g., "adn" = "and")
- Remove phrases like "and export as", "download as", "in PDF", "save to excel", etc.
`
          },
          { role: "user", content: message }
        ]
      })
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    console.log("[EXTRACT CONTENT AI]", {
      original: message,
      cleaned: result.cleanedRequest,
      wasModified: result.wasModified,
      charsRemoved: message.length - result.cleanedRequest.length
    });

    return result.cleanedRequest;

  } catch (error) {
    console.error("[EXTRACT CONTENT ERROR]", error);
    // Fallback: return original message if AI fails
    return message;
  }
}// ============================================================================
// MAIN CHAT ENDPOINT
// ============================================================================
// ============================================================================
// MAIN CHAT ENDPOINT - UPDATED WITH FILE PERSISTENCE
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
      console.log("[CHAT] Incoming request:", { userId: id, sessId, message });

      // ===== LOAD USER =====
      const [rows] = await pool.query(
        "SELECT id, role, queries_used, first_name, last_name, email FROM users WHERE id=?",
        [id]
      );
      const user = rows[0];
      if (!user) return res.status(404).json({ error: "User not found" });

      console.log("[CHAT] User found:", { user });

      // ===== GET OR CREATE CONVERSATION =====
      const conversation_id = await getOrCreateConversation(sessId, id);

      // ===== WEATHER BRANCH =====
      const weatherCity = isWeatherQuery(message);
      if (weatherCity) {
        console.log("[CHAT] Weather query detected for:", weatherCity);
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

          console.log("[CHAT] Weather AI response:", reply);
          return res.json({ reply });
        } catch (e) {
          console.error("[CHAT] Weather fetch error:", e);
          return res.json({
            reply: `Sorry, I could not retrieve live weather for **${weatherCity}**. (${
              e.message || e
            })`,
          });
        }
      }

      // ===== SAVE USER MESSAGE =====
      if (message) {
        await saveMessage(sessId, id, "user", message, req.app.get("io"));
        console.log("[CHAT] User message saved");
      }

      // ===== UPDATE CONVERSATION TITLE =====
      const [convRowsTitle] = await pool.query(
        "SELECT id, title FROM conversations WHERE session_id = ? AND user_id = ?",
        [sessId, id]
      );
      if (
        convRowsTitle.length &&
        message &&
        (!convRowsTitle[0].title || !convRowsTitle[0].title.trim())
      ) {
        const firstWords = message.split(" ").slice(0, 7).join(" ");
        const summaryTitle =
          firstWords + (message.split(" ").length > 7 ? "…" : "");
        await pool.query("UPDATE conversations SET title = ? WHERE id = ?", [
          summaryTitle,
          convRowsTitle[0].id,
        ]);
        console.log("[CHAT] Conversation title updated:", summaryTitle);
      }

      // ===== LOAD MESSAGE HISTORY =====
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
        console.log("[CHAT] Loaded message history:", messageHistory.length);
      }

      // ===== FILE HANDLING - SAVE NEW FILES TO DATABASE =====
      let extractedText = "";
      let importedFiles = [];
      let newFilesUploaded = false;

      if (req.files && req.files.length > 0) {
        console.log("[CHAT] Processing uploaded files:", req.files.length);
        newFilesUploaded = true;

        try {
          for (const file of req.files) {
            const fileExt = path
              .extname(file.originalname)
              .toLowerCase()
              .slice(1);
            const importResult = await importFile(file.path, fileExt);
            
            if (importResult.success) {
              extractedText += importResult.extractedText + "\n\n";
              importedFiles.push({
                ...importResult,
                filePath: file.path,
                originalName: file.originalname,
                fileType: fileExt
              });

              // ===== SAVE FILE INFO TO DATABASE =====
              await pool.query(
                "INSERT INTO uploaded_files (conversation_id, user_id, file_path, original_name, file_type) VALUES (?, ?, ?, ?, ?)",
                [conversation_id, id, file.path, file.originalname, fileExt]
              );
              
              console.log("[CHAT] File saved to database:", file.originalname);
            } else {
              console.error("[CHAT] File import failed:", importResult.error);
              extractedText += `[Failed to import ${file.originalname}: ${importResult.error}]\n\n`;
            }
          }
        } catch (e) {
          console.error("[CHAT] File processing error:", e);
          extractedText += `[Error processing files: ${e.message}]\n\n`;
        }
      }
      let previousFile = null;
      
      if (!newFilesUploaded && message && extractedText.length === 0) {
        const intentResult = await detectDocumentIntent(message, OPENAI_API_KEY);
        
        console.log("[CHAT] Intent for message without file:", intentResult.intent);
                let requiresPreviousFile = false;
        
        if (intentResult.intent === "MODIFY" || intentResult.intent === "ANALYZE") {
          try {
            const fileReferenceCheck = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${OPENAI_API_KEY}`,
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                temperature: 0,
                messages: [
                  {
                    role: "user",
                    content: `Does this message refer to a SPECIFIC previously uploaded file/document? Reply with only YES or NO.

Message: "${message}"

Reply YES if:
- User says "the document", "this file", "that PDF", "the spreadsheet"
- User says "analyze it", "modify it", "summarize it" (referring to something specific)
- User mentions a specific file they already uploaded

Reply NO if:
- User asks to create/generate/explain something NEW
- User asks general questions like "explain AWS", "what is X", "create a report"
- No reference to a previously uploaded file

Reply with ONE WORD: YES or NO`
                  }
                ],
              }),
            });

            const checkData = await fileReferenceCheck.json();
            const result = checkData.choices[0].message.content.trim().toUpperCase();
            
            console.log("[CHAT] File reference check:", result);
            
            requiresPreviousFile = result === "YES";
            
          } catch (error) {
            console.error("[CHAT] File reference check failed:", error);
            requiresPreviousFile = intentResult.intent === "MODIFY";
          }
        }
        
        if (requiresPreviousFile) {
          console.log("[CHAT] Document action intent detected, looking for previous file...");
                    const [previousFiles] = await pool.query(
            "SELECT * FROM uploaded_files WHERE conversation_id = ? ORDER BY uploaded_at DESC LIMIT 1",
            [conversation_id]
          );

          if (previousFiles.length > 0) {
            previousFile = previousFiles[0];
            console.log("[CHAT] Found previous file:", previousFile.original_name);
            if (fs.existsSync(previousFile.file_path)) {
              const importResult = await importFile(previousFile.file_path, previousFile.file_type);
              
              if (importResult.success) {
                extractedText = importResult.extractedText;
                importedFiles.push({
                  ...importResult,
                  filePath: previousFile.file_path,
                  originalName: previousFile.original_name,
                  fileType: previousFile.file_type
                });
                console.log("[CHAT] Previous file loaded successfully, extracted text length:", extractedText.length);
              } else {
                console.error("[CHAT] Failed to import previous file:", importResult.error);
              }
            } else {
              console.log("[CHAT] Previous file no longer exists on disk");
              await saveMessage(
                sessId, 
                id, 
                "bot", 
                "⚠️ The previously uploaded file is no longer available. Please upload the file again.", 
                req.app.get("io")
              );
              if (user.role === "free") {
                await pool.query(
                  "UPDATE users SET queries_used = queries_used + 1 WHERE id=?",
                  [id]
                );
              }
              return res.json({ 
                reply: "⚠️ The previously uploaded file is no longer available. Please upload the file again." 
              });
            }
          } else {
            console.log("[CHAT] No previous file found - treating as normal query");
            // Don't block the request, just continue with normal flow
          }
        } else {
          console.log("[CHAT] Not a file-specific request, continuing with normal flow");
        }
      }
      // ===== HANDLE FILE-ONLY MESSAGE (No text) =====
      if (newFilesUploaded && (!message || message.trim().length === 0)) {
        console.log("[CHAT] File-only upload detected");
        
        const fileNames = importedFiles.map(f => f.originalName).join(", ");
        const replyText = `✅ File(s) received: **${fileNames}**\n\n\n- Ask me questions about the content\n- Request modifications\n- Ask me to analyze or summarize it\n\nWhat would you like me to do?`;
        
        await saveMessage(sessId, id, "bot", replyText, req.app.get("io"));
        
        if (user.role === "free") {
          await pool.query(
            "UPDATE users SET queries_used = queries_used + 1 WHERE id=?",
            [id]
          );
        }
        
        return res.json({ reply: replyText });
      }

      // ===== DETECT USER INTENT =====
      const intent = await detectExportIntent(message, OPENAI_API_KEY);
      const wordCount = message.trim().split(/\s+/).length;
      const { isExport: doExport, isPureExport, hasContentRequest } = intent;
      const combinedRequest =
        doExport && hasContentRequest && !isPureExport && wordCount >= 5;

      console.log("[CHAT] User intent:", {
        doExport,
        isPureExport,
        hasContentRequest,
        combinedRequest,
        exportType: intent.exportType,
        confidence: intent.confidence,
        wordCount,
      });

          if (importedFiles.length && message) {
        const intentResult = await detectDocumentIntent(message, OPENAI_API_KEY);
        console.log("[CHAT] Document intent:", intentResult.intent);
        
        if (intentResult.intent === "MODIFY") {
          const fileToModify = {
            path: importedFiles[0].filePath,
            originalname: importedFiles[0].originalName
          };
          const modResult = await handleDocumentModification(
            fileToModify,
            message,
            sessId,
            user,
            req,
            messageHistory
          );
          
          if (modResult.success) {
            console.log("[CHAT] Document modification completed successfully");
            return res.json({ reply: modResult.reply });
          } else if (modResult.reply) {
            console.log("[CHAT] Document modification failed:", modResult.reply);
            return res.json({ reply: modResult.reply });
          }
          console.log("[CHAT] Not a modification request, continuing to normal AI flow");
        }
      }

      // ===== PURE EXPORT =====
      if (isPureExport && doExport) {
        console.log("[CHAT] Handling pure export...");
        const reply = await handlePureExport(
          allMessages,
          messageHistory,
          message,
          sessId,
          intent.exportType
        );
        return res.json({ reply });
      }

      // ===== COMBINED REQUEST (content + export) =====
      if (combinedRequest) {
        console.log("[CHAT] Handling combined request...");
        const contentRequest = await extractContentRequest(message, OPENAI_API_KEY);
        
        if (!contentRequest) {
          return res.json({
            reply: "Please tell me what content you want to generate.",
          });
        }

        const reply = await handleCombinedRequest(
          contentRequest,
          extractedText,
          messageHistory,
          sessId,
          user,
          intent.exportType,
          companyName,
          location,
          industry,
          req
        );
        return res.json({ reply });
      }

      // ===== NORMAL AI FLOW =====
      console.log("[CHAT] Handling normal AI flow...");
      const finalOutput = await getAIResponse(
        message,
        messageHistory,
        extractedText,
        companyName,
        location,
        industry
      );

      await saveMessage(sessId, id, "bot", finalOutput, req.app.get("io"));
      
      if (user.role === "free") {
        await pool.query(
          "UPDATE users SET queries_used = queries_used + 1 WHERE id=?",
          [id]
        );
      }

      console.log("[CHAT] AI response sent");
      return res.json({ reply: finalOutput });

    } catch (err) {
      console.error("[CHAT] AI ERROR:", err?.message || err);
      if (err.response) {
        try {
          const text = await err.response.text();
          console.error("[OpenAI error body]", text);
        } catch (e) {
          console.error("[Error reading response]", e);
        }
      }
      res.status(500).json({ error: err?.message || err });
    } finally {
      console.log("[CHAT] Request completed - files retained for conversation");
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
