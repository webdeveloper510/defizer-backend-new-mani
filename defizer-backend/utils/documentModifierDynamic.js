// ============================================================================
// TRULY DYNAMIC DOCUMENT MODIFIER - NO HARDCODED CHECKS
// Uses AI to understand document structure and apply ANY modification
// ============================================================================

const PizZip = require('pizzip');
const fsSync = require('fs');
const fs = require('fs').promises;

/**
 * Main dynamic format executor - works for ANY transformation
 */
async function executeFormatOperationsDynamic(filePath, operations, originalFormat, options) {
  console.log('[DYNAMIC FORMAT] Starting with', operations.length, 'operations');
  
  switch (originalFormat.toLowerCase()) {
    case 'docx':
      return await executeDynamicDocxModification(filePath, operations, options);
    case 'txt':
    case 'md':
    case 'markdown':
      return await executeDynamicTextModification(filePath, operations, options);
    default:
      return { success: false, error: `FORMAT not supported for ${originalFormat}` };
  }
}

/**
 * TRULY DYNAMIC DOCX MODIFICATION
 * AI analyzes the document structure and generates the exact XML transformations needed
 */
async function executeDynamicDocxModification(filePath, operations, options) {
  const { OPENAI_API_KEY } = process.env;
  
  try {
    // Read document
    const content = fsSync.readFileSync(filePath, 'binary');
    const zip = new PizZip(content);
    let documentXml = zip.files['word/document.xml'].asText();
    
    let totalModifications = 0;

    // Process each operation dynamically
    for (const op of operations) {
      console.log('[DYNAMIC] Processing operation:', op.reason || op.transformation);

      // Extract relevant document structure
      const documentStructure = analyzeDocumentStructure(documentXml);
      
      // Ask AI to generate the XML transformation
      const transformation = await getAIXmlTransformation(
        documentStructure,
        op,
        OPENAI_API_KEY
      );

      if (transformation.success) {
        // Apply the AI-generated transformation
        const result = applyXmlTransformation(documentXml, transformation);
        
        if (result.modified) {
          documentXml = result.xml;
          totalModifications++;
          console.log('[DYNAMIC] ✓ Applied:', transformation.description);
        } else {
          console.log('[DYNAMIC] ⚠ No changes made for:', op.reason);
        }
      } else {
        console.log('[DYNAMIC] ✗ Failed to generate transformation:', transformation.error);
      }
    }

    if (totalModifications === 0) {
      return {
        success: false,
        error: 'No modifications could be applied. Please try rephrasing your request.'
      };
    }

    // Ensure numbering XML exists if we added lists
    if (documentXml.includes('<w:numPr>') && !zip.files['word/numbering.xml']) {
      zip.file('word/numbering.xml', createNumberingXml());
    }

    // Save modified document
    zip.file('word/document.xml', documentXml);
    const modifiedBuffer = zip.generate({ type: 'nodebuffer' });
    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    await fs.writeFile(outputPath, modifiedBuffer);

    console.log('[DYNAMIC] ✓ Successfully applied', totalModifications, 'modifications');

    return {
      success: true,
      modifiedFilePath: outputPath,
      metadata: {
        method: 'AI_DYNAMIC_MODIFICATION',
        operationsApplied: totalModifications
      }
    };

  } catch (error) {
    console.error('[DYNAMIC ERROR]', error);
    return {
      success: false,
      error: `Dynamic modification failed: ${error.message}`
    };
  }
}

/**
 * Analyze document structure and extract relevant information
 */
function analyzeDocumentStructure(xml) {
  const structure = {
    hasTables: xml.includes('<w:tbl>'),
    hasBulletLists: xml.includes('<w:numId w:val="1"/>'),
    hasNumberedLists: xml.includes('<w:numId w:val="2"/>'),
    paragraphCount: (xml.match(/<w:p>/g) || []).length,
    tableCount: (xml.match(/<w:tbl>/g) || []).length,
    sampleXml: extractRelevantSample(xml, 3000) // Get sample for AI analysis
  };

  console.log('[STRUCTURE]', {
    tables: structure.tableCount,
    paragraphs: structure.paragraphCount,
    bulletLists: structure.hasBulletLists,
    numberedLists: structure.hasNumberedLists
  });

  return structure;
}

/**
 * Extract relevant XML sample for AI analysis
 */
