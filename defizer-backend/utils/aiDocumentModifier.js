// utils/aiDocumentModifier.js - FIXED VERSION

const fs = require('fs').promises;
const path = require('path');
const { aiReadDocumentAndGenerateHTML, aiModifyHTML } = require('./aiDocumentReader');
const { convertHTMLToFormat } = require('./htmlConverter');

async function modifyDocumentViaAIHTML(options) {
  const {
    originalFilePath,
    originalFormat,
    originalFileName,
    userRequest,
    sessionId,
    OPENAI_API_KEY 
  } = options;

  console.log('[AI PIPELINE - SIMPLE] Starting', {
    file: originalFileName,
    format: originalFormat,
    request: userRequest.slice(0, 100)
  });

  try {
    // ===== STEP 1: AI READS DOCUMENT AND GENERATES HTML =====
    console.log('[STEP 1] AI reading document directly and generating HTML...');
    
    const generatedHTML = await aiReadDocumentAndGenerateHTML(
      originalFilePath,
      originalFormat,
      userRequest,
      OPENAI_API_KEY  
    );
    
    console.log('[STEP 1] ✓ HTML generated:', generatedHTML.length, 'chars');
    
    // Save for debugging
    const htmlPath = originalFilePath.replace(/\.[^.]+$/, '_ai_generated.html');
    await fs.writeFile(htmlPath, generatedHTML);

    // ===== STEP 2: CONVERT HTML TO ORIGINAL FORMAT =====
    console.log('[STEP 2] Converting HTML to', originalFormat);
    
    const outputPath = originalFilePath.replace(/(\.[^.]+)$/, '_modified$1');
    await convertHTMLToFormat(generatedHTML, originalFormat, outputPath);
    
    console.log('[STEP 2] ✓ File created:', outputPath);

    try {
      await fs.unlink(htmlPath);
    } catch (e) {}

    return {
      success: true,
      modifiedFilePath: outputPath,
      originalFormat: originalFormat,
      method: 'ai-direct-read'
    };

  } catch (error) {
    console.error('[AI PIPELINE ERROR]', error);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  modifyDocumentViaAIHTML
};