from __future__ import annotations

import os
import io
import sys
import json
import time
import zipfile
import uuid
import shutil
import logging
import asyncio
import re
import threading
from pathlib import Path
from typing import Dict, Any, List, Optional
from concurrent.futures import ThreadPoolExecutor

import requests
import fitz  # PyMuPDF
from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("pdf_translator")

# Base paths
BASE_DIR = Path(__file__).resolve().parent


def _load_local_env(path: Path) -> None:
    """Load a small local .env file without adding another dependency."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


_load_local_env(BASE_DIR / ".env")
WORKSPACE_DIR = BASE_DIR / "workspace"
UPLOADS_DIR = WORKSPACE_DIR / "uploads"
JOBS_DIR = WORKSPACE_DIR / "jobs"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR.mkdir(parents=True, exist_ok=True)

# Credentials must be supplied through environment variables or per-request fields.
DEFAULT_GEMINI_KEY = os.getenv("GEMINI_API_KEY", "")
DEFAULT_MINERU_AK = os.getenv("MINERU_AK", "")
DEFAULT_MINERU_SK = os.getenv("MINERU_SK", "")

MINERU_BASE_URL = "https://mineru.net"
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_MODEL = "gemini-2.0-flash"
GROQ_BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_MAX_BATCH_CHARS = max(1000, int(os.getenv("GROQ_MAX_BATCH_CHARS", "12000")))
GROQ_MAX_ITEM_CHARS = max(500, int(os.getenv("GROQ_MAX_ITEM_CHARS", "5000")))
GROQ_MIN_REQUEST_INTERVAL = max(0.0, float(os.getenv("GROQ_MIN_REQUEST_INTERVAL", "2.2")))
GROQ_RATE_LIMIT_RETRIES = max(0, int(os.getenv("GROQ_RATE_LIMIT_RETRIES", "6")))
_groq_rate_lock = threading.Lock()
_groq_last_request_at = 0.0
GOOGLE_TRANSLATE_URL = os.getenv(
    "GOOGLE_TRANSLATE_URL", "https://translate.googleapis.com/translate_a/single"
)
GOOGLE_TRANSLATE_CHUNK_CHARS = max(
    500, int(os.getenv("GOOGLE_TRANSLATE_CHUNK_CHARS", "3500"))
)


def get_groq_api_keys(extra_keys: Optional[List[str]] = None) -> List[str]:
    """Return de-duplicated Groq keys without ever logging their values."""
    raw_keys = list(extra_keys or [])
    raw_keys.extend(os.getenv("GROQ_API_KEYS", "").split(","))
    single_key = os.getenv("GROQ_API_KEY", "")
    if single_key:
        raw_keys.append(single_key)
    return list(dict.fromkeys(key.strip() for key in raw_keys if key and key.strip()))

# Memory storage for jobs
jobs_store: Dict[str, Dict[str, Any]] = {}
uploads_store: Dict[str, Dict[str, Any]] = {}
thread_pool = ThreadPoolExecutor(max_workers=5)

app = FastAPI(title="PDF Translation API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Helper Models ---
class JobCreatePayload(BaseModel):
    workflow: str = "book"
    source: Dict[str, Any]
    target_lang: str = "vi"
    provider: str = "google_translate"
    gemini_api_key: Optional[str] = None
    groq_api_keys: Optional[List[str]] = None
    mineru_ak: Optional[str] = None
    mineru_sk: Optional[str] = None


class KeyValidatePayload(BaseModel):
    gemini_api_key: Optional[str] = None
    mineru_ak: Optional[str] = None
    mineru_sk: Optional[str] = None
    provider: str = "groq"
    groq_api_keys: Optional[List[str]] = None


# --- MinerU Token Exchange & Processing ---
def get_mineru_token(ak: str, sk: str, relogin: bool = True) -> str:
    """Uses OpenXLab SDK to authenticate and retrieve a JWT token for MinerU API."""
    try:
        import openxlab
        from openxlab.xlab.handler.user_token import get_jwt
        logger.info("Logging into OpenXLab with provided AK/SK...")
        openxlab.login(ak=ak, sk=sk, relogin=relogin)
        jwt = get_jwt()
        logger.info(f"MinerU JWT obtained successfully (length={len(jwt) if jwt else 0})")
        if jwt and jwt.startswith("Bearer "):
            return jwt[7:]
        return jwt
    except Exception as e:
        logger.error(f"Failed to obtain MinerU token via openxlab: {e}")
        raise RuntimeError(f"Authenticating with MinerU AK/SK failed: {str(e)}")


def process_mineru_extraction(pdf_path: Path, mineru_token: str) -> Dict[str, Any]:
    """Use the documented MinerU API upload flow for local file processing."""
    auth_headers = {
        "Authorization": f"Bearer {mineru_token}",
        "Content-Type": "application/json",
        "Accept": "*/*",
    }

    filename = pdf_path.name
    logger.info("Requesting MinerU upload URL for file %s", filename)

    batch_payload = {
        "files": [{"name": filename}],
        "model_version": "vlm",
    }
    batch_res = requests.post(
        f"{MINERU_BASE_URL}/api/v4/file-urls/batch",
        headers=auth_headers,
        json=batch_payload,
        timeout=60,
    )
    logger.info("MinerU batch upload response: %s %s", batch_res.status_code, batch_res.text[:500])

    if batch_res.status_code != 200:
        raise RuntimeError(f"MinerU batch URL HTTP error: {batch_res.status_code} — {batch_res.text[:200]}")

    batch_data = batch_res.json()
    if batch_data.get("code") != 0:
        raise RuntimeError(f"MinerU batch URL error: {batch_data.get('msg', 'Unknown error')}")

    batch_info = batch_data.get("data", {})
    batch_id = batch_info.get("batch_id")
    upload_url = batch_info.get("file_urls", [None])[0]
    if not upload_url:
        raise RuntimeError("MinerU did not return any upload URL for the uploaded PDF.")

    logger.info("Uploading PDF to MinerU via %s", upload_url)
    with open(pdf_path, "rb") as fh:
        file_bytes = fh.read()
    put_res = requests.put(upload_url, data=file_bytes, headers={"Content-Type": "application/pdf"}, timeout=300)
    logger.info("MinerU upload response: %s %s", put_res.status_code, put_res.text[:500])

    if put_res.status_code not in (200, 201):
        raise RuntimeError(f"MinerU upload to OSS failed: HTTP {put_res.status_code} — {put_res.text[:200]}")

    logger.info("MinerU upload complete. Polling batch results for batch %s", batch_id)
    started_time = time.time()
    while True:
        status_res = requests.get(
            f"{MINERU_BASE_URL}/api/v4/extract-results/batch/{batch_id}",
            headers=auth_headers,
            timeout=60,
        )
        logger.info("MinerU batch status response: %s %s", status_res.status_code, status_res.text[:500])
        if status_res.status_code != 200:
            raise RuntimeError(f"MinerU batch status HTTP error: {status_res.status_code}")

        status_data = status_res.json()
        if status_data.get("code") != 0:
            raise RuntimeError(f"MinerU batch status error: {status_data.get('msg', 'Unknown error')}")

        results = status_data.get("data", {}).get("extract_result", [])
        for item in results:
            if item.get("file_name") == filename:
                state = item.get("state", "")
                logger.info("MinerU batch item state: %s", state)
                if state == "done":
                    zip_url = item.get("full_zip_url") or item.get("download_url")
                    if not zip_url:
                        logger.info("MinerU finished but did not return a ZIP URL.")
                        return {}
                    logger.info("Downloading MinerU result bundle from %s", zip_url)
                    zip_res = requests.get(zip_url, timeout=300)
                    logger.info("MinerU bundle download response: %s %s", zip_res.status_code, zip_res.text[:500])
                    if zip_res.status_code != 200:
                        return {}
                    with zipfile.ZipFile(io.BytesIO(zip_res.content)) as zf:
                        for inner_name in zf.namelist():
                            if inner_name.endswith("content_list_v2.json") or inner_name.endswith("content_list.json") or inner_name.endswith("middle.json"):
                                try:
                                    content_list = json.loads(zf.read(inner_name).decode("utf-8"))
                                    return {"content_list": content_list}
                                except Exception as ex:
                                    logger.warning("Failed to parse MinerU JSON %s: %s", inner_name, ex)
                    return {}
                if state == "failed":
                    raise RuntimeError(f"MinerU batch item failed: {item.get('err_msg', 'unknown error')}")

        if time.time() - started_time > 600:
            raise TimeoutError("Timed out waiting for MinerU batch processing.")

        time.sleep(3)


# --- Gemini Translation Service ---
def translate_texts_with_gemini(texts: List[str], target_lang: str, api_key: str) -> List[str]:
    """Translates a list of text blocks using Google Gemini API (AI Studio) in batches."""
    if not texts:
        return []

    if not api_key or not api_key.strip():
        raise ValueError("Gemini API key is missing or empty.")

    lang_names = {
        "vi": "Vietnamese",
        "en": "English",
        "zh": "Chinese",
        "ja": "Japanese",
        "fr": "French",
        "de": "German",
        "es": "Spanish"
    }
    target_lang_full = lang_names.get(target_lang, "Vietnamese")

    system_prompt = (
        f"You are a professional document translator. Translate the given array of text strings into {target_lang_full}.\n"
        "Rules:\n"
        "1. Keep formatting, LaTeX equations ($...$), code, placeholders, and numbers intact.\n"
        "2. Preserve the EXACT number of items in the array.\n"
        "3. Output MUST be valid JSON in this format: {\"translations\": [\"translated_item1\", \"translated_item2\", ...]}"
    )

    url = f"{GEMINI_BASE_URL}/models/{GEMINI_MODEL}:generateContent?key={api_key.strip()}"
    batch_size = 20
    all_translated: List[str] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        user_content = json.dumps({"texts": batch}, ensure_ascii=False)

        payload = {
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            },
            "contents": [{
                "role": "user",
                "parts": [{"text": user_content}]
            }],
            "generationConfig": {
                "responseMimeType": "application/json",
                "maxOutputTokens": 8192,
                "temperature": 0.1
            }
        }

        logger.info(f"Gemini translating batch {i//batch_size + 1} ({len(batch)} texts)...")
        try:
            res = requests.post(
                url,
                headers={"Content-Type": "application/json"},
                json=payload,
                timeout=120
            )
        except requests.exceptions.Timeout:
            raise RuntimeError("Gemini API request timed out. Check your network connection.")
        except requests.exceptions.ConnectionError as ce:
            raise RuntimeError(f"Cannot connect to Gemini API: {ce}")

        if res.status_code == 400:
            err_detail = res.json().get("error", {}).get("message", res.text[:200])
            raise RuntimeError(f"Gemini API bad request (400): {err_detail}")
        elif res.status_code == 401 or res.status_code == 403:
            raise RuntimeError("Gemini API Key không hợp lệ hoặc không có quyền truy cập (401/403). Vui lòng kiểm tra lại key tại aistudio.google.com.")
        elif res.status_code == 429:
            raise RuntimeError("Gemini API bị giới hạn tốc độ (429 Rate Limit). Hãy thử lại sau ít phút.")
        elif res.status_code != 200:
            raise RuntimeError(f"Gemini API lỗi (HTTP {res.status_code}): {res.text[:300]}")

        resp_data = res.json()
        try:
            content_str = resp_data["candidates"][0]["content"]["parts"][0]["text"]
            parsed = json.loads(content_str)
            translations = parsed.get("translations", batch)
            if len(translations) != len(batch):
                logger.warning(f"Gemini batch count mismatch: got {len(translations)}, expected {len(batch)}. Padding with originals.")
                while len(translations) < len(batch):
                    translations.append(batch[len(translations)])
                all_translated.extend(translations[:len(batch)])
            else:
                all_translated.extend(translations)
        except Exception as e:
            logger.error(f"Error parsing Gemini response: {e}. Keeping original batch text.")
            all_translated.extend(batch)

    return all_translated


def _split_long_text(text: str, max_chars: int = GROQ_MAX_ITEM_CHARS) -> List[str]:
    """Split long text on natural boundaries while preserving every character."""
    if len(text) <= max_chars:
        return [text]

    pieces = re.split(r"(?<=[.!?。！？\n])", text)
    chunks: List[str] = []
    current = ""
    for piece in pieces:
        while len(piece) > max_chars:
            room = max_chars - len(current)
            if room > 0:
                current += piece[:room]
                piece = piece[room:]
                chunks.append(current)
                current = ""
            else:
                chunks.append(piece[:max_chars])
                piece = piece[max_chars:]
        if current and len(current) + len(piece) > max_chars:
            chunks.append(current)
            current = piece
        else:
            current += piece
    if current or not chunks:
        chunks.append(current)
    return chunks


class GroqBatchShapeError(RuntimeError):
    """The model returned valid JSON but did not preserve the input item count."""


def _wait_for_groq_slot() -> None:
    """Keep all jobs together below the free-tier requests-per-minute limit."""
    global _groq_last_request_at
    with _groq_rate_lock:
        remaining = GROQ_MIN_REQUEST_INTERVAL - (time.monotonic() - _groq_last_request_at)
        if remaining > 0:
            time.sleep(remaining)
        _groq_last_request_at = time.monotonic()


def _groq_retry_delay(response: requests.Response, retry_number: int) -> float:
    retry_after = response.headers.get("retry-after")
    if retry_after:
        try:
            return min(60.0, max(1.0, float(retry_after)))
        except ValueError:
            pass
    match = re.search(r"(?:try again in|retry after)\s*([0-9.]+)\s*(ms|s)", response.text, re.I)
    if match:
        delay = float(match.group(1))
        if match.group(2).lower() == "ms":
            delay /= 1000
        return min(60.0, max(1.0, delay + 0.5))
    return min(60.0, 5.0 * (retry_number + 1))


def _groq_request(batch: List[str], target_lang_full: str, api_keys: List[str]) -> List[str]:
    system_prompt = (
        f"Translate each string in the JSON array into {target_lang_full}. "
        "Preserve formatting, equations, code, placeholders, whitespace and numbers. "
        "Return only valid JSON: {\"translations\":[...]}. The output array must have exactly the same length."
    )
    payload = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps({"texts": batch}, ensure_ascii=False)},
        ],
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
    }
    errors: List[str] = []
    key_index = 0
    rate_limit_retries = 0
    while key_index < len(api_keys):
        api_key = api_keys[key_index]
        _wait_for_groq_slot()
        try:
            response = requests.post(
                f"{GROQ_BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=120,
            )
        except requests.RequestException as exc:
            errors.append(f"key {key_index + 1}: {type(exc).__name__}")
            key_index += 1
            continue

        if response.status_code == 200:
            try:
                parsed = json.loads(response.json()["choices"][0]["message"]["content"])
                translations = parsed["translations"]
                if not isinstance(translations, list):
                    raise ValueError("translations is not an array")
                if len(batch) == 1 and translations:
                    return [str(translations[0])]
                if len(translations) != len(batch):
                    raise GroqBatchShapeError(
                        f"translation count mismatch: expected {len(batch)}, got {len(translations)}"
                    )
                return [str(item) for item in translations]
            except GroqBatchShapeError:
                # A different API key will normally produce the same model-shape
                # problem. Let the caller retry with smaller batches instead.
                raise
            except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                errors.append(f"key {key_index + 1}: invalid response ({exc})")
                key_index += 1
                continue

        detail = response.text[:200].replace("\n", " ")
        errors.append(f"key {key_index + 1}: HTTP {response.status_code} {detail}")
        if response.status_code == 429 and rate_limit_retries < GROQ_RATE_LIMIT_RETRIES:
            delay = _groq_retry_delay(response, rate_limit_retries)
            rate_limit_retries += 1
            logger.warning(
                "Groq RPM limit reached; waiting %.1fs before retry %s/%s",
                delay, rate_limit_retries, GROQ_RATE_LIMIT_RETRIES,
            )
            time.sleep(delay)
            # Keys in one organization share quota, so retry the same key after waiting.
            continue
        if response.status_code not in (401, 403, 408, 413, 429, 500, 502, 503, 504):
            break
        key_index += 1

    raise RuntimeError("Groq request failed after trying all configured keys: " + " | ".join(errors))


def _groq_translate_batch_resilient(
    batch: List[str], target_lang_full: str, api_keys: List[str]
) -> List[str]:
    """Retry count-mismatched model output by recursively reducing batch size."""
    try:
        return _groq_request(batch, target_lang_full, api_keys)
    except GroqBatchShapeError as exc:
        if len(batch) <= 1:
            raise RuntimeError(f"Groq could not translate a single text item: {exc}") from exc
        midpoint = len(batch) // 2
        logger.warning(
            "Groq returned the wrong item count for %s chunks; retrying as %s + %s",
            len(batch), midpoint, len(batch) - midpoint,
        )
        return (
            _groq_translate_batch_resilient(batch[:midpoint], target_lang_full, api_keys)
            + _groq_translate_batch_resilient(batch[midpoint:], target_lang_full, api_keys)
        )


def translate_texts_with_groq(texts: List[str], target_lang: str, api_keys: List[str]) -> List[str]:
    """Translate with bounded batches, then rebuild long inputs in their original order."""
    if not texts:
        return []
    if not api_keys:
        raise ValueError("Groq API key is missing. Set GROQ_API_KEYS (comma-separated).")

    lang_names = {
        "vi": "Vietnamese", "en": "English", "zh": "Chinese", "ja": "Japanese",
        "fr": "French", "de": "German", "es": "Spanish",
    }
    target_lang_full = lang_names.get(target_lang, target_lang or "Vietnamese")
    units: List[str] = []
    owners: List[int] = []
    for owner, text in enumerate(texts):
        for chunk in _split_long_text(text):
            units.append(chunk)
            owners.append(owner)

    translated_units: List[str] = []
    cursor = 0
    while cursor < len(units):
        end = cursor
        char_count = 0
        while end < len(units) and end - cursor < 20:
            next_size = len(units[end])
            if end > cursor and char_count + next_size > GROQ_MAX_BATCH_CHARS:
                break
            char_count += next_size
            end += 1
        batch = units[cursor:end]
        logger.info("Groq translating batch %s (%s chunks, %s chars)", cursor + 1, len(batch), char_count)
        translated_units.extend(_groq_translate_batch_resilient(batch, target_lang_full, api_keys))
        cursor = end

    rebuilt = ["" for _ in texts]
    for owner, translated in zip(owners, translated_units):
        rebuilt[owner] += translated
    return rebuilt


def _google_translate_chunk(text: str, target_lang: str) -> str:
    """Translate one bounded chunk through Google's keyless web endpoint."""
    if not text.strip():
        return text
    last_error = "unknown error"
    for attempt in range(2):
        try:
            response = requests.post(
                GOOGLE_TRANSLATE_URL,
                params={"client": "gtx", "sl": "en", "tl": target_lang, "dt": "t"},
                data={"q": text},
                timeout=30,
            )
        except requests.RequestException as exc:
            last_error = type(exc).__name__
            response = None

        if response is not None and response.status_code == 200:
            try:
                segments = response.json()[0]
                return "".join(segment[0] or "" for segment in segments if segment)
            except (KeyError, IndexError, TypeError, ValueError) as exc:
                raise RuntimeError(f"Google Translate returned an invalid response: {exc}") from exc

        if response is not None:
            last_error = f"HTTP {response.status_code}: {response.text[:160]}"
            if response.status_code not in (408, 429, 500, 502, 503, 504):
                break
        if attempt < 1:
            delay = 2.0
            logger.warning("Google Translate temporarily unavailable; retrying in %.1fs", delay)
            time.sleep(delay)
    raise RuntimeError(f"Google Translate failed after retries: {last_error}")


