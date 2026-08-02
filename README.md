# EEEP PDF Translator

Web app dịch PDF tiếng Anh sang tiếng Việt và xuất lại PDF đã xử lý. Dự án được sắp xếp để có thể đẩy lên GitHub và deploy trực tiếp lên Render bằng một Python Web Service.

## Cấu trúc

```text
backend/           FastAPI API xử lý upload, dịch và trả PDF
frontend-static/   Giao diện web tĩnh được backend phục vụ
requirements.txt   Dependencies cho Render
render.yaml        Blueprint deploy Render
pyproject.toml     Metadata/dependencies Python
```

Các thư mục runtime như `backend/workspace/`, `tmp/`, log, cache và file `.env` đã được đưa vào `.gitignore`.

## Chạy local

1. Tạo file môi trường cho backend nếu cần:

```bash
cp backend/.env.example backend/.env
```

2. Điền các biến môi trường cần dùng:

```env
GEMINI_API_KEY=...
MINERU_AK=...
MINERU_SK=...
GROQ_API_KEY=...
```

3. Cài dependencies và chạy API:

```bash
pip install -r requirements.txt
uvicorn backend.app:app --host 127.0.0.1 --port 41000
```

4. Mở web tại:

```text
http://127.0.0.1:41000/
```

## Deploy lên Render

1. Đẩy repo lên GitHub.
2. Vào Render, chọn **New +** > **Blueprint**.
3. Kết nối repository và chọn file `render.yaml`.
4. Thêm các Environment Variables trong Render:

```text
GEMINI_API_KEY
MINERU_AK
MINERU_SK
GROQ_API_KEY
```

5. Deploy. Sau khi build xong, Render URL sẽ mở thẳng giao diện người dùng.

## Lưu ý bảo mật

Không commit API key vào GitHub. Nếu cần cấu hình riêng cho local, dùng `backend/.env` hoặc biến môi trường trên máy.
