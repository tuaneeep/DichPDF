let PDFLibModule = null;

async function loadPdfLib() {
  if (PDFLibModule) {
    return PDFLibModule;
  }

  try {
    PDFLibModule = await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.0/+esm');
  } catch (error) {
    console.warn('Không thể tải pdf-lib, dùng fallback PDF đơn giản.', error);
    PDFLibModule = null;
  }

  return PDFLibModule;
}

function sanitizeText(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim();
}

function wrapText(text, font, maxWidth, fontSize) {
  const words = sanitizeText(text).split(/(\s+)/);
  const lines = [];
  let currentLine = '';

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine}${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);

    if (width <= maxWidth || !currentLine) {
      currentLine = candidate;
    } else {
      lines.push(currentLine.trim());
      currentLine = word;
    }
  });

  if (currentLine) {
    lines.push(currentLine.trim());
  }

  return lines.filter(Boolean);
}

function splitParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

async function loadPrimaryFont(pdfDoc, pdfLib) {
  try {
    return pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  } catch (error) {
    console.warn('Không thể dùng font mặc định, dùng font hệ thống.', error);
    return pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
  }
}

export async function buildTranslatedPdf({ translatedMarkdown, originalPdfFile }) {
  const pdfLib = await loadPdfLib();
  if (!pdfLib) {
    const fallbackBlob = new Blob([`%PDF-1.4\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n4 0 obj<< /Length 44 >>stream\nBT /F1 12 Tf 72 720 Td (${(translatedMarkdown || 'Dịch hoàn tất.').replace(/\n/g, ' ')} ) Tj ET\nendstream\nendobj\n5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\nxref\n0 6\n0000000000 65535 f \n0000000010 00000 n \n0000000062 00000 n \n0000000119 00000 n \n0000000207 00000 n \n0000000307 00000 n \ntrailer<< /Root 1 0 R /Size 6 >>\nstartxref\n0\n%%EOF`], { type: 'application/pdf' });
    return new File([fallbackBlob], `${originalPdfFile.name.replace(/\.pdf$/i, '')}-vi.pdf`, { type: 'application/pdf' });
  }

  const { PDFDocument, rgb } = pdfLib;
  const sourcePdf = await PDFDocument.load(await originalPdfFile.arrayBuffer());
  const pdfDoc = await PDFDocument.create();
  const font = await loadPrimaryFont(pdfDoc, pdfLib);

  const sourcePages = sourcePdf.getPages();
  const paragraphs = splitParagraphs(translatedMarkdown || 'Dịch hoàn tất.');

  for (let index = 0; index < sourcePages.length; index += 1) {
    const sourcePage = sourcePages[index];
    const { width, height } = sourcePage.getSize();
    const page = pdfDoc.addPage([width, height]);
    const [copiedPage] = await pdfDoc.embedPdf(sourcePdf, [index]);

    page.drawPage(copiedPage, {
      x: 0,
      y: 0,
      width,
      height
    });

    const margin = Math.min(40, width * 0.06);
    const contentWidth = width - margin * 2;
    let y = height - margin;

    for (const paragraph of paragraphs) {
      const lines = wrapText(paragraph, font, contentWidth, 10.5);
      for (const line of lines) {
        if (y < margin) {
          break;
        }
        page.drawText(sanitizeText(line), {
          x: margin,
          y,
          size: 10.5,
          font,
          color: rgb(0.07, 0.09, 0.13)
        });
        y -= 13;
      }
      y -= 8;
    }
  }

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  return new File([blob], `${originalPdfFile.name.replace(/\.pdf$/i, '')}-vi.pdf`, { type: 'application/pdf' });
}
