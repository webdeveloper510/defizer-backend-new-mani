
function detectExportIntent(message = '') {
  if (!message) return { 
    // A. Core Office Formats
    pdf: false, 
    word: false,
    doc: false,
    docx: false,
    excel: false,
    xls: false,
    xlsx: false,
    csv: false,
    ppt: false,
    pptx: false,
    
    // B. Text and Simple Docs
    txt: false,
    rtf: false,
    
    // C. Web and Markup
    html: false,
    htm: false,
    xml: false,
    
    // D. Markdown
    markdown: false,
    md: false,
    
    // E. Other Spreadsheets
    tsv: false,
    ods: false,
    
    // F. Other Office Suites
    odt: false,
    odp: false,
    
    // G. Calendars / Contacts
    ics: false,
    vcf: false,
    vcard: false,
    
    // H. Email / Archive
    eml: false,
    msg: false,
    mbox: false,
    
    // I. Compressed
    zip: false,
    rar: false,
    '7z': false,
    targz: false,
    
    // J. Media
    mp4: false,
    mp3: false,
    wav: false,
    gif: false,
    jpg: false,
    jpeg: false,
    png: false,
    bmp: false,
    tiff: false,
        mdb: false,
    accdb: false,
    
    generic: false 
  };

  const msg = message.toLowerCase();  
  const pdfType = /\b(pdf|\.pdf)\b/;
  const pdfPhrase = /(in|as|into|to|on|as a|as an)\s+pdf\b/;
  
  const wordType = /\b(word|docx?|ms\s*word|document|documnet|documnt)\b/;
  const wordPhrase = /(in|as|into|to|on|as a|as an)\s+(word|docx?|ms\s*word|document)\b/;
  const docType = /\b(\.doc|doc\s+file)\b/;
  const docxType = /\b(\.docx|docx\s+file)\b/;
  
  const excelType = /\b(excel|xlsx?|xls\s+file|xlsx\s+file|spreadsheet)\b/;
  const excelPhrase = /(in|as|into|to|on|as a|as an)\s+(excel|xlsx?|spreadsheet)\b/;
  const xlsType = /\b(\.xls|xls\s+file)\b/;
  const xlsxType = /\b(\.xlsx|xlsx\s+file)\b/;
  
  const csvType = /\b(csv|\.csv|comma[- ]separated|comma\s+separated\s+values?)\b/;
  const csvPhrase = /(in|as|into|to|on|as a|as an)\s+(csv|comma[- ]separated)\b/;
  
  const pptType = /\b(powerpoint|ppt|\.ppt|ppt\s+file|presentation)\b/;
  const pptPhrase = /(in|as|into|to|on|as a|as an)\s+(powerpoint|ppt|presentation)\b/;
  const pptxType = /\b(pptx|\.pptx|pptx\s+file)\b/;
  const pptxPhrase = /(in|as|into|to|on|as a|as an)\s+pptx\b/;
  
  const txtType = /\b(txt|\.txt|text\s+file|plain\s+text)\b/;
  const txtPhrase = /(in|as|into|to|on|as a|as an)\s+(txt|text\s+file|plain\s+text)\b/;
  
  const rtfType = /\b(rtf|\.rtf|rich\s+text)\b/;
  const rtfPhrase = /(in|as|into|to|on|as a|as an)\s+(rtf|rich\s+text)\b/;
  
  const htmlType = /\b(html?|\.html?|web\s*page|webpage)\b/;
  const htmlPhrase = /(in|as|into|to|on|as a|as an)\s+(html?|web\s*page)\b/;
  const htmType = /\b(\.htm|htm\s+file)\b/;
  
  const xmlType = /\b(xml|\.xml)\b/;
  const xmlPhrase = /(in|as|into|to|on|as a|as an)\s+xml\b/;
  
  const markdownType = /\b(markdown|\.md|md\s+file)\b/;
  const markdownPhrase = /(in|as|into|to|on|as a|as an)\s+(markdown|md)\b/;
  const mdType = /\b(\.md|md\s+file)\b/;
  
  const tsvType = /\b(tsv|\.tsv|tab[- ]separated|tab\s+separated\s+values?)\b/;
  const tsvPhrase = /(in|as|into|to|on|as a|as an)\s+(tsv|tab[- ]separated)\b/;
  
  const odsType = /\b(ods|\.ods|opendocument\s+spreadsheet|libreoffice\s+spreadsheet)\b/;
  const odsPhrase = /(in|as|into|to|on|as a|as an)\s+(ods|opendocument\s+spreadsheet)\b/;
  
  const odtType = /\b(odt|\.odt|opendocument\s+text|libreoffice\s+document)\b/;
  const odtPhrase = /(in|as|into|to|on|as a|as an)\s+(odt|opendocument\s+text)\b/;
  
  const odpType = /\b(odp|\.odp|opendocument\s+presentation|libreoffice\s+presentation)\b/;
  const odpPhrase = /(in|as|into|to|on|as a|as an)\s+(odp|opendocument\s+presentation)\b/;
  
  const icsType = /\b(ics|\.ics|icalendar|calendar\s+file)\b/;
  const icsPhrase = /(in|as|into|to|on|as a|as an)\s+(ics|icalendar|calendar\s+file)\b/;
  
  const vcfType = /\b(vcf|vcard|\.vcf|contact\s+file|contacts?\s+file)\b/;
  const vcfPhrase = /(in|as|into|to|on|as a|as an)\s+(vcf|vcard|contact\s+file)\b/;
  
  const emlType = /\b(eml|\.eml|email\s+file|outlook\s+message)\b/;
  const emlPhrase = /(in|as|into|to|on|as a|as an)\s+(eml|email\s+file)\b/;
  
  const msgType = /\b(msg|\.msg|outlook\s+msg)\b/;
  const msgPhrase = /(in|as|into|to|on|as a|as an)\s+(msg|outlook\s+message)\b/;
  
  const mboxType = /\b(mbox|\.mbox|mailbox\s+file)\b/;
  const mboxPhrase = /(in|as|into|to|on|as a|as an)\s+(mbox|mailbox)\b/;
  
  const zipType = /\b(zip|\.zip|zipped|zip\s+archive)\b/;
  const zipPhrase = /(in|as|into|to|on|as a|as an)\s+(zip|zip\s+archive)\b/;
  
  const rarType = /\b(rar|\.rar|rar\s+archive)\b/;
  const rarPhrase = /(in|as|into|to|on|as a|as an)\s+(rar|rar\s+archive)\b/;
  
  const sevenZType = /\b(7z|\.7z|seven\s*z|7zip)\b/;
  const sevenZPhrase = /(in|as|into|to|on|as a|as an)\s+(7z|seven\s*z)\b/;
  
  const targzType = /\b(tar\.gz|\.tar\.gz|targz|tgz|\.tgz|tar\s+gz)\b/;
  const targzPhrase = /(in|as|into|to|on|as a|as an)\s+(tar\.gz|targz)\b/;
  
  const mp4Type = /\b(mp4|\.mp4|video\s+file)\b/;
  const mp4Phrase = /(in|as|into|to|on|as a|as an)\s+(mp4|video)\b/;
  
  const mp3Type = /\b(mp3|\.mp3|audio\s+file)\b/;
  const mp3Phrase = /(in|as|into|to|on|as a|as an)\s+(mp3|audio)\b/;
  
  const wavType = /\b(wav|\.wav|wave\s+audio)\b/;
  const wavPhrase = /(in|as|into|to|on|as a|as an)\s+(wav|wave)\b/;
  
  const gifType = /\b(gif|\.gif|animated\s+gif)\b/;
  const gifPhrase = /(in|as|into|to|on|as a|as an)\s+gif\b/;
  
  const jpgType = /\b(jpg|jpeg|\.jpg|\.jpeg)\b/;
  const jpgPhrase = /(in|as|into|to|on|as a|as an)\s+(jpg|jpeg)\b/;
  
  const pngType = /\b(png|\.png)\b/;
  const pngPhrase = /(in|as|into|to|on|as a|as an)\s+png\b/;
  
  const bmpType = /\b(bmp|\.bmp|bitmap)\b/;
  const bmpPhrase = /(in|as|into|to|on|as a|as an)\s+(bmp|bitmap)\b/;
  
  const tiffType = /\b(tiff?|\.tiff?)\b/;
  const tiffPhrase = /(in|as|into|to|on|as a|as an)\s+tiff?\b/;

  // ========== NEW: DATABASE FORMATS ==========
  
  const mdbType = /\b(mdb|\.mdb|access\s+database|ms\s+access)\b/;
  const mdbPhrase = /(in|as|into|to|on|as a|as an)\s+(mdb|access\s+database|ms\s+access)\b/;
  
  const accdbType = /\b(accdb|\.accdb|access\s+2007|access\s+2010|access\s+2013|access\s+2016)\b/;
  const accdbPhrase = /(in|as|into|to|on|as a|as an)\s+(accdb|access\s+2007)\b/;

  const exportVerbs = /(export|download|save|generate|create|deliver|send|prepare|produce|turn|make|give|get|provide|output|issue|write|print)\b/;
  const genericExport = /(report|summary|print\s?out|copy of this|copy of|send me|deliver|can i have|give me a copy|get a file|get this file|get a version|file version|downloadable|output this)\b/;

  // ========== DETECTION LOGIC ==========
  // Add MDB and ACCDB early in the priority chain (before CSV)
  
  const mdb = (mdbType.test(msg) || mdbPhrase.test(msg));
  const accdb = (accdbType.test(msg) || accdbPhrase.test(msg)) && !mdb;
  const csv = (csvType.test(msg) || csvPhrase.test(msg)) && !mdb && !accdb;
  const tsv = (tsvType.test(msg) || tsvPhrase.test(msg)) && !mdb && !accdb && !csv;
  const docx = (docxType.test(msg)) && !mdb && !accdb && !csv && !tsv;
  const doc = (docType.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx;
  const xlsx = (xlsxType.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc;
  const xls = (xlsType.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx;
  const pptx = (pptxType.test(msg) || pptxPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls;
  const ppt = (pptType.test(msg) || pptPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx;
  const word = (wordType.test(msg) || wordPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt;
  const excel = (excelType.test(msg) || excelPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word;
  const rtf = (rtfType.test(msg) || rtfPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel;
  const pdf = (pdfType.test(msg) || pdfPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf;
  const htm = (htmType.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf;
  const html = (htmlType.test(msg) || htmlPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm;
  const xml = (xmlType.test(msg) || xmlPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html;
  const md = (mdType.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml;
  const markdown = (markdownType.test(msg) || markdownPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md;
  const txt = (txtType.test(msg) || txtPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown;
  const ods = (odsType.test(msg) || odsPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt;
  const odt = (odtType.test(msg) || odtPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods;
  const odp = (odpType.test(msg) || odpPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt;
  const ics = (icsType.test(msg) || icsPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp;
  const vcf = (vcfType.test(msg) || vcfPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics;
  const vcard = vcf;
  const eml = (emlType.test(msg) || emlPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf;
  const msg_format = (msgType.test(msg) || msgPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml;
  const mbox = (mboxType.test(msg) || mboxPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format;
  const zip = (zipType.test(msg) || zipPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox;
  const rar = (rarType.test(msg) || rarPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip;
  const sevenZ = (sevenZType.test(msg) || sevenZPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar;
  const targz = (targzType.test(msg) || targzPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar && !sevenZ;
  const mp4 = (mp4Type.test(msg) || mp4Phrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar && !sevenZ && !targz;
  const mp3 = (mp3Type.test(msg) || mp3Phrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar && !sevenZ && !targz && !mp4;
  const wav = (wavType.test(msg) || wavPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar && !sevenZ && !targz && !mp4 && !mp3;
  const gif = (gifType.test(msg) || gifPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar && !sevenZ && !targz && !mp4 && !mp3 && !wav;
  const jpg = (jpgType.test(msg) || jpgPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar && !sevenZ && !targz && !mp4 && !mp3 && !wav && !gif;
  const jpeg = jpg;
  const png = (pngType.test(msg) || pngPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar && !sevenZ && !targz && !mp4 && !mp3 && !wav && !gif && !jpg;
  const bmp = (bmpType.test(msg) || bmpPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar && !sevenZ && !targz && !mp4 && !mp3 && !wav && !gif && !jpg && !png;
  const tiff = (tiffType.test(msg) || tiffPhrase.test(msg)) && !mdb && !accdb && !csv && !tsv && !docx && !doc && !xlsx && !xls && !pptx && !ppt && !word && !excel && !rtf && !pdf && !htm && !html && !xml && !md && !markdown && !txt && !ods && !odt && !odp && !ics && !vcf && !eml && !msg_format && !mbox && !zip && !rar && !sevenZ && !targz && !mp4 && !mp3 && !wav && !gif && !jpg && !png && !bmp;
  
  const generic = (exportVerbs.test(msg) || genericExport.test(msg)) && 
                  !(pdf || word || doc || docx || excel || xls || xlsx || csv || tsv || ppt || pptx || 
                    rtf || txt || html || htm || xml || markdown || md || 
                    ods || odt || odp || ics || vcf || eml || msg_format || mbox || 
                    zip || rar || sevenZ || targz || 
                    mp4 || mp3 || wav || gif || jpg || png || bmp || tiff ||
                    mdb || accdb);

  return { 
    pdf, word, doc, docx, excel, xls, xlsx, csv, ppt, pptx,
    txt, rtf,
    html, htm, xml,
    markdown, md,
    tsv, ods,
    odt, odp,
    ics, vcf, vcard,
    eml, msg: msg_format, mbox,
    zip, rar, '7z': sevenZ, targz,
    mp4, mp3, wav, gif, jpg, jpeg, png, bmp, tiff,
    mdb, accdb,
    generic 
  };
}

module.exports = {
  detectExportIntent,
};