const fileInput = document.getElementById('file-input');
const selectBtn = document.getElementById('select-btn');
const translateBtn = document.getElementById('translate-btn');
const dropZone = document.getElementById('drop-zone');
const fileNameEl = document.getElementById('file-name');
const statusText = document.getElementById('status-text');
const progressPercent = document.getElementById('progress-percent');
const progressFill = document.getElementById('progress-fill');
const stepText = document.getElementById('step-text');
const downloadLink = document.getElementById('download-link');
const originalPreview = document.getElementById('original-preview');
const translatedPreview = document.getElementById('translated-preview');

let selectedFile = null;

const API_BASE_URL =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://127.0.0.1:41000'
    : '';

function updateProgress(message, percent, detail = '') {
  statusText.textContent = message;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressFill.style.width = `${Math.round(percent)}%`;
  stepText.textContent = detail;
}

function friendlyWaitMessage(attempt) {
  const elapsedSeconds = attempt * 2.5;
  const estimateSeconds = Math.max(15, Math.round(95 - elapsedSeconds));
  if (attempt < 4) {
    return 'Chờ chút nhé, khoảng 1 phút nữa.';
  }
  return `Chờ chút nhé, khoảng ${estimateSeconds} giây nữa.`;
}

function setFileDetails(file) {
  if (!file) {
    fileNameEl.textContent = 'Chưa có tệp PDF nào được chọn.';
    translateBtn.disabled = true;
    return;
  }

  fileNameEl.textContent = file.name;
  translateBtn.disabled = false;
  renderPreview(file, originalPreview);
}

function renderPreview(file, container) {
  const objectUrl = URL.createObjectURL(file);
  container.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.src = objectUrl;
  iframe.title = file.name;
  container.appendChild(iframe);
}

function renderRemotePreview(url, container) {
  container.innerHTML = '';
  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.title = 'PDF đã dịch';
  container.appendChild(iframe);
}

selectBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (event) => {
  const [file] = event.target.files || [];
  if (file && file.type === 'application/pdf') {
    selectedFile = file;
    setFileDetails(file);
    updateProgress('Sẵn sàng.', 0, 'Nhấn Dịch PDF để bắt đầu.');
    downloadLink.hidden = true;
  }
});

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('is-dragging');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('is-dragging');
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
  const [file] = event.dataTransfer.files || [];
  if (file && file.type === 'application/pdf') {
    selectedFile = file;
    setFileDetails(file);
    updateProgress('Sẵn sàng.', 0, 'Nhấn Dịch PDF để bắt đầu.');
    downloadLink.hidden = true;
  }
});

translateBtn.addEventListener('click', async () => {
  if (!selectedFile) {
    return;
  }

  translateBtn.disabled = true;
  updateProgress('Đang chuẩn bị...', 5, 'Chờ chút nhé, hệ thống đang nhận tệp.');

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);

    updateProgress('Đang tải PDF lên...', 10, 'Chờ chút nhé, khoảng 1 phút nữa.');
    const uploadResponse = await fetch(`${API_BASE_URL}/api/v1/uploads`, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload thất bại: ${uploadResponse.status}`);
    }

    const uploadPayload = await uploadResponse.json();
    if (uploadPayload.code !== 0) {
      throw new Error(uploadPayload.message || 'Upload thất bại.');
    }

    const upload = uploadPayload.data;
    updateProgress('Đang xử lý PDF...', 20, 'Chờ chút nhé, khoảng 1 phút nữa.');

    const jobResponse = await fetch(`${API_BASE_URL}/api/v1/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workflow: 'book',
        source: { upload_id: upload.upload_id },
        target_lang: 'vi',
        provider: 'google_translate',
      }),
    });

    if (!jobResponse.ok) {
      throw new Error(`Tạo job thất bại: ${jobResponse.status}`);
    }

    const jobPayload = await jobResponse.json();
    if (jobPayload.code !== 0) {
      throw new Error(jobPayload.message || 'Không thể tạo job.');
    }

    const jobId = jobPayload.data.job_id;
    updateProgress('Đang dịch PDF...', 30, 'Chờ chút nhé, khoảng 1 phút nữa.');

    let detail = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const detailResponse = await fetch(`${API_BASE_URL}/api/v1/jobs/${encodeURIComponent(jobId)}`);
      if (!detailResponse.ok) {
        throw new Error(`Không thể đọc trạng thái job: ${detailResponse.status}`);
      }

      const detailPayload = await detailResponse.json();
      detail = detailPayload.data;
      const backendProgress = Number(detail?.progress);
      const percent = Number.isFinite(backendProgress)
        ? Math.max(30, Math.min(96, backendProgress))
        : 30 + Math.min(60, attempt * 0.5);
      updateProgress('Đang dịch PDF...', percent, friendlyWaitMessage(attempt));

      if (detail.status === 'succeeded' || detail.output_pdf_ready) {
        break;
      }

      if (detail.status === 'failed' || detail.status === 'canceled') {
        throw new Error('Job dịch thất bại. Vui lòng thử lại với PDF khác.');
      }

      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    if (!detail || !(detail.status === 'succeeded' || detail.output_pdf_ready)) {
      throw new Error('Job vẫn chưa hoàn tất sau thời gian chờ.');
    }

    const pdfUrl = `${API_BASE_URL}/api/v1/jobs/${encodeURIComponent(jobId)}/pdf`;
    renderRemotePreview(pdfUrl, translatedPreview);
    downloadLink.href = pdfUrl;
    downloadLink.download = `translated-${selectedFile.name}`;
    downloadLink.hidden = false;
    updateProgress('Hoàn tất.', 100, 'PDF đã sẵn sàng để tải về.');
  } catch (error) {
    console.error(error);
    translatedPreview.innerHTML =
      '<div style="padding: 12px; color: #7c2d12;">Không thể hoàn tất. Vui lòng thử lại sau hoặc dùng PDF ít trang hơn.</div>';
    updateProgress('Thất bại.', 0, 'Có lỗi khi xử lý PDF.');
  } finally {
    translateBtn.disabled = false;
  }
});
