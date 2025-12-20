// utils/aiDocumentModifier.js - NEW FILE

const fs = require('fs').promises;
const path = require('path');
const { generateHTMLFromContent, modifyHTMLWithAI, analyzeDocumentStructure } = require('./aiHtmlGenerator');
const { convertHTMLToFormat } = require('./htmlConverter');

/**
 * MAIN FUNCTION: AI-Powered HTML Pipeline
 * This is what your TL wants implemented
 */
async function modifyDocumentViaAIHTML(options) {
  const {
    extractedText,
    originalFilePath,
    originalFormat,
    originalFileName,
    userRequest,
    sessionId
  } = options;

  console.log('[AI HTML PIPELINE] Starting modification', {
    format: originalFormat,
    textLength: extractedText.length,
    request: userRequest.slice(0, 100)
  });

  try {
    // STEP 1: Analyze document structure
    const metadata = analyzeDocumentStructure(extractedText);
    console.log('[AI HTML PIPELINE] Document analysis:', metadata);

    // STEP 2: AI generates HTML from extracted content
    console.log('[AI HTML PIPELINE] AI generating HTML from content...');
    const generatedHTML = await generateHTMLFromContent(
      extractedText,
      originalFormat,
      metadata
    );
    
    // Save intermediate HTML for debugging (optional)
    const htmlDebugPath = originalFilePath.replace(/\.[^.]+$/, '_generated.html');
    await fs.writeFile(htmlDebugPath, generatedHTML);
    console.log('[AI HTML PIPELINE] Generated HTML saved:', htmlDebugPath);

    // STEP 3: AI modifies the HTML based on user request
    console.log('[AI HTML PIPELINE] AI modifying HTML based on request...');
    const modifiedHTML = await modifyHTMLWithAI(generatedHTML, userRequest);
    
    // Save modified HTML for debugging (optional)
    const modifiedHtmlPath = originalFilePath.replace(/\.[^.]+$/, '_modified.html');
    await fs.writeFile(modifiedHtmlPath, modifiedHTML);
    console.log('[AI HTML PIPELINE] Modified HTML saved:', modifiedHtmlPath);

    // STEP 4: Convert modified HTML back to original format
    console.log('[AI HTML PIPELINE] Converting HTML to', originalFormat);
    const outputPath = originalFilePath.replace(/(\.[^.]+)$/, '_final_modified$1');
    
    await convertHTMLToFormat(modifiedHTML, originalFormat, outputPath);

    console.log('[AI HTML PIPELINE] Final file created:', outputPath);

    // Cleanup temporary HTML files (optional)
    try {
      await fs.unlink(htmlDebugPath);
      await fs.unlink(modifiedHtmlPath);
    } catch (e) {
      console.log('[AI HTML PIPELINE] Cleanup warning:', e.message);
    }

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: originalFormat,
      method: 'ai-html-pipeline',
      metadata: {
        aiGenerated: true,
        htmlIntermediate: true,
        stepsCompleted: ['extract', 'ai-html-gen', 'ai-modify', 'convert']
      }
    };

  } catch (error) {
    console.error('[AI HTML PIPELINE ERROR]', error);
    return {
      success: false,
      error: error.message,
      method: 'ai-html-pipeline'
    };
  }
}

module.exports = {
  modifyDocumentViaAIHTML
};