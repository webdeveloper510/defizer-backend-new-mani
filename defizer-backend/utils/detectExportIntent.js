async function detectExportIntent(message, OPENAI_API_KEY) {
  if (!message || typeof message !== "string") {
    return {
      isExport: false,
      isPureExport: false,
      hasContentRequest: false,
      exportType: "docx", // Changed from null to "docx"
      confidence: "none"
    };
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
You are an intent classifier.

Analyze the user message and return ONLY JSON with this exact structure:

{
  "isExport": boolean,
  "isPureExport": boolean,
  "hasContentRequest": boolean,
  "exportType": "pdf" | "docx" | "doc" | "word" | "xlsx" | "xls" | "excel" | "csv" | "txt" | "rtf" | "pptx" | "ppt" | "html" | "htm" | "xml" | "tsv" | "ods" | "odt" | "odp" | "ics" | "vcf" | "eml" | "msg" | "mbox" | "zip" | "rar" | "7z" | "tar.gz" | "md" | "markdown" | "jpg" | "jpeg" | "png" | "bmp" | "tiff" | "gif",
  "confidence": "high" | "medium" | "low" | "none"
}

CRITICAL RULES:
- exportType must ALWAYS be one of the listed formats above
- NEVER use "generic" - default to "docx" if format is unclear
- If no export intent, still set exportType to "docx" as default
- Match the EXACT format string the user mentions (e.g., "rtf" → "rtf", not "generic")

Format Detection Rules:
- "word" or "Word" → "docx"
- "excel" or "Excel" → "xlsx"
- "powerpoint" or "PowerPoint" → "pptx"
- "text" → "txt"
- Always use lowercase for format (e.g., "PDF" → "pdf")

Intent Classification:
- isExport: true if user wants to export, download, save, convert, or generate a file
- isPureExport: true ONLY if exporting existing content without creating anything new
- hasContentRequest: true if asking to write, create, generate, explain, analyze, summarize, compare, describe, or produce content
- confidence:
    - high → clear export intent with specific format mentioned
    - medium → export intent but format needs inference
    - low → weak/implicit intent
    - none → no export intent

Important Logic:
- isPureExport and hasContentRequest can NEVER both be true
- If content must be created before export → isPureExport = false, hasContentRequest = true
- ALWAYS provide a valid exportType from the list above

Examples:

"export this as PDF" →
{ "isExport": true, "isPureExport": true, "hasContentRequest": false, "exportType": "pdf", "confidence": "high" }

"download as excel" →
{ "isExport": true, "isPureExport": true, "hasContentRequest": false, "exportType": "xlsx", "confidence": "high" }

"create a report and export as rtf" →
{ "isExport": true, "isPureExport": false, "hasContentRequest": true, "exportType": "rtf", "confidence": "high" }

"create a quarterly report with tables and export it as rtf" →
{ "isExport": true, "isPureExport": false, "hasContentRequest": true, "exportType": "rtf", "confidence": "high" }

"explain quantum physics in PDF" →
{ "isExport": true, "isPureExport": false, "hasContentRequest": true, "exportType": "pdf", "confidence": "high" }

"explain quantum physics" →
{ "isExport": false, "isPureExport": false, "hasContentRequest": true, "exportType": "docx", "confidence": "none" }

"generate a business plan" →
{ "isExport": false, "isPureExport": false, "hasContentRequest": true, "exportType": "docx", "confidence": "none" }

"save this as Word" →
{ "isExport": true, "isPureExport": true, "hasContentRequest": false, "exportType": "docx", "confidence": "high" }
`
          },
          { role: "user", content: message }
        ]
      })
    });

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);

    // ✅ VALIDATION: Ensure exportType is valid
    const validFormats = [
      'pdf', 'docx', 'doc', 'word', 'xlsx', 'xls', 'excel', 'csv', 
      'txt', 'rtf', 'pptx', 'ppt', 'html', 'htm', 'xml', 'tsv',
      'ods', 'odt', 'odp', 'ics', 'vcf', 'eml', 'msg', 'mbox',
      'zip', 'rar', '7z', 'tar.gz', 'md', 'markdown',
      'jpg', 'jpeg', 'png', 'bmp', 'tiff', 'gif'
    ];

    if (!result.exportType || !validFormats.includes(result.exportType.toLowerCase())) {
      console.warn('[EXPORT INTENT] Invalid/missing exportType detected:', result.exportType, '→ defaulting to docx');
      result.exportType = 'docx';
    }

    console.log('[EXPORT INTENT DETECTED]', {
      message: message.slice(0, 80) + '...',
      result
    });

    return result;

  } catch (error) {
    console.error("[EXPORT INTENT ERROR]", error);

    return {
      isExport: false,
      isPureExport: false,
      hasContentRequest: true,
      exportType: "docx", // Changed from null to "docx"
      confidence: "none",
      error: error.message
    };
  }
}

module.exports = { detectExportIntent };
