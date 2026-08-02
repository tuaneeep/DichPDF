import { CONFIG } from './config.js';

const pdfjsLib = window.pdfjsLib;

function createFallbackSegments(text) {
  return text
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function splitMarkdownIntoSegments(markdown) {
  if (!markdown) {
    return [];
  }

  const cleaned = markdown
    .replace(/\r\n/g, '\n')
    .trim();

  if (!cleaned) {
    return [];
  }

  const blocks = cleaned.split(/\n{2,}/).map((chunk) => chunk.trim());
  return blocks.filter(Boolean);
}

export async function extractDocumentStructure(file, onProgress) {
  const remoteEnabled = CONFIG.MINERU_REMOTE_ENABLED === true;

  if (!remoteEnabled) {
    onProgress?.('MinerU trực tiếp từ trình duyệt không được kích hoạt. Đang dùng trình trích xuất nội bộ.', 10);
    return extractDocumentLocally(file, onProgress);
  }

  onProgress?.('Đang kết nối với MinerU API…', 8);

  const formData = new FormData();
  formData.append('file', file);
  formData.append('output_format', 'markdown');

  try {
    const response = await fetch(CONFIG.MINERU_ENDPOINT, {
      method: 'POST',
      headers: {
        'X-API-Key': CONFIG.MINERU_API_KEY,
        'X-Secret-Key': CONFIG.MINERU_SECRET_KEY
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`MinerU API trả về lỗi ${response.status}`);
    }

    const payload = await response.json();
    const markdown = payload.markdown || payload.content || payload.text || '';
    const segments = splitMarkdownIntoSegments(markdown);

    if (segments.length > 0) {
      onProgress?.('MinerU API phản hồi thành công.', 18);
      return {
        markdown,
        segments,
        title: payload.title || file.name.replace(/\.pdf$/i, '')
      };
    }
  } catch (error) {
    console.warn('MinerU API thất bại, chuyển sang chế độ fallback.', error);
  }

  return extractDocumentLocally(file, onProgress);
}

export async function extractDocumentLocally(file, onProgress) {
  onProgress?.('Đang trích xuất văn bản từ PDF bằng PDF.js…', 12);

  if (!pdfjsLib || typeof pdfjsLib.getDocument !== 'function') {
    onProgress?.('Không thể tải PDF.js trong môi trường hiện tại, dùng chế độ fallback.', 16);
    return {
      markdown: file.name,
      segments: createFallbackSegments(file.name),
      title: file.name.replace(/\.pdf$/i, '')
    };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const segments = [];
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => item.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageText) {
        segments.push(pageText);
      }
    }

    const markdown = segments.join('\n\n');
    onProgress?.('Hoàn tất trích xuất văn bản từ PDF.', 22);

    return {
      markdown,
      segments: segments.length > 0 ? segments : createFallbackSegments(file.name),
      title: file.name.replace(/\.pdf$/i, '')
    };
  } catch (error) {
    console.warn('PDF.js thất bại, chuyển sang fallback.', error);
    return {
      markdown: file.name,
      segments: createFallbackSegments(file.name),
      title: file.name.replace(/\.pdf$/i, '')
    };
  }
}