def translate_texts_with_google(texts: List[str], target_lang: str) -> List[str]:
    """Batch many PDF lines into a few requests and restore their original order."""
    if not texts:
        return []

    translated = ["" for _ in texts]
    units: List[tuple[int, str]] = []
    for owner, text in enumerate(texts):
        if _should_preserve_without_translation(text):
            translated[owner] = text
            continue
        for chunk in _split_long_text(text, GOOGLE_TRANSLATE_CHUNK_CHARS):
            units.append((owner, chunk))

    cursor = 0
    while cursor < len(units):
        batch: List[tuple[int, str]] = []
        estimated_size = 0
        while cursor < len(units):
            next_size = len(units[cursor][1]) + 32
            if batch and estimated_size + next_size > GOOGLE_TRANSLATE_CHUNK_CHARS:
                break
            batch.append(units[cursor])
            estimated_size += next_size
            cursor += 1

        markers = [f"XPDFBLOCK{index:04d}X" for index in range(len(batch) + 1)]
        joined = markers[0] + "\n"
        for index, (_, chunk) in enumerate(batch):
            joined += chunk + "\n" + markers[index + 1] + "\n"

        logger.info("Google translating packed batch (%s PDF lines, %s chars)", len(batch), len(joined))
        packed_translation = _google_translate_chunk(joined, target_lang)
        positions = [packed_translation.find(marker) for marker in markers]
        if any(position < 0 for position in positions) or positions != sorted(positions):
            raise RuntimeError("Google Translate changed the PDF line markers; please retry.")

        for index, (owner, _) in enumerate(batch):
            value = packed_translation[
                positions[index] + len(markers[index]):positions[index + 1]
            ].strip("\r\n ")
            translated[owner] += value

        if cursor < len(units):
            time.sleep(0.6)

    return translated


