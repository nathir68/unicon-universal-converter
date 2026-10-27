const { PDFDocument, PDFName, PDFRawStream } = require('pdf-lib');
const sharp = require('sharp');
const fs = require('fs');

async function compressPdfImages(pdfBuffer, quality = 50) {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const context = doc.context;
  let compressedCount = 0;

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const dict = obj.dict;
      const subtype = dict.get(PDFName.of('Subtype'));
      if (subtype && subtype.toString() === '/Image') {
        const filter = dict.get(PDFName.of('Filter'));
        const filterStr = filter ? filter.toString() : '';

        try {
          if (filterStr === '/DCTDecode') {
            // It's a JPEG!
            const compressedJpg = await sharp(obj.contents)
              .jpeg({ quality, mozjpeg: true })
              .toBuffer();
            if (compressedJpg.length < obj.contents.length) {
              obj.contents = compressedJpg;
              dict.set(PDFName.of('Length'), context.obj(compressedJpg.length));
              compressedCount++;
            }
          } else if (filterStr === '/FlateDecode') {
            // It might be a PNG/lossless raw image or flate stream
            // Try reading with sharp
            try {
              const compressedJpg = await sharp(obj.contents)
                .jpeg({ quality })
                .toBuffer();
              if (compressedJpg.length < obj.contents.length) {
                obj.contents = compressedJpg;
                dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
                dict.set(PDFName.of('Length'), context.obj(compressedJpg.length));
                // Remove decode params if any
                dict.delete(PDFName.of('DecodeParms'));
                compressedCount++;
              }
            } catch {}
          }
        } catch (e) {
          // If sharp cannot parse this specific stream, leave it intact
        }
      }
    }
  }

  const saved = await doc.save({ useObjectStreams: true });
  return { buffer: saved, compressedCount };
}

module.exports = { compressPdfImages };
