const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const XLSX = require("xlsx");
const {
  extractTextForAnalysis,
  getModificationInstructions,
  validateChanges,
} = require("./documentAnalyzer");

const MODIFIABLE_FORMATS = {
  direct: ["docx", "xlsx", "xls", "txt", "md", "markdown",],

  // ✅ TEXT-BASED (Simple find-replace)
  textBased: [
    "csv",
    "tsv",
    "html",
    "htm",
    "xml",
    "json",
    "rtf",
    "ics",
    "vcf",
    "eml",
    "mbox",
  ],

  // ⚠️ COMPLEX (Extract → Modify → Export)
  complex: ["pdf", "pptx", "ppt", "odp","odt"],

  // ❌ NOT MODIFIABLE (Images, media, archives)
  notModifiable: [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "tiff",
    "mp4",
    "mp3",
    "wav",
    "zip",
    "rar",
    "7z",
    "tar.gz",
    "mdb",
    "accdb",
    "msg",
  ],
};

function isFormatModifiable(format) {
  format = format.toLowerCase().replace(".", "");

  return (
    MODIFIABLE_FORMATS.direct.includes(format) ||
    MODIFIABLE_FORMATS.textBased.includes(format) ||
    MODIFIABLE_FORMATS.complex.includes(format)
  );
}
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function getModificationStrategy(format) {
  format = format.toLowerCase().replace(".", "");

  if (MODIFIABLE_FORMATS.direct.includes(format)) {
    return "DIRECT";
  }

  if (MODIFIABLE_FORMATS.textBased.includes(format)) {
    return "TEXT_BASED";
  }

  if (MODIFIABLE_FORMATS.complex.includes(format)) {
    return "EXTRACT_MODIFY_EXPORT";
  }

  return "NOT_SUPPORTED";
}

async function modifyDocumentEnhanced(
  filePath,
  userRequest,
  OPENAI_API_KEY,
  options = {}
) {
  const { originalFormat, filename } = options;
  const strategy = getModificationStrategy(originalFormat);

  console.log("[ENHANCED MODIFIER]", {
    file: filename,
    format: originalFormat,
    strategy,
    isModifiable: strategy !== "NOT_SUPPORTED",
  });

  // Route to appropriate handler
  switch (strategy) {
    case "DIRECT":
      // Use your existing code for DOCX, XLSX, TXT
      return await modifyDocumentDirectly(
        filePath,
        userRequest,
        OPENAI_API_KEY,
        options
      );

    case "TEXT_BASED":
      // Handle CSV, TSV, HTML, XML, JSON, etc.
      return await modifyTextBasedFormat(
        filePath,
        userRequest,
        OPENAI_API_KEY,
        options
      );

    case "EXTRACT_MODIFY_EXPORT":
      // Handle PDF, PPTX (extract → modify → export)
      return await modifyComplexFormat(
        filePath,
        userRequest,
        OPENAI_API_KEY,
        options
      );

    case "NOT_SUPPORTED":
      return {
        success: false,
        error: `Format ${originalFormat.toUpperCase()} does not support direct modification.`,
        recommendation: `You can export this to a modifiable format (DOCX, TXT, etc.) first.`,
      };

    default:
      return {
        success: false,
        error: `Unknown modification strategy for ${originalFormat}`,
      };
  }
}

