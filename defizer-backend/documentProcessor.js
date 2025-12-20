// documentProcessor.js - ENHANCED WITH NATIVE FORMAT SUPPORT
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const XLSX = require('xlsx');
const { Document, Paragraph, TextRun, AlignmentType } = require('docx');
const fs = require('fs').promises;
const path = require('path');

/**
 * FORMAT CLASSIFICATION
 * Determines the best modification strategy for each format
 */
const FORMAT_STRATEGIES = {
  // Native editing possible - preserve exact format
  native: ['xlsx', 'xls', 'csv', 'tsv', 'txt', 'json', 'xml', 'html', 'md'],
  
  // Text-based - structure preservation possible
  textBased: ['docx', 'doc', 'odt', 'rtf'],
  
  // Binary/Complex - extract, modify, recreate
  complex: ['pdf', 'pptx', 'ppt', 'odp'],
  
  // Image formats - OCR then recreate
  image: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff'],
  
  // Archive formats - extract, modify contents, repack
  archive: ['zip', 'rar', '7z', 'tar.gz'],
  
  // Special formats
  special: ['ics', 'vcf', 'eml', 'msg', 'mbox']
};

/**
 * Get modification strategy for a format
 */
function getFormatStrategy(format) {
  format = format.toLowerCase().replace('.', '');
  
  for (const [strategy, formats] of Object.entries(FORMAT_STRATEGIES)) {
    if (formats.includes(format)) return strategy;
  }
  
  return 'textBased'; // default
}

/**
 * MAIN PROCESSOR - Routes to appropriate handler
 */
async function processDocumentModification(originalContent, userRequest, OPENAI_API_KEY, options = {}) {
  try {
    const { 
      originalFormat = 'txt', 
      structuredData = null,
      filename = 'document',
      filePath = null
    } = options;

    console.log('[DOC PROCESSOR] Processing:', {
      format: originalFormat,
      contentLength: originalContent.length,
      hasStructuredData: !!structuredData,
      strategy: getFormatStrategy(originalFormat)
    });

    const strategy = getFormatStrategy(originalFormat);

    // Route to appropriate handler based on format strategy
    switch (strategy) {
      case 'native':
        return await processNativeFormat(originalContent, userRequest, OPENAI_API_KEY, options);
      
      case 'textBased':
        return await processTextBasedFormat(originalContent, userRequest, OPENAI_API_KEY, options);
      
      case 'complex':
        return await processComplexFormat(originalContent, userRequest, OPENAI_API_KEY, options);
      
      default:
        return await processTextBasedFormat(originalContent, userRequest, OPENAI_API_KEY, options);
    }

  } catch (error) {
    console.error('[DOC PROCESSOR ERROR]', error);
    return {
      success: false,
      error: `Document modification failed: ${error.message}`,
      originalContent
    };
  }
}

/**
 * HANDLER 1: Native Format Processing (CSV, Excel, TSV, TXT, JSON, XML)
 * These formats can be directly edited while preserving structure
 */
async function processNativeFormat(originalContent, userRequest, OPENAI_API_KEY, options) {
  const { originalFormat, structuredData, filename } = options;

  console.log('[NATIVE FORMAT] Processing:', originalFormat);

  // Handle spreadsheet formats (CSV, TSV, Excel)
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(originalFormat)) {
    return await modifySpreadsheet(originalContent, userRequest, OPENAI_API_KEY, {
      ...options,
      delimiter: originalFormat === 'tsv' ? '\t' : ','
    });
  }

  // Handle structured text formats (JSON, XML)
  if (['json', 'xml'].includes(originalFormat)) {
    return await modifyStructuredText(originalContent, userRequest, OPENAI_API_KEY, options);
  }

  // Handle plain text
  if (['txt', 'md', 'html'].includes(originalFormat)) {
    return await modifyPlainText(originalContent, userRequest, OPENAI_API_KEY, options);
  }

  // Fallback to text-based processing
  return await processTextBasedFormat(originalContent, userRequest, OPENAI_API_KEY, options);
}

/**
 * HANDLER 2: Text-Based Format Processing (DOCX, DOC, ODT, RTF)
 * Extract text, modify, recreate with basic formatting
 */
async function processTextBasedFormat(originalContent, userRequest, OPENAI_API_KEY, options) {
  const { originalFormat, filename } = options;

  console.log('[TEXT-BASED FORMAT] Processing:', originalFormat);

  // Use AI to modify content with format awareness
  const modifiedContent = await getAIModification(
    originalContent,
    userRequest,
    OPENAI_API_KEY,
    originalFormat,
    'textBased'
  );

  return {
    success: true,
    modifiedContent,
    originalContent,
    originalFormat,
    metadata: {
      modificationType: detectModificationType(userRequest),
      formatPreserved: true,
      strategy: 'textBased',
      format: originalFormat,
      filename
    }
  };
}

/**
 * HANDLER 3: Complex Format Processing (PDF, PPTX, PPT)
 * These require special handling
 */