def _should_preserve_without_translation(text: str) -> bool:
    """Keep formulas, numeric labels, and symbol-heavy fragments out of MT."""
    stripped = text.strip()
    if not stripped:
        return True
    letters = re.findall(r"[A-Za-zÀ-ỹ]", stripped)
    digits = re.findall(r"\d", stripped)
    math_symbols = re.findall(r"[=+\-*/^√∑∫∞≈≠≤≥±×÷%<>()[\]{}|_]", stripped)
    non_space = re.findall(r"\S", stripped)
    if not non_space:
        return True
    if len(stripped) <= 3 and not letters:
        return True
    if math_symbols and digits and len(letters) <= 4:
        return True
    if math_symbols and len(letters) <= 2:
        return True
    if digits and not letters and len(math_symbols) + len(digits) >= max(1, int(len(non_space) * 0.6)):
        return True
    symbol_count = len(non_space) - len(letters) - len(digits)
    return symbol_count >= max(3, int(len(non_space) * 0.65)) and len(letters) <= 3


def _is_italic_symbol_line(line: Dict[str, Any], text: str) -> bool:
    """Preserve italic math/symbol fragments that MT often corrupts."""
    spans = line.get("spans", [])
    if not spans:
        return False
    italic_spans = [
        span for span in spans
        if span.get("text", "").strip()
        and (
            "italic" in str(span.get("font", "")).lower()
            or "oblique" in str(span.get("font", "")).lower()
            or int(span.get("flags", 0)) & 2
        )
    ]
    if not italic_spans:
        return False
    stripped = text.strip()
    letters = re.findall(r"[A-Za-zÀ-ỹ]", stripped)
    digits = re.findall(r"\d", stripped)
    math_symbols = re.findall(r"[=+\-*/^√∑∫∞≈≠≤≥±×÷%<>()[\]{}|_,.;:]", stripped)
    if len(stripped) <= 12:
        return True
    return bool(math_symbols or digits) and len(letters) <= 8