async function modifyDocumentDirectly(
  filePath,
  userRequest,
  OPENAI_API_KEY,
  options = {}
) {
  const { originalFormat, filename } = options;

  console.log("[DIRECT MODIFIER] Starting:", {
    file: filename,
    format: originalFormat,
    request: userRequest,
  });

  try {
    // Extract text
    const documentText = await extractTextForAnalysis(filePath, originalFormat);

    // Get AI instructions
    const instructions = await getModificationInstructions(
      documentText,
      userRequest,
      OPENAI_API_KEY
    );

    if (!instructions.changes || instructions.changes.length === 0) {
      return {
        success: false,
        error: instructions.explanation || "No modifications identified by AI",
      };
    }

    // Validate changes
    const { validated, errors } = validateChanges(
      documentText,
      instructions.changes
    );

    if (validated.length === 0) {
      return {
        success: false,
        error: "No valid changes could be applied (text not found in document)",
      };
    }

    // Apply changes based on format
    switch (originalFormat.toLowerCase()) {
      case "docx":
        return await modifyDocxWithLists(filePath, validated, options);

      case "xlsx":
      case "xls":
        return await modifyExcelDirectly(filePath, validated, options);

      case "txt":
      case "md":
      case "markdown":
        return await modifyTextDirectly(filePath, validated, options);

      default:
        throw new Error(
          `Format ${originalFormat} not handled in direct modifier`
        );
    }
  } catch (error) {
    console.error("[DIRECT MODIFIER ERROR]", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// HANDLER 2: TEXT-BASED FORMATS (CSV, TSV, HTML, XML, JSON, etc.)
// ============================================================================

async function modifyTextBasedFormat(
  filePath,
  userRequest,
  OPENAI_API_KEY,
  options = {}
) {
  const { originalFormat, filename } = options;

  console.log("[TEXT-BASED MODIFIER]", {
    format: originalFormat,
    file: filename,
  });

  try {
    // Read file as text
    let content = await fs.readFile(filePath, "utf-8");

    // Get AI instructions
    const instructions = await getModificationInstructions(
      content,
      userRequest,
      OPENAI_API_KEY
    );

    if (!instructions.changes || instructions.changes.length === 0) {
      return {
        success: false,
        error: instructions.explanation || "No modifications identified",
      };
    }

    // Validate changes
    const { validated, errors } = validateChanges(
      content,
      instructions.changes
    );

    if (validated.length === 0) {
      return {
        success: false,
        error: "No valid changes found in document",
      };
    }

    // Apply all changes
    let modifiedContent = content;
    let changesApplied = 0;

    for (const change of validated) {
      const findText = change.find.trim();
      const replaceText = change.replace.trim();

      if (modifiedContent.includes(findText)) {
        modifiedContent = modifiedContent.replace(findText, replaceText);
        changesApplied++;
        console.log("[TEXT-BASED] Applied:", change.reason);
      }
    }

    if (changesApplied === 0) {
      return {
        success: false,
        error: "No changes were applied (text not found)",
      };
    }

    // For JSON/XML, validate syntax
    if (originalFormat === "json") {
      try {
        JSON.parse(modifiedContent);
      } catch (e) {
        console.warn(
          "[JSON VALIDATION] Invalid JSON after modification, attempting fix..."
        );
        modifiedContent = modifiedContent.trim();
      }
    }

    // Save modified file
    const outputPath = filePath.replace(/(\.[^.]+)$/, "_modified$1");
    await fs.writeFile(outputPath, modifiedContent, "utf-8");

    console.log("[TEXT-BASED] ✓ Saved:", outputPath);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat,
      metadata: {
        method: "text_based_modification",
        changesApplied,
        preservedStructure: true,
      },
    };
  } catch (error) {
    console.error("[TEXT-BASED ERROR]", error);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// HANDLER 3: COMPLEX FORMATS (PDF, PPTX - Extract → Modify → Export)
// ============================================================================

async function modifyComplexFormat(
  filePath,
  userRequest,
  OPENAI_API_KEY,
  options = {}
) {
  const { originalFormat, filename } = options;
const { exportFile } = require("../fileGenerators");
  console.log("[COMPLEX MODIFIER]", { format: originalFormat, file: filename });

  try {
    // STEP 1: Extract text
    console.log("[COMPLEX] Step 1: Extracting text...");
    const extractedText = await extractTextForAnalysis(
      filePath,
      originalFormat
    );

    if (!extractedText || extractedText.trim().length < 10) {
      return {
        success: false,
        error: "Could not extract text from document",
      };
    }

    // STEP 2: Modify with AI
    console.log("[COMPLEX] Step 2: Modifying content...");
    const modifiedText = await getAIModificationForComplex(
      extractedText,
      userRequest,
      OPENAI_API_KEY,
      originalFormat
    );

    // STEP 3: Export to same format
    console.log("[COMPLEX] Step 3: Exporting to", originalFormat);
    const exportResult = await exportFile(
      modifiedText,
      "temp_session",
      filename.replace(/\.[^/.]+$/, ""),
      originalFormat
    );

    if (!exportResult || !exportResult.url) {
      throw new Error("Export failed");
    }

    // Convert URL to file path
    const outputPath = path.join(__dirname, "uploads", exportResult.name);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat,
      metadata: {
        method: "extract_modify_export",
        preservedStructure: false,
        note: `Original ${originalFormat.toUpperCase()} formatting may be lost. Content modified and re-exported.`,
      },
    };
  } catch (error) {
    console.error("[COMPLEX ERROR]", error);
    return {
      success: false,
      error: `Complex format modification failed: ${error.message}`,
      recommendation: `Try exporting to DOCX first, then modify.`,
    };
  }
}

// ============================================================================
// AI MODIFICATION FOR COMPLEX FORMATS
// ============================================================================

async function getAIModificationForComplex(
  content,
  userRequest,
  apiKey,
  format
) {
  const fetch = (...args) =>
    import("node-fetch").then(({ default: fetch }) => fetch(...args));

  const prompt = `You are modifying content extracted from a ${format.toUpperCase()} file.

USER REQUEST: "${userRequest}"

ORIGINAL CONTENT:
${content}

INSTRUCTIONS:
1. Apply the requested modifications
2. Return the COMPLETE modified content
3. Do not truncate or summarize
4. Maintain readability and structure

OUTPUT THE MODIFIED CONTENT:`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a document editor. Return complete modified content for ${format} files.`,
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: Math.max(content.length * 1.5, 4000),
    }),
  });

  const data = await response.json();
  let modified = data.choices?.[0]?.message?.content?.trim() || content;

  // Clean markdown artifacts
  modified = modified.replace(/```[a-z]*\n?/g, "").trim();

  return modified;
}

async function modifyDocxWithLists(filePath, changes, options) {
  try {
    const content = fsSync.readFileSync(filePath, "binary");
    const zip = new PizZip(content);
    let documentXml = zip.files["word/document.xml"].asText();

    // Create a deep copy of the document for comparison
    const originalXml = documentXml;

    // Apply changes
    let changesApplied = 0;

    for (const change of changes) {
      const findText = change.find.trim();
      const replaceText = change.replace.trim();
      const scope = change.scope || "global";

      // Check if this is a list/bullet change
      const hasBullets = /^[•\-*]\s+/m.test(replaceText);
      const hasNumbering = /^\d+\.\s+/m.test(replaceText);

      if (hasBullets || hasNumbering) {
        // Handle list conversion
        const { heading, listItems, isNumbered } = parseListText(replaceText);
        const result = replaceSectionWithList(
          documentXml,
          findText,
          heading,
          listItems,
          isNumbered
        );

        if (result.success) {
          documentXml = result.content;
          changesApplied++;
        } else {
          // Fall back to text replacement
          documentXml = replaceTextInDocument(
            documentXml,
            findText,
            replaceText,
            scope
          );
          changesApplied++;
        }
      } else {
        // Regular text replacement
        documentXml = replaceTextInDocument(
          documentXml,
          findText,
          replaceText,
          scope
        );
        changesApplied++;
      }
    }

    // Ensure numbering XML exists if needed
    if (documentXml.includes("<w:numPr>") && !zip.files["word/numbering.xml"]) {
      zip.file("word/numbering.xml", createNumberingXml());

      // Update document relationships if needed
      if (zip.files["word/_rels/document.xml.rels"]) {
        let relsXml = zip.files["word/_rels/document.xml.rels"].asText();
        if (!relsXml.includes("numbering.xml")) {
          const maxId = Math.max(
            ...(Array.from(relsXml.matchAll(/Id="rId(\d+)"/g), (m) =>
              parseInt(m[1])
            ) || [0])
          );
          const newId = maxId + 1;
          const newRel = `<Relationship Id="rId${newId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`;
          relsXml = relsXml.replace(
            "</Relationships>",
            newRel + "</Relationships>"
          );
          zip.file("word/_rels/document.xml.rels", relsXml);
        }
      }
    }

    // Save the modified document
    zip.file("word/document.xml", documentXml);
    const modifiedBuffer = zip.generate({ type: "nodebuffer" });
    const outputPath = filePath.replace(/(\.[^.]+)$/, "_modified$1");
    await fs.writeFile(outputPath, modifiedBuffer);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: "docx",
      metadata: {
        method: "enhanced_docx_modification",
        changesApplied,
        preservedTables: true,
        preservedLists: true,
      },
    };
  } catch (error) {
    console.error("[DOCX MODIFICATION ERROR]", error);
    return {
      success: false,
      error: `DOCX modification failed: ${error.message}`,
    };
  }
}

function replaceTextInDocument(documentXml, findText, replaceText, scope) {
  // Find all text nodes in the document, including those in tables
  const textNodeRegex = /(<w:t[^>]*>)([^<]+)(<\/w:t>)/g;

  return documentXml.replace(
    textNodeRegex,
    (match, openTag, textContent, closeTag) => {
      const decodedText = decodeXml(textContent);

      if (decodedText.includes(findText)) {
        const replacedText =
          scope === "global"
            ? decodedText.replace(
                new RegExp(escapeRegExp(findText), "gi"),
                replaceText
              )
            : decodedText.replace(findText, replaceText);

        return openTag + escapeXml(replacedText) + closeTag;
      }

      return match;
    }
  );
}

function replaceSectionWithList(
  documentXml,
  findText,
  heading,
  listItems,
  isNumbered
) {
  // Extract paragraphs from the document
  const paragraphs = [];
  const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let match;

  while ((match = paragraphRegex.exec(documentXml)) !== null) {
    paragraphs.push({
      xml: match[0],
      text: extractTextFromParagraph(match[0]),
    });
  }

  // Find the paragraph(s) containing the findText
  const findTextLower = findText.toLowerCase();
  let startIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i].text.toLowerCase().includes(findTextLower)) {
      startIdx = i;
      // Look ahead to find the end of this section
      for (let j = i + 1; j < Math.min(i + 10, paragraphs.length); j++) {
        if (paragraphs[j].text.trim().length === 0) {
          endIdx = j - 1;
          break;
        }
      }
      if (endIdx === -1) endIdx = Math.min(i + 5, paragraphs.length - 1);
      break;
    }
  }

  if (startIdx === -1) {
    return { success: false, content: documentXml };
  }

  // Generate list XML
  let listXml = "";

  if (heading) {
    heading.split("\n").forEach((line) => {
      listXml += `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
        line
      )}</w:t></w:r></w:p>`;
    });
  }

  listItems.forEach((item) => {
    listXml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${
      isNumbered ? "2" : "1"
    }"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
      item
    )}</w:t></w:r></w:p>`;
  });

  // Reconstruct the document with the list
  const beforeSection = documentXml.substring(
    0,
    getParagraphPosition(documentXml, startIdx)
  );
  const afterSection = documentXml.substring(
    getParagraphPosition(documentXml, endIdx + 1)
  );

  return {
    success: true,
    content: beforeSection + listXml + afterSection,
  };
}

function getParagraphPosition(documentXml, paragraphIndex) {
  const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let position = 0;
  let count = 0;
  let match;

  while (
    (match = paragraphRegex.exec(documentXml)) !== null &&
    count < paragraphIndex
  ) {
    position = match.index + match[0].length;
    count++;
  }

  return position;
}

function extractTextFromParagraph(paragraphXml) {
  const textRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let text = "";
  let match;

  while ((match = textRegex.exec(paragraphXml)) !== null) {
    text += decodeXml(match[1]);
  }

  return text;
}

// Helper functions remain the same as before
function escapeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
function parseListText(text) {
  const lines = text.split("\n");
  const listItems = [];
  let heading = "";
  let inHeading = true;
  let isNumbered = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^[•\-*]\s+/.test(trimmed)) {
      inHeading = false;
      const content = trimmed.replace(/^[•\-*]\s+/, "").trim();
      if (content) listItems.push(content);
    } else if (/^\d+\.\s+/.test(trimmed)) {
      inHeading = false;
      isNumbered = true;
      const content = trimmed.replace(/^\d+\.\s+/, "").trim();
      if (content) listItems.push(content);
    } else if (inHeading) {
      heading += (heading ? "\n" : "") + trimmed;
    }
  }

  return { heading, listItems, isNumbered };
}

function replaceSectionWithListSafe(
  bodyContent,
  findText,
  heading,
  listItems,
  isNumbered
) {
  const paragraphs = extractParagraphsSafe(bodyContent);
  let startIdx = -1,
    endIdx = -1;
  const normalizedFind = findText.replace(/\s+/g, " ").trim().toLowerCase();

  for (let i = 0; i < paragraphs.length; i++) {
    const normalizedText = paragraphs[i].text
      .replace(/\s+/g, " ")
      .toLowerCase();
    if (normalizedText.includes(normalizedFind.slice(0, 100))) {
      startIdx = i;
      const lineCount = Math.min(findText.split("\n").length + 2, 10);
      endIdx = Math.min(i + lineCount, paragraphs.length - 1);
      break;
    }
  }

  if (startIdx === -1) return { success: false, content: bodyContent };

  const listXml = createWordListSafe(heading, listItems, isNumbered);
  const beforeSection = paragraphs.slice(0, startIdx);
  const afterSection = paragraphs.slice(endIdx + 1);
  const newContent =
    beforeSection.map((p) => p.xml).join("") +
    listXml +
    afterSection.map((p) => p.xml).join("");

  return { success: true, content: newContent };
}

function extractParagraphsSafe(bodyContent) {
  const paragraphs = [];
  const paragraphRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let match;

  while ((match = paragraphRegex.exec(bodyContent)) !== null) {
    const pXml = match[0];
    const textMatches = pXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    const text = textMatches
      .map((t) => {
        const m = t.match(/<w:t[^>]*>([^<]*)<\/w:t>/);
        return m ? decodeXml(m[1]) : "";
      })
      .join("");

    paragraphs.push({ xml: pXml, text: text.trim() });
  }

  return paragraphs;
}

function simpleTextReplaceSafe(bodyContent, findText, replaceText) {
  const paragraphs = extractParagraphsSafe(bodyContent);
  const normalizedFind = findText.replace(/\s+/g, " ").toLowerCase();
  let modified = false;

  const newParagraphs = paragraphs.map((para) => {
    const normalizedText = para.text.replace(/\s+/g, " ").toLowerCase();

    if (normalizedText.includes(normalizedFind.slice(0, 60))) {
      modified = true;
      let modifiedXml = para.xml;
      const textRegex = /<w:t([^>]*)>([^<]*)<\/w:t>/g;

      modifiedXml = modifiedXml.replace(textRegex, (match, attrs, content) => {
        const decoded = decodeXml(content);
        const newContent = decoded.replace(
          new RegExp(
            findText.split("\n")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i"
          ),
          replaceText.split("\n")[0]
        );
        return `<w:t${attrs}>${escapeXml(newContent)}</w:t>`;
      });

      return { ...para, xml: modifiedXml };
    }
    return para;
  });

  if (!modified) return bodyContent;
  return newParagraphs.map((p) => p.xml).join("");
}

function createWordListSafe(heading, listItems, isNumbered = false) {
  let xml = "";

  if (heading) {
    const headingLines = heading.split("\n").filter((l) => l.trim());
    headingLines.forEach((line) => {
      xml += `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
        line
      )}</w:t></w:r></w:p>`;
    });
  }

  const numId = isNumbered ? "2" : "1";
  listItems.forEach((item) => {
    xml += `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
      item
    )}</w:t></w:r></w:p>`;
  });

  return xml;
}

function createNumberingXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;
}

async function modifyExcelDirectly(filePath, changes, options = {}) {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    let changesApplied = 0;

    // Helper: find table (your export creates one)
    const table = worksheet.getTables()[0];

    for (const change of changes) {
      const findText = change.find?.trim();
      const replaceText = change.replace?.trim();

      /**
       * ✅ CASE 1: ADD ROW TO TABLE (Q5 | 3.0 | 1.8 | 1.2)
       */
      const rowMatch = replaceText?.match(
        /(Q\d+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/
      );

      if (rowMatch && table) {
        const [, quarter, revenue, expenses, profit] = rowMatch;

        // Prevent duplicates
        const existingRows = table.table.rows;
        const alreadyExists = existingRows.some(
          (r) => String(r[0]).trim() === quarter
        );
        if (alreadyExists) continue;

        table.addRow([
          quarter,
          Number(revenue),
          Number(expenses),
          Number(profit),
        ]);

        changesApplied++;
        continue;
      }

      /**
       * ✅ CASE 2: NORMAL TEXT REPLACEMENT (preserve styles)
       */
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (typeof cell.value === "string" && cell.value.includes(findText)) {
            cell.value = cell.value.replace(findText, replaceText);
            changesApplied++;
          }
        });
      });
    }

    const outputPath = filePath.replace(/(\.[^.]+)$/, "_modified$1");

    // Preserve original export format
    if (options.originalFormat === "xls") {
      const tempXlsxPath = outputPath.replace(".xls", ".temp.xlsx");
      await workbook.xlsx.writeFile(tempXlsxPath);

      const wb = XLSX.readFile(tempXlsxPath);
      XLSX.writeFile(wb, outputPath, { bookType: "xls", compression: true });

      fs.unlinkSync(tempXlsxPath);
    } else {
      await workbook.xlsx.writeFile(outputPath);
    }

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: options.originalFormat || "xlsx",
      metadata: {
        changesApplied,
        engine: "exceljs",
        formatPreserved: true,
      },
    };
  } catch (error) {
    console.error("[EXCEL MODIFY ERROR]", error);
    return { success: false, error: error.message };
  }
}
async function exportXMLWithSameStructure(modifiedFilePath, newContent, outputPath) {
  try {
    // Read the modified XML to get its structure
    const modifiedXML = await fs.readFile(modifiedFilePath, "utf-8");
    
    // Detect indentation from modified file
    const lines = modifiedXML.split('\n');
    let indent = '  '; // default 2 spaces
    
    for (const line of lines) {
      const match = line.match(/^(\s+)</);
      if (match) {
        indent = match[1];
        break;
      }
    }
    
    // Detect line break style
    const lineBreak = modifiedXML.includes('\r\n') ? '\r\n' : '\n';
    
    // Build new XML with SAME structure
    const contentLines = newContent.split('\n');
    let xml = [];
    let inList = false;
    let listType = null;

    xml.push('<?xml version="1.0" encoding="UTF-8"?>');
    xml.push('<document>');
    xml.push(indent + '<metadata>');
    xml.push(indent + indent + `<created>${new Date().toISOString()}</created>`);
    xml.push(indent + indent + '<generator>Defizer Export System</generator>');
    xml.push(indent + '</metadata>');
    xml.push(indent + '<content>');

    for (let line of contentLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Headings
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch) {
        if (inList) {
          xml.push(indent + indent + '</list>');
          inList = false;
        }
        const level = headingMatch[1].length;
        xml.push(`${indent}${indent}<heading level="${level}">${escapeXml(headingMatch[2])}</heading>`);
        continue;
      }

      // Bullet list
      if (/^[-*+]\s+/.test(trimmed)) {
        if (!inList) {
          inList = true;
          listType = 'bullet';
          xml.push(`${indent}${indent}<list type="${listType}">`);
        }
        xml.push(`${indent}${indent}${indent}<item>${escapeXml(trimmed.replace(/^[-*+]\s+/, ''))}</item>`);
        continue;
      }

      // Numbered list
      if (/^\d+\.\s+/.test(trimmed)) {
        if (!inList) {
          inList = true;
          listType = 'numbered';
          xml.push(`${indent}${indent}<list type="${listType}">`);
        }
        xml.push(`${indent}${indent}${indent}<item>${escapeXml(trimmed.replace(/^\d+\.\s+/, ''))}</item>`);
        continue;
      }

      // Close list
      if (inList) {
        xml.push(indent + indent + '</list>');
        inList = false;
      }

      // Paragraph
      xml.push(`${indent}${indent}<paragraph>${escapeXml(trimmed)}</paragraph>`);
    }

    if (inList) {
      xml.push(indent + indent + '</list>');
    }

    xml.push(indent + '</content>');
    xml.push('</document>');

    // Write with SAME line breaks as modified file
    await fs.writeFile(outputPath, xml.join(lineBreak), 'utf8');
    
    console.log(`[XML EXPORT] ✓ Used same structure from: ${modifiedFilePath}`);
    
    return {
      success: true,
      path: outputPath,
      usedStructureFrom: modifiedFilePath
    };

  } catch (error) {
    console.error("[XML EXPORT ERROR]", error);
    throw error;
  }
}

async function modifyTextDirectly(filePath, changes, options) {
  try {
    let content = await fs.readFile(filePath, "utf-8");
    let changesApplied = 0;

    for (const change of changes) {
      const findText = change.find;
      const replaceText = change.replace;
      const scope = change.scope || "global";

      if (scope === "global") {
        const regex = new RegExp(
          findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          "g"
        );
        content = content.replace(regex, replaceText);
      } else {
        content = content.replace(findText, replaceText);
      }

      changesApplied++;
    }

    const outputPath = filePath.replace(/(\.[^.]+)$/, "_modified$1");
    await fs.writeFile(outputPath, content);

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: options.originalFormat || "txt",
      metadata: { changesApplied },
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function escapeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(text) {
  if (!text) return "";
  return String(text)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  modifyDocumentEnhanced,
  isFormatModifiable,
  getModificationStrategy,
  MODIFIABLE_FORMATS,
  exportXMLWithSameStructure
};