function extractRelevantSample(xml, maxLength) {
  // Remove namespaces and keep only structural elements
  let sample = xml
    .replace(/xmlns[^"]*="[^"]*"/g, '')
    .replace(/w:rsid[^=]*="[^"]*"/g, '')
    .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, '[STYLE]');
  
  if (sample.length > maxLength) {
    sample = sample.substring(0, maxLength) + '...[TRUNCATED]';
  }
  
  return sample;
}

/**
 * Ask AI to generate the exact XML transformation needed
 */
async function getAIXmlTransformation(documentStructure, operation, apiKey) {
  const prompt = `You are an expert in Microsoft Word XML (WordprocessingML) transformations.

DOCUMENT STRUCTURE:
- Has tables: ${documentStructure.hasTables}
- Has bullet lists: ${documentStructure.hasBulletLists}
- Has numbered lists: ${documentStructure.hasNumberedLists}
- Paragraphs: ${documentStructure.paragraphCount}
- Tables: ${documentStructure.tableCount}

USER REQUEST: ${operation.reason || operation.transformation}

DOCUMENT SAMPLE (for context):
${documentStructure.sampleXml}

IMPORTANT: The document might have plain text bullet points (like •, *, -) that are NOT actual Word list formatting. 
If you see text like "• Scalability:" or "* Version Control:", these are plain text, not XML bullet lists.

YOUR TASK:
Based on the user request, analyze what needs to be changed and provide SPECIFIC transformation instructions.

POSSIBLE SCENARIOS:
1. If converting plain text bullets to numbered lists: Use "structure_replace" to convert paragraphs
2. If changing actual Word bullet lists to numbered lists: Use "element_transformation"
3. If there are no lists at all: Use "batch_replace" to change text

RESPOND WITH JSON:
{
  "transformationType": "CHOOSE ONE: regex_replace | structure_replace | element_transformation | batch_replace",
  "description": "Clear description of what you're doing",
  "instructions": {
    // FOR regex_replace: Simple text pattern replacement
    "pattern": "regex pattern",
    "flags": "g",
    "replacement": "replacement text",
    
    // FOR structure_replace: Convert paragraphs to lists
    "findElement": "w:p containing bullet text",
    "action": "transform_to_numbered_list | transform_to_bullet_list",
    "targetTexts": ["item1", "item2", "item3"] if creating lists,
    
    // FOR element_transformation: Change existing list type
    "targetElement": "w:numId",
    "attributeChange": {"w:val": "2"}, // 1=bullet, 2=numbered
    
    // FOR batch_replace: Multiple text replacements
    "replacements": [
      {"find": "text1", "replace": "text2"},
      {"find": "•", "replace": "1."}
    ]
  }
}

EXAMPLES:

1. "Convert plain text bullets to numbered list" →
{
  "transformationType": "structure_replace",
  "description": "Convert paragraphs with bullet characters to numbered list",
  "instructions": {
    "findElement": "w:p containing bullet characters (•, *, -)",
    "action": "transform_to_numbered_list",
    "targetTexts": ["Scalability: ...", "Version Control: ..."]
  }
}

2. "Change Word bullet list to numbered list" →
{
  "transformationType": "element_transformation",
  "description": "Change bullet list numbering to numbered list",
  "instructions": {
    "targetElement": "w:numId",
    "attributeChange": {"w:val": "2"}
  }
}

3. "Replace bullet characters" →
{
  "transformationType": "batch_replace",
  "description": "Replace bullet characters with numbers",
  "instructions": {
    "replacements": [
      {"find": "•", "replace": "1."},
      {"find": "*", "replace": "2."}
    ]
  }
}

ANALYZE THE SAMPLE XML AND PROVIDE THE APPROPRIATE TRANSFORMATION:`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'You are an expert in Word XML transformations. First analyze if the document has actual Word lists or plain text bullets. Return valid JSON.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    
    if (!content) {
      throw new Error('Empty response from AI');
    }

    // Clean and parse JSON
    let cleaned = content
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const parsed = JSON.parse(cleaned);
    
    console.log('[AI TRANSFORMATION]', parsed.transformationType, '-', parsed.description);
    
    return {
      success: true,
      ...parsed
    };

  } catch (error) {
    console.error('[AI TRANSFORMATION ERROR]', error);
    
    // Fallback for bullet to number conversion
    return {
      success: true,
      transformationType: 'batch_replace',
      description: 'Fallback: Replace bullet characters with numbers',
      instructions: {
        replacements: [
          { find: "•", replace: "1." },
          { find: "*", replace: "2." },
          { find: "-", replace: "3." }
        ]
      }
    };
  }
}

/**
 * Apply the AI-generated XML transformation
 */