def _is_italic_span(span: Dict[str, Any]) -> bool:
    return (
        "italic" in str(span.get("font", "")).lower()
        or "oblique" in str(span.get("font", "")).lower()
        or int(span.get("flags", 0)) & 2
    )


def _should_protect_inline_span(span: Dict[str, Any]) -> bool:
    text = span.get("text", "").strip()
    if not text or not _is_italic_span(span):
        return False
    letters = re.findall(r"[A-Za-zÀ-ỹ]", text)
    digits = re.findall(r"\d", text)
    math_symbols = re.findall(r"[=+\-*/^√∑∫∞≈≠≤≥±×÷%<>()[\]{}|_,.;:]", text)
    if len(text) <= 3:
        return True
    return bool(digits or math_symbols) and len(letters) <= 8


def _restore_protected_terms(text: str, protected_terms: Dict[str, str]) -> str:
    restored = text
    for marker, original in protected_terms.items():
        restored = restored.replace(marker, original)
    return restored


def translate_texts_with_provider(
    texts: List[str], target_lang: str, api_key: str, provider: str = "google_translate",
    groq_api_keys: Optional[List[str]] = None,
) -> List[str]:
    """Route translation to Groq, Gemini, or a local mock provider."""
    provider_name = (provider or "google_translate").lower()
    if provider_name == "mock":
        return [f"[{target_lang}] {text}" if text else "" for text in texts]
    if provider_name == "gemini":
        return translate_texts_with_gemini(texts, target_lang, api_key)
    if provider_name == "groq":
        return translate_texts_with_groq(texts, target_lang, get_groq_api_keys(groq_api_keys))
    if provider_name in ("google", "google_translate"):
        return translate_texts_with_google(texts, target_lang)
    raise ValueError(f"Unsupported translation provider: {provider_name}")


