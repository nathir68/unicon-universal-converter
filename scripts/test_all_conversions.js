const fs = require('fs');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp');

async function runAllTests() {
  const results = [];

  async function test(name, fileBlob, filename, targetFormat, action = 'convert') {
    const form = new FormData();
    form.append('file', fileBlob, filename);
    form.append('targetFormat', targetFormat);
    form.append('action', action);

    try {
      const start = Date.now();
      const res = await fetch('http://localhost:3000/api/convert', { method: 'POST', body: form });
      const json = await res.json();
      const duration = Date.now() - start;

      if (json.success && (json.downloadDataUrl || json.downloadUrl)) {
        results.push({ name, status: 'PASS', duration: duration + 'ms', size: json.convertedSize });
      } else {
        results.push({ name, status: 'FAIL', error: json.error });
      }
    } catch (e) {
      results.push({ name, status: 'ERROR', error: e.message });
    }
  }

  // 1. Prepare sample files
  // PNG Image (100x100 blue square)
  const pngBuffer = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 50, g: 100, b: 220, alpha: 1 } }
  }).png().toBuffer();
  const pngBlob = new Blob([pngBuffer], { type: 'image/png' });

  // JPG Image
  const jpgBuffer = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 220, g: 80, b: 50 } }
  }).jpeg().toBuffer();
  const jpgBlob = new Blob([jpgBuffer], { type: 'image/jpeg' });

  // PDF Document
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([400, 400]);
  page.drawText('Sample UniCon PDF Test Document');
  const pdfBuffer = await pdfDoc.save();
  const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });

  // DOCX Document
  const docxObj = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          children: [new TextRun({ text: 'Sample UniCon DOCX Document for Verification', bold: true })]
        })
      ]
    }]
  });
  const docxBuffer = await Packer.toBuffer(docxObj);
  const docxBlob = new Blob([docxBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });

  // TXT Document
  const txtBlob = new Blob(['Sample plain text content for testing UniCon document conversion.'], { type: 'text/plain' });

  // HTML Document
  const htmlBlob = new Blob(['<!DOCTYPE html><html><body><h1>Sample HTML Document</h1><p>Testing conversion to PDF.</p></body></html>'], { type: 'text/html' });

  // WAV Audio (1 second 44.1kHz mono sine/silent tone)
  const sampleRate = 44100;
  const numSamples = 44100;
  const wavBuffer = Buffer.alloc(44 + numSamples * 2);
  wavBuffer.write('RIFF', 0);
  wavBuffer.writeUInt32LE(36 + numSamples * 2, 4);
  wavBuffer.write('WAVE', 8);
  wavBuffer.write('fmt ', 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20); // PCM
  wavBuffer.writeUInt16LE(1, 22); // mono
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(sampleRate * 2, 28);
  wavBuffer.writeUInt16LE(2, 32);
  wavBuffer.writeUInt16LE(16, 34);
  wavBuffer.write('data', 36);
  wavBuffer.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 16000);
    wavBuffer.writeInt16LE(sample, 44 + i * 2);
  }
  const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

  console.log('Running test suite for all conversions...');

  // Run tests sequentially
  await test('PNG -> JPG', pngBlob, 'image.png', 'jpg');
  await test('JPG -> PNG', jpgBlob, 'image.jpg', 'png');
  await test('PNG -> WEBP', pngBlob, 'image.png', 'webp');
  await test('PNG -> PDF', pngBlob, 'image.png', 'pdf');
  await test('Image Compress', pngBlob, 'image.png', 'png', 'compress');
  await test('PDF -> DOCX', pdfBlob, 'test.pdf', 'docx');
  await test('PDF -> TXT', pdfBlob, 'test.pdf', 'txt');
  await test('PDF -> HTML', pdfBlob, 'test.pdf', 'html');
  await test('PDF Compress', pdfBlob, 'test.pdf', 'pdf', 'compress');
  await test('DOCX -> PDF', docxBlob, 'doc.docx', 'pdf');
  await test('DOCX -> TXT', docxBlob, 'doc.docx', 'txt');
  await test('DOCX -> HTML', docxBlob, 'doc.docx', 'html');
  await test('TXT -> PDF', txtBlob, 'note.txt', 'pdf');
  await test('TXT -> DOCX', txtBlob, 'note.txt', 'docx');
  await test('HTML -> PDF', htmlBlob, 'page.html', 'pdf');
  await test('WAV -> MP3', wavBlob, 'audio.wav', 'mp3');
  await test('Audio Compress', wavBlob, 'audio.wav', 'mp3', 'compress');

  console.table(results);
  const allPassed = results.every(r => r.status === 'PASS');
  console.log('FINAL RESULT:', allPassed ? 'ALL CONVERSIONS PASSED!' : 'SOME FAILED');
}

runAllTests();
