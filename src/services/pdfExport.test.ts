import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib';
import type { PageAnnotations } from '../types';
import {
  EncryptedPdfError,
  exportAnnotatedPdf,
  getPageMetrics,
  mapVisualNormToPdfPoint,
  MAX_PDF_BYTES,
} from './pdfExport';

function extractContentStreamStrings(pdfDoc: PDFDocument, pageIndex: number): string {
  const page = pdfDoc.getPages()[pageIndex];
  const contents = page.node.Contents();
  if (!contents) return '';
  const decoder = new TextDecoder('latin1');
  const decodeStream = (stream: unknown): string => {
    if (stream instanceof PDFRawStream) {
      return decoder.decode(decodePDFRawStream(stream).decode());
    }
    if (stream && typeof stream === 'object' && 'contents' in stream && stream.contents instanceof Uint8Array) {
      return decoder.decode(stream.contents);
    }
    return '';
  };

  if ('asArray' in contents && typeof contents.asArray === 'function') {
    return contents
      .asArray()
      .map((ref) => decodeStream(pdfDoc.context.lookup(ref)))
      .join('\n');
  }
  return decodeStream(contents);
}

describe('pdfExport coordinate rotation & encryption handling', () => {
  it('maps visual normalized coordinates accurately across 0, 90, 180, and 270 degree rotations', async () => {
    const doc = await PDFDocument.create();
    const p0 = doc.addPage([200, 400]);
    p0.setRotation(degrees(0));
    const p90 = doc.addPage([200, 400]);
    p90.setRotation(degrees(90));
    const p180 = doc.addPage([200, 400]);
    p180.setRotation(degrees(180));
    const p270 = doc.addPage([200, 400]);
    p270.setRotation(degrees(270));

    const m0 = getPageMetrics(p0);
    expect(m0.pageW).toBe(200);
    expect(m0.pageH).toBe(400);
    expect(mapVisualNormToPdfPoint({ x: 0.25, y: 0.1 }, m0)).toEqual({ x: 50, y: 360 });

    const m90 = getPageMetrics(p90);
    expect(m90.pageW).toBe(400);
    expect(m90.pageH).toBe(200);
    expect(mapVisualNormToPdfPoint({ x: 0, y: 0 }, m90)).toEqual({ x: 0, y: 0 });
    expect(mapVisualNormToPdfPoint({ x: 1, y: 0 }, m90)).toEqual({ x: 0, y: 400 });
    expect(mapVisualNormToPdfPoint({ x: 0.25, y: 0.1 }, m90)).toEqual({ x: 20, y: 100 });

    const m180 = getPageMetrics(p180);
    expect(m180.pageW).toBe(200);
    expect(m180.pageH).toBe(400);
    expect(mapVisualNormToPdfPoint({ x: 0, y: 0 }, m180)).toEqual({ x: 200, y: 0 });
    expect(mapVisualNormToPdfPoint({ x: 0.25, y: 0.1 }, m180)).toEqual({ x: 150, y: 40 });

    const m270 = getPageMetrics(p270);
    expect(m270.pageW).toBe(400);
    expect(m270.pageH).toBe(200);
    expect(mapVisualNormToPdfPoint({ x: 0, y: 0 }, m270)).toEqual({ x: 200, y: 400 });
    expect(mapVisualNormToPdfPoint({ x: 1, y: 0 }, m270)).toEqual({ x: 200, y: 0 });
    expect(mapVisualNormToPdfPoint({ x: 0.25, y: 0.1 }, m270)).toEqual({ x: 180, y: 300 });
  });

  it('bakes annotations onto 90, 180, and 270 degree rotated PDF pages using matching CTM transforms', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 400]).setRotation(degrees(90));
    doc.addPage([200, 400]).setRotation(degrees(180));
    doc.addPage([200, 400]).setRotation(degrees(270));
    const originalBytes = await doc.save();

    const makePageAnn = (pageNum: number): PageAnnotations => ({
      scoreId: 's1',
      pageNum,
      layers: [{ id: 'default', name: 'Anteckningar', visible: true }],
      items: [
        {
          kind: 'shape',
          id: `line-${pageNum}`,
          layerId: 'default',
          shapeType: 'line',
          start: { x: 0.1, y: 0.2 },
          end: { x: 0.8, y: 0.2 },
          color: '#d64545',
          width: 0.005,
        },
        {
          kind: 'text',
          id: `text-${pageNum}`,
          layerId: 'default',
          position: { x: 0.2, y: 0.3 },
          text: 'Andas!',
          fontSize: 0.03,
          color: '#141416',
        },
      ],
      updatedAt: '',
    });

    const exportedBytes = await exportAnnotatedPdf(originalBytes, [
      makePageAnn(1),
      makePageAnn(2),
      makePageAnn(3),
    ]);
    const reloaded = await PDFDocument.load(exportedBytes);

    expect(extractContentStreamStrings(reloaded, 0)).toContain('0 1 -1 0 200 0 cm');
    expect(extractContentStreamStrings(reloaded, 1)).toContain('-1 0 0 -1 200 400 cm');
    expect(extractContentStreamStrings(reloaded, 2)).toContain('0 -1 1 0 0 400 cm');
  });

  it('rejects encrypted PDFs with EncryptedPdfError and enforces MAX_PDF_BYTES', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 300]);
    const plainBytes = await doc.save({ useObjectStreams: false });

    const plainText = new TextDecoder('latin1').decode(plainBytes);
    const encryptedStub = plainText.replace(
      '/Root ',
      '/Encrypt << /Filter /Standard /V 2 /R 3 /Length 128 /P -4 >> /Root ',
    );
    const encryptedBytes = Uint8Array.from(encryptedStub, (ch) => ch.charCodeAt(0));

    await expect(exportAnnotatedPdf(encryptedBytes, [])).rejects.toBeInstanceOf(
      EncryptedPdfError,
    );

    const fakeHuge = { byteLength: MAX_PDF_BYTES + 1 } as unknown as Uint8Array;
    await expect(exportAnnotatedPdf(fakeHuge, [])).rejects.toThrow(/200 MB/);
  });
});