# --- PDF Layout-Preserved Renderer ---
def render_translated_pdf(source_pdf: Path, output_pdf: Path, target_lang: str, gemini_key: str, mineru_data: Dict[str, Any], provider: str = "google_translate", groq_api_keys: Optional[List[str]] = None) -> None:
    """Renders translated PDF while maintaining layout, images, and visual elements."""
    doc = fitz.open(source_pdf)
    unicode_font_path = BASE_DIR / "fonts" / "SourceHanSerifSC-Regular.otf"
    
    content_list = mineru_data.get("content_list", [])
    
    # Page by page translation & layout replacement
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        rect = page.rect
        font_name = "helv"
        if unicode_font_path.exists():
            try:
                page.insert_font(fontname="pdfunicode", fontfile=str(unicode_font_path))
                font_name = "pdfunicode"
            except Exception as font_error:
                logger.warning("Could not load Unicode font: %s", font_error)
        
        # Get page paragraphs from PyMuPDF blocks. Translating whole blocks
        # preserves sentence context better than translating visual lines.
        text_blocks = []
        page_dict = page.get_text("dict")
        
        block_id = 0
        for block in page_dict.get("blocks", []):
            if block.get("type") == 0:  # Text block
                block_sizes = [
                    span.get("size", 10)
                    for line in block.get("lines", [])
                    for span in line.get("spans", [])
                    if span.get("text", "").strip()
                ]
                block_font_size = max(block_sizes) if block_sizes else 10
                block_rect: Optional[fitz.Rect] = None
                paragraph_lines: List[str] = []
                protected_terms: Dict[str, str] = {}
                for line in block.get("lines", []):
                    line_parts: List[str] = []
                    for span in line.get("spans", []):
                        span_text = span.get("text", "")
                        if _should_protect_inline_span(span):
                            marker = f"QZXKEEP{len(protected_terms):04d}QZX"
                            protected_terms[marker] = span_text
                            line_parts.append(marker)
                        else:
                            line_parts.append(span_text)
                    line_text = "".join(line_parts).strip()
                    if line_text and len(line_text) > 1:
                        paragraph_lines.append(line_text)
                        line_rect = fitz.Rect(line.get("bbox"))
                        block_rect = line_rect if block_rect is None else block_rect | line_rect
                paragraph_text = " ".join(paragraph_lines).strip()
                if paragraph_text and block_rect is not None:
                    text_blocks.append({
                        "block_id": block_id,
                        "text": paragraph_text,
                        "bbox": block_rect,
                        "size": block_font_size,
                        "protected_terms": protected_terms,
                        "preserve": _should_preserve_without_translation(
                            _restore_protected_terms(paragraph_text, protected_terms)
                        ),
                    })
                block_id += 1
                        
        if not text_blocks:
            continue
            
        # Extract text strings to translate
        original_strings = [b["text"] if not b.get("preserve") else "" for b in text_blocks]
        translated_strings = translate_texts_with_provider(original_strings, target_lang, gemini_key, provider, groq_api_keys)
        for index, b in enumerate(text_blocks):
            if b.get("preserve"):
                translated_strings[index] = b["text"]
            translated_strings[index] = _restore_protected_terms(
                translated_strings[index],
                b.get("protected_terms", {}),
            )

        block_font_sizes: Dict[int, float] = {}
        for current_block_id in {b["block_id"] for b in text_blocks}:
            group = [
                (b, trans)
                for b, trans in zip(text_blocks, translated_strings)
                if b["block_id"] == current_block_id and trans and trans != b["text"]
            ]
            if not group:
                continue
            base_size = min(b["size"] for b, _ in group)
            min_size = 3.5
            fitted_size = min_size
            for candidate_size in [base_size - step * 0.5 for step in range(32)]:
                if candidate_size < min_size:
                    break
                all_fit = True
                for b, trans in group:
                    bbox = fitz.Rect(b["bbox"])
                    vertical_padding = max(2.0, candidate_size * 0.25)
                    text_box = fitz.Rect(
                        max(rect.x0, bbox.x0 - 1.0),
                        max(rect.y0, bbox.y0 - vertical_padding),
                        min(rect.x1, bbox.x1 + 2.0),
                        min(rect.y1, bbox.y1 + vertical_padding),
                    )
                    shape = page.new_shape()
                    result = shape.insert_textbox(
                        text_box,
                        trans,
                        fontsize=candidate_size,
                        fontname=font_name,
                        color=(0, 0, 0),
                        align=0,
                    )
                    if result < 0:
                        all_fit = False
                        break
                if all_fit:
                    fitted_size = candidate_size
                    break
            block_font_sizes[current_block_id] = fitted_size
        
        # Overlay translated strings onto page
        for b, trans in zip(text_blocks, translated_strings):
            if not trans or trans == b["text"]:
                continue
                
            bbox = fitz.Rect(b["bbox"])
            paragraph_size = block_font_sizes.get(b["block_id"], b["size"])
            vertical_padding = max(2.0, paragraph_size * 0.25)
            text_box = fitz.Rect(
                max(rect.x0, bbox.x0 - 1.0),
                max(rect.y0, bbox.y0 - vertical_padding),
                min(rect.x1, bbox.x1 + 2.0),
                min(rect.y1, bbox.y1 + vertical_padding),
            )
            page.draw_rect(bbox, color=None, fill=(1, 1, 1), overlay=True)
            shape = page.new_shape()
            result = shape.insert_textbox(
                text_box,
                trans,
                fontsize=paragraph_size,
                fontname=font_name,
                color=(0, 0, 0),
                align=0,
            )
            if result < 0:
                shape.insert_text(
                    (text_box.x0, max(text_box.y0 + paragraph_size, bbox.y1)),
                    trans,
                    fontsize=paragraph_size,
                    fontname=font_name,
                    color=(0, 0, 0),
                )
            shape.commit(overlay=True)
            logger.debug("Inserted translation at paragraph size %.1fpt", paragraph_size)
                
    doc.save(output_pdf)
    doc.close()


