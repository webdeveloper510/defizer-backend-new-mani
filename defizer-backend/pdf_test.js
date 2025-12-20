const PDFDocument = require('pdfkit');
const fs = require('fs');
const doc = new PDFDocument();
const stream = fs.createWriteStream('./uploads/test_file.pdf');

doc.pipe(stream);
doc.font('Times-Roman').fontSize(14).text('Hello, test!', { align: 'left' });
doc.end();

stream.on('finish', () => { console.log('PDF written!'); });
stream.on('error', (e) => { console.error('PDF error:', e); });
