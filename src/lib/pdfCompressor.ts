import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';

export interface CompressPdfResult {
  buffer: Uint8Array;
  compressedCount: number;
}

export async function compressPdfImages(
  pdfBuffer: Buffer | Uint8Array,
  quality: number = 50
): Promise<CompressPdfResult> {
  const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const context = doc.context;
  let compressedCount = 0;

  for (const [, obj] of context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const dict = obj.dict;
      const subtype = dict.get(PDFName.of('Subtype'));
      if (subtype && subtype.toString() === '/Image') {
        const filter = dict.get(PDFName.of('Filter'));
        const filterStr = filter ? filter.toString() : '';

        try {
          if (filterStr === '/DCTDecode') {
            // It's a JPEG!
            const compressedJpg = await sharp(Buffer.from(obj.contents))
              .jpeg({ quality, mozjpeg: true })
              .toBuffer();
            if (compressedJpg.length < obj.contents.length) {
              (obj as unknown as { contents: Uint8Array }).contents = new Uint8Array(compressedJpg);
              dict.set(PDFName.of('Length'), context.obj(compressedJpg.length));
              compressedCount++;
            }
          } else if (filterStr === '/FlateDecode') {
            // It might be a PNG/lossless raw image or flate stream
            try {
              const compressedJpg = await sharp(Buffer.from(obj.contents))
                .jpeg({ quality })
                .toBuffer();
              if (compressedJpg.length < obj.contents.length) {
                (obj as unknown as { contents: Uint8Array }).contents = new Uint8Array(compressedJpg);
                dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
                dict.set(PDFName.of('Length'), context.obj(compressedJpg.length));
                // Remove decode params if any
                dict.delete(PDFName.of('DecodeParms'));
                compressedCount++;
              }
            } catch {
              // Ignore unsupported flate streams
            }
          }
        } catch {
          // If sharp cannot parse this specific stream, leave it intact
        }
      }
    }
  }

  const saved = await doc.save({ useObjectStreams: true });
  return { buffer: saved, compressedCount };
}