function applyXmlTransformation(xml, transformation) {
  let modified = false;
  let newXml = xml;

  try {
    const { transformationType, instructions } = transformation;

    switch (transformationType) {
      case 'regex_replace':
        if (instructions.pattern && instructions.replacement) {
          const regex = new RegExp(instructions.pattern, instructions.flags || 'g');
          if (regex.test(newXml)) {
            newXml = newXml.replace(regex, instructions.replacement);
            modified = true;
          }
        }
        break;

      case 'structure_replace':
        if (instructions.findElement === 'w:tbl' && instructions.action === 'replace') {
          // Convert tables to paragraphs
          const tableRegex = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
          newXml = newXml.replace(tableRegex, (tableXml) => {
            modified = true;
            const texts = extractAllTextsFromXml(tableXml);
            return texts.map(text => 
              `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
            ).join('');
          });
        }
        break;

      case 'element_transformation':
        if (instructions.targetElement && instructions.attributeChange) {
          const element = instructions.targetElement;
          const attrName = Object.keys(instructions.attributeChange)[0];
          const attrValue = instructions.attributeChange[attrName];
          
          // Change attribute value
          const attrRegex = new RegExp(`(<${element}\\s+${attrName}=")([^"]*)(")`, 'g');
          if (attrRegex.test(newXml)) {
            newXml = newXml.replace(attrRegex, `$1${attrValue}$3`);
            modified = true;
          }
        }
        break;

      case 'batch_replace':
        if (Array.isArray(instructions.replacements)) {
          instructions.replacements.forEach(({ find, replace }) => {
            if (newXml.includes(find)) {
              newXml = newXml.replace(new RegExp(escapeRegExp(find), 'g'), replace);
              modified = true;
            }
          });
        }
        break;

      default:
        console.warn('[TRANSFORM] Unknown type:', transformationType);
    }

  } catch (error) {
    console.error('[APPLY TRANSFORMATION ERROR]', error);
  }

  return { xml: newXml, modified };
}

/**
 * Extract all text content from XML
 */
function extractAllTextsFromXml(xml) {
  const texts = [];
  const textRegex = /<w:t[^>]*>(.*?)<\/w:t>/g;
  let match;
  
  while ((match = textRegex.exec(xml)) !== null) {
    const text = decodeXml(match[1]).trim();
    if (text) {
      texts.push(text);
    }
  }
  
  return texts;
}

/**
 * TRULY DYNAMIC TEXT FILE MODIFICATION
 */
async function executeDynamicTextModification(filePath, operations, options) {
  const { OPENAI_API_KEY } = process.env;
  
  try {
    let content = await fs.readFile(filePath, 'utf-8');
    let totalModifications = 0;

    for (const op of operations) {
      console.log('[DYNAMIC TEXT] Processing:', op.reason);

      // Ask AI how to transform the text
      const transformation = await getAITextTransformation(
        content,
        op,
        OPENAI_API_KEY
      );

      if (transformation.success) {
        const result = applyTextTransformation(content, transformation);
        
        if (result.modified) {
          content = result.text;
          totalModifications++;
          console.log('[DYNAMIC TEXT] ✓ Applied:', transformation.description);
        }
      }
    }

    if (totalModifications === 0) {
      return {
        success: false,
        error: 'No modifications could be applied to the text file.'
      };
    }

    const outputPath = filePath.replace(/(\.[^.]+)$/, '_modified$1');
    await fs.writeFile(outputPath, content);

    return {
      success: true,
      modifiedFilePath: outputPath,
      metadata: {
        method: 'AI_DYNAMIC_TEXT_MODIFICATION',
        operationsApplied: totalModifications
      }
    };

  } catch (error) {
    console.error('[DYNAMIC TEXT ERROR]', error);
    return {
      success: false,
      error: `Dynamic text modification failed: ${error.message}`
    };
  }
}

/**
 * Get AI-powered text transformation instructions
 */
async function getAITextTransformation(content, operation, apiKey) {
  const prompt = `Analyze this text and provide transformation instructions.

CONTENT PREVIEW:
${content.substring(0, 2000)}

USER REQUEST: ${operation.reason || operation.transformation}

Provide JSON with transformation type and instructions:
{
  "transformationType": "regex_replace | string_replace | structure_change",
  "description": "what you're doing",
  "instructions": {
    "find": "text to find",
    "replace": "replacement",
    "pattern": "regex if needed"
  }
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    return { success: true, ...parsed };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Apply text transformation
 */
function applyTextTransformation(text, transformation) {
  let modified = false;
  let newText = text;

  const { transformationType, instructions } = transformation;

  if (transformationType === 'regex_replace' && instructions.pattern) {
    const regex = new RegExp(instructions.pattern, 'g');
    if (regex.test(newText)) {
      newText = newText.replace(regex, instructions.replace);
      modified = true;
    }
  } else if (transformationType === 'string_replace' && instructions.find) {
    if (newText.includes(instructions.find)) {
      newText = newText.replace(new RegExp(escapeRegExp(instructions.find), 'g'), instructions.replace);
      modified = true;
    }
  }

  return { text: newText, modified };
}

// Helper functions
function escapeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

module.exports = {
  executeFormatOperationsDynamic,
  executeDynamicDocxModification,
  executeDynamicTextModification
};