async function processComplexFormat(originalContent, userRequest, OPENAI_API_KEY, options) {
  const { originalFormat, filename } = options;

  console.log('[COMPLEX FORMAT] Processing:', originalFormat);

  // For PDF and presentations, we can only work with extracted text
  const modifiedContent = await getAIModification(
    originalContent,
    userRequest,
    OPENAI_API_KEY,
    originalFormat,
    'complex'
  );

  return {
    success: true,
    modifiedContent,
    originalContent,
    originalFormat,
    metadata: {
      modificationType: detectModificationType(userRequest),
      formatPreserved: false, // Cannot preserve exact format for complex types
      strategy: 'complex',
      format: originalFormat,
      filename,
      note: 'Original formatting may be lost due to format complexity'
    }
  };
}

/**
 * SPREADSHEET MODIFIER
 * Preserves rows, columns, and cell structure
 */
async function modifySpreadsheet(originalContent, userRequest, OPENAI_API_KEY, options) {
  const { structuredData, delimiter = ',', originalFormat } = options;

  console.log('[SPREADSHEET] Modifying with structure preservation');

  // Parse the spreadsheet data
  let rows = [];
  if (structuredData) {
    // Use structured data if available
    rows = structuredData;
  } else {
    // Parse from text
    rows = originalContent.split('\n').map(line => 
      line.split(delimiter).map(cell => cell.trim())
    );
  }

  if (rows.length === 0) {
    return {
      success: false,
      error: 'Empty spreadsheet data',
      originalContent
    };
  }

  // Get AI to modify the data while preserving structure
  const prompt = buildSpreadsheetModificationPrompt(rows, userRequest, delimiter);

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
          content: 'You are a spreadsheet data processor. Preserve the exact structure (rows and columns) while making requested modifications. Return ONLY the modified data in the same format.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1
    })
  });

  const data = await response.json();
  let modifiedContent = data.choices?.[0]?.message?.content?.trim() || originalContent;

  // Clean up any markdown formatting that AI might add
  modifiedContent = modifiedContent.replace(/```[a-z]*\n?/g, '').trim();

  return {
    success: true,
    modifiedContent,
    originalContent,
    originalFormat,
    metadata: {
      modificationType: 'spreadsheet',
      rowCount: rows.length,
      columnCount: rows[0]?.length || 0,
      formatPreserved: true,
      strategy: 'native',
      format: originalFormat
    }
  };
}

/**
 * STRUCTURED TEXT MODIFIER (JSON, XML)
 */
async function modifyStructuredText(originalContent, userRequest, OPENAI_API_KEY, options) {
  const { originalFormat } = options;

  console.log('[STRUCTURED TEXT] Modifying:', originalFormat);

  const prompt = `
You are a ${originalFormat.toUpperCase()} data processor.

ORIGINAL ${originalFormat.toUpperCase()} DATA:
${originalContent}

USER REQUEST:
"${userRequest}"

INSTRUCTIONS:
1. Modify the data according to the user's request
2. MAINTAIN valid ${originalFormat.toUpperCase()} structure
3. Preserve all keys/attributes that aren't being modified
4. Return ONLY the modified ${originalFormat.toUpperCase()}, no explanations

OUTPUT THE MODIFIED ${originalFormat.toUpperCase()}:
`.trim();

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: `You are a ${originalFormat} data processor. Always return valid ${originalFormat}.` },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1
    })
  });

  const data = await response.json();
  let modifiedContent = data.choices?.[0]?.message?.content?.trim() || originalContent;

  // Clean markdown artifacts
  modifiedContent = modifiedContent.replace(/```[a-z]*\n?/g, '').trim();

  return {
    success: true,
    modifiedContent,
    originalContent,
    originalFormat,
    metadata: {
      modificationType: 'structured',
      formatPreserved: true,
      strategy: 'native',
      format: originalFormat
    }
  };
}

/**
 * PLAIN TEXT MODIFIER
 */
async function modifyPlainText(originalContent, userRequest, OPENAI_API_KEY, options) {
  const { originalFormat } = options;

  const modifiedContent = await getAIModification(
    originalContent,
    userRequest,
    OPENAI_API_KEY,
    originalFormat,
    'native'
  );

  return {
    success: true,
    modifiedContent,
    originalContent,
    originalFormat,
    metadata: {
      modificationType: detectModificationType(userRequest),
      formatPreserved: true,
      strategy: 'native',
      format: originalFormat
    }
  };
}

/**
 * UNIVERSAL AI MODIFICATION
 * Gets AI to modify content with format awareness
 */