# --- Background Worker Task ---
def run_job_pipeline(job_id: str, payload: JobCreatePayload):
    job = jobs_store[job_id]
    job["status"] = "processing"
    job["progress"] = 10
    job["message"] = "Đang xác thực MinerU và chuẩn bị file PDF..."
    
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    
    try:
        upload_id = payload.source.get("upload_id")
        upload_info = uploads_store.get(upload_id)
        if not upload_info:
            raise RuntimeError(f"Upload ID '{upload_id}' không tồn tại. Hãy thử tải file lên lại.")
            
        pdf_path = Path(upload_info["file_path"])
        if not pdf_path.exists():
            raise RuntimeError(f"File PDF không tìm thấy trên server: {pdf_path.name}")
        
        output_pdf_path = job_dir / "translated.pdf"
        
        gemini_key = (payload.gemini_api_key or DEFAULT_GEMINI_KEY or "").strip()
        mineru_ak = (payload.mineru_ak or DEFAULT_MINERU_AK or "").strip()
        mineru_sk = (payload.mineru_sk or DEFAULT_MINERU_SK or "").strip()
        target_lang = payload.target_lang or "vi"
        provider = (payload.provider or "google_translate").lower()
        
        logger.info(f"Job {job_id}: provider={provider}, lang={target_lang}, file={pdf_path.name}")
        
        # Step 1: MinerU Extract (with forced relogin to get fresh token)
        job["progress"] = 20
        job["message"] = "Đang xác thực MinerU và lấy token..."
        
        mineru_data = {}
        if mineru_ak and mineru_sk:
            try:
                mineru_token = thread_pool.submit(
                    get_mineru_token,
                    mineru_ak,
                    mineru_sk,
                    True,
                ).result(timeout=8)
                job["progress"] = 30
                job["message"] = "Đang tải PDF lên MinerU để phân tích bố cục..."
                mineru_data = process_mineru_extraction(pdf_path, mineru_token)
                job["progress"] = 60
                job["message"] = f"MinerU trích xuất xong {len(mineru_data.get('content_list', []))} phần tử. Đang dịch với {provider.title()}..."
            except Exception as ex:
                logger.warning(f"MinerU extraction warning (job {job_id}): {ex}. Dùng PyMuPDF fallback.")
                job["message"] = f"MinerU không thể xử lý ({str(ex)[:80]}). Đang dùng PyMuPDF..."
                job["progress"] = 50
        else:
            logger.info("No MinerU credentials provided, using PyMuPDF only.")
            job["progress"] = 50
            job["message"] = "Không có MinerU credentials, dùng PyMuPDF để trích xuất..."
            
        # Step 2: Translate and render
        job["progress"] = max(job["progress"], 60)
        job["message"] = f"Đang dịch nội dung sang {target_lang} bằng {provider.title()}..."
        job["provider"] = provider
        job["target_lang"] = target_lang

        if provider == "gemini" and not gemini_key:
            raise RuntimeError("Gemini API Key chưa được cung cấp. Vui lòng nhập key trong phần Cài đặt.")
        if provider == "groq" and not get_groq_api_keys(payload.groq_api_keys):
            raise RuntimeError("Groq API Key chưa được cấu hình. Hãy đặt GROQ_API_KEYS.")
        
        render_translated_pdf(pdf_path, output_pdf_path, target_lang, gemini_key, mineru_data, provider, payload.groq_api_keys)
        
        job["progress"] = 100
        job["status"] = "succeeded"
        job["message"] = "Dịch PDF hoàn tất thành công!"
        job["output_pdf_ready"] = True
        job["output_pdf_path"] = str(output_pdf_path)
        logger.info(f"Job {job_id} finished successfully!")
        
    except Exception as err:
        logger.error(f"Job {job_id} failed: {err}", exc_info=True)
        job["status"] = "failed"
        job["message"] = str(err)
        job["progress"] = 0


# --- FastAPI Endpoints ---

@app.get("/api/v1/health")
def health_check():
    return {"status": "ok", "service": "pdf-translator"}


@app.post("/api/v1/uploads")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
        
    upload_id = str(uuid.uuid4())
    file_path = UPLOADS_DIR / f"{upload_id}_{file.filename}"
    
    content = await file.read()
    file_size = len(content)
    
    with open(file_path, "wb") as f:
        f.write(content)
        
    # Get page count using PyMuPDF
    page_count = 1
    try:
        doc = fitz.open(file_path)
        page_count = len(doc)
        doc.close()
    except Exception:
        pass
        
    if page_count > 20:
        raise HTTPException(status_code=400, detail="PDF vượt quá 20 trang. Hệ thống hiện đang giới hạn tài liệu tối đa 20 trang.")

    upload_data = {
        "upload_id": upload_id,
        "filename": file.filename,
        "bytes": file_size,
        "page_count": page_count,
        "file_path": str(file_path),
        "uploaded_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
    }
    
    uploads_store[upload_id] = upload_data
    
    return {
        "code": 0,
        "message": "success",
        "data": upload_data
    }


@app.post("/api/v1/jobs")
def create_job(payload: JobCreatePayload, background_tasks: BackgroundTasks):
    job_id = f"job-{uuid.uuid4().hex[:12]}"
    
    jobs_store[job_id] = {
        "job_id": job_id,
        "status": "pending",
        "progress": 0,
        "message": "Job queued",
        "output_pdf_ready": False,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
    }
    
    background_tasks.add_task(run_job_pipeline, job_id, payload)
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "job_id": job_id,
            "status": "pending"
        }
    }