async function getAIModification(originalContent, userRequest, OPENAI_API_KEY, format, strategy) {
  const formatInstructions = getFormatSpecificInstructions(format, strategy);
  
  // Detect if this is a selective section modification
  const sectionMatch = userRequest.match(/change\s+(?:the\s+)?(.*?)\s+(?:section|part)/i) || 
                      userRequest.match(/make\s+(?:the\s+)?(.*?)\s+(?:section|part)/i);
  
  const targetSection = sectionMatch ? sectionMatch[1].toLowerCase().trim() : null;

  let prompt = '';
  
  if (targetSection) {
    // SECTION-SPECIFIC MODIFICATION
    prompt = `
CRITICAL: MODIFY ONLY THE SPECIFIED SECTION, RETURN COMPLETE DOCUMENT

FORMAT: ${format.toUpperCase()}
${formatInstructions}

COMPLETE ORIGINAL DOCUMENT:
"""
${originalContent}
"""

USER REQUEST: "${userRequest}"

INSTRUCTIONS:
1. Find the section about "${targetSection}"
2. Modify ONLY that section according to the request
3. Keep ALL other sections EXACTLY as they are
4. Return the COMPLETE document with the modification
5. DO NOT truncate, summarize, or omit any sections
6. Maintain original ${format} formatting

OUTPUT THE COMPLETE MODIFIED DOCUMENT:
`;
  } else {
    // ENTIRE DOCUMENT MODIFICATION
    prompt = `
DOCUMENT MODIFICATION TASK

FORMAT: ${format.toUpperCase()}
${formatInstructions}

ORIGINAL DOCUMENT:
"""
${originalContent}
"""

USER REQUEST: "${userRequest}"

INSTRUCTIONS:
1. Apply the requested changes
2. Maintain ${format} formatting
3. Preserve document structure
4. Return the COMPLETE modified document

OUTPUT THE MODIFIED DOCUMENT:
`;
  }

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
          content: `You are a precise document editor for ${format} files. Always return complete documents, never truncate. Preserve formatting.`
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: Math.max(originalContent.length * 1.5, 4000)
    })
  });

  const data = await response.json();
  let modifiedContent = data.choices?.[0]?.message?.content?.trim() || originalContent;

  // Clean markdown code blocks if present
  modifiedContent = modifiedContent.replace(/```[a-z]*\n?/g, '').trim();

  return modifiedContent;
}

/**
 * BUILD SPREADSHEET MODIFICATION PROMPT
 */
function buildSpreadsheetModificationPrompt(rows, userRequest, delimiter) {
  const headers = rows[0];
  const dataRows = rows.slice(1);

  return `
SPREADSHEET DATA (${rows.length} rows × ${headers.length} columns):

Headers: ${headers.join(delimiter)}

Data preview (first 5 rows):
${dataRows.slice(0, 5).map(row => row.join(delimiter)).join('\n')}

USER REQUEST: "${userRequest}"

INSTRUCTIONS:
1. Analyze the user's request
2. Modify the data accordingly
3. Preserve the EXACT structure (same number of columns)
4. Return ALL rows (not just preview)
5. Use "${delimiter}" as delimiter
6. Return ONLY the modified data, no explanations

OUTPUT FORMAT:
${headers.join(delimiter)}
[modified data rows...]
`;
}

/**
 * GET FORMAT-SPECIFIC INSTRUCTIONS
 */
function getFormatSpecificInstructions(format, strategy) {
  const instructions = {
    csv: 'Preserve comma-separated format. Keep all rows and columns in order.',
    tsv: 'Preserve tab-separated format. Keep all rows and columns in order.',
    xlsx: 'Maintain spreadsheet structure with rows and columns.',
    xls: 'Maintain spreadsheet structure with rows and columns.',
    json: 'Preserve valid JSON structure. Keep all keys unless specifically asked to remove.',
    xml: 'Preserve valid XML structure with proper tags and hierarchy.',
    txt: 'Preserve line breaks and basic text formatting.',
    md: 'Preserve markdown syntax (headers, lists, code blocks, links).',
    html: 'Preserve HTML tags and structure.',
    docx: 'Preserve paragraph structure and basic formatting.',
    pdf: 'Content extracted from PDF - original formatting cannot be fully preserved.',
    pptx: 'Content extracted from presentation - slide structure preserved where possible.'
  };

  return instructions[format] || 'Preserve document structure and formatting where possible.';
}

/**
 * DETECT MODIFICATION TYPE
 */
function detectModificationType(userMessage) {
  const message = userMessage.toLowerCase();

  // Specific modification patterns
  if (/change|modify|update|edit|replace|alter/i.test(message)) {
    if (/section|part|paragraph/i.test(message)) return 'section_modification';
    return 'content_modification';
  }

  if (/convert|transform|reformat|make it|turn into/i.test(message)) {
    return 'format_conversion';
  }

  if (/add|insert|append/i.test(message)) {
    return 'content_addition';
  }

  if (/remove|delete|take out/i.test(message)) {
    return 'content_removal';
  }

  if (/bullet|list|table|numbered/i.test(message)) {
    return 'structure_change';
  }

  return 'general_modification';
}

module.exports = {
  processDocumentModification,
  getFormatStrategy,
  detectModificationType
};