@app.get("/api/v1/jobs/{job_id}")
def get_job_detail(job_id: str):
    if job_id not in jobs_store:
        raise HTTPException(status_code=404, detail="Job not found")
        
    job = jobs_store[job_id]
    
    return {
        "code": 0,
        "message": "success",
        "data": {
            "job_id": job["job_id"],
            "status": job["status"],
            "progress": job["progress"],
            "message": job["message"],
            "output_pdf_ready": job.get("output_pdf_ready", False),
            "artifacts_display": [
                {
                    "key": "output_pdf",
                    "title": "Bản dịch PDF",
                    "ready": job.get("output_pdf_ready", False)
                }
            ]
        }
    }


@app.get("/api/v1/jobs/{job_id}/pdf")
def download_job_pdf(job_id: str):
    if job_id not in jobs_store:
        raise HTTPException(status_code=404, detail="Job not found")
        
    job = jobs_store[job_id]
    if not job.get("output_pdf_ready") or not job.get("output_pdf_path"):
        raise HTTPException(status_code=400, detail="PDF is not ready yet")
        
    pdf_path = Path(job["output_pdf_path"])
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF file missing")
        
    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=f"dich_{job_id}.pdf",
        headers={"Content-Disposition": f"inline; filename=dich_{job_id}.pdf"}
    )


@app.post("/api/v1/settings/validate-key")
def validate_credentials(payload: KeyValidatePayload):
    gemini_key = (payload.gemini_api_key or DEFAULT_GEMINI_KEY or "").strip()
    mineru_ak = (payload.mineru_ak or DEFAULT_MINERU_AK or "").strip()
    mineru_sk = (payload.mineru_sk or DEFAULT_MINERU_SK or "").strip()
    provider = (payload.provider or "gemini").lower()

    gemini_status = "ok"
    gemini_msg = "Gemini API Key hợp lệ và kết nối thành công"

    # Validate Gemini
    if not gemini_key:
        gemini_status = "missing"
        gemini_msg = "Gemini API Key chưa được cung cấp."
    else:
        try:
            test_url = f"{GEMINI_BASE_URL}/models/{GEMINI_MODEL}:generateContent?key={gemini_key}"
            res = requests.post(
                test_url,
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [{"role": "user", "parts": [{"text": "Say hello"}]}],
                    "generationConfig": {"maxOutputTokens": 5}
                },
                timeout=15
            )
            if res.status_code == 200:
                gemini_status = "ok"
                gemini_msg = "Gemini API Key hợp lệ ✓ (gemini-2.0-flash hoạt động)"
            elif res.status_code in (401, 403):
                gemini_status = "invalid"
                err_detail = res.json().get("error", {}).get("message", "Unauthorized")
                gemini_msg = f"Gemini API Key không hợp lệ (401/403): {err_detail[:150]}"
            elif res.status_code == 429:
                gemini_status = "rate_limited"
                gemini_msg = "Gemini API bị giới hạn tốc độ (429). Hãy thử lại sau."
            elif res.status_code == 400:
                err_detail = res.json().get("error", {}).get("message", "Bad Request")
                gemini_status = "invalid"
                gemini_msg = f"Gemini yêu cầu không hợp lệ (400): {err_detail[:150]}"
            else:
                gemini_status = "invalid"
                gemini_msg = f"Gemini trả về HTTP {res.status_code}: {res.text[:200]}"
        except requests.exceptions.Timeout:
            gemini_status = "error"
            gemini_msg = "Kết nối tới Gemini API bị timeout. Kiểm tra lại mạng."
        except Exception as e:
            gemini_status = "error"
            gemini_msg = f"Lỗi kết nối Gemini: {str(e)}"

    # Validate MinerU
    mineru_status = "ok"
    mineru_msg = "MinerU AK/SK hợp lệ ✓"
    if not mineru_ak or not mineru_sk:
        mineru_status = "missing"
        mineru_msg = "MinerU AK hoặc SK chưa được cung cấp."
    else:
        try:
            token = get_mineru_token(mineru_ak, mineru_sk, relogin=True)
            if not token:
                mineru_status = "error"
                mineru_msg = "Không thể tạo JWT token từ MinerU AK/SK."
            else:
                mineru_status = "ok"
                mineru_msg = "MinerU AK/SK hợp lệ, kết nối thành công ✓"
        except Exception as e:
            mineru_status = "error"
            mineru_msg = f"Lỗi MinerU: {str(e)}"

    return {
        "code": 0,
        "data": {
            "provider": provider,
            "gemini": {"status": gemini_status, "message": gemini_msg},
            "mineru": {"status": mineru_status, "message": mineru_msg}
        }
    }


# Mount the static frontend. Render can run this single FastAPI service and serve
# both the API and the user-facing web app.
from fastapi.staticfiles import StaticFiles

STATIC_DIR = BASE_DIR.parent / "frontend-static"
DIST_DIR = BASE_DIR.parent / "frontend-react" / "dist"
FRONTEND_DIR = STATIC_DIR if STATIC_DIR.exists() else DIST_DIR

if FRONTEND_DIR.exists():
    assets_dir = FRONTEND_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend_app(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        file_path = FRONTEND_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(FRONTEND_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=41000)
