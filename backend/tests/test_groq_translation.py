import json

from backend import app as app_module


class FakeResponse:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


def test_split_long_text_preserves_all_characters():
    text = ("First sentence. Second sentence!\n" * 50) + "tail"
    chunks = app_module._split_long_text(text, max_chars=100)
    assert "".join(chunks) == text
    assert all(len(chunk) <= 100 for chunk in chunks)


def test_groq_rotates_key_after_rate_limit(monkeypatch):
    calls = []

    def fake_post(url, headers, json, timeout):
        calls.append(headers["Authorization"])
        if len(calls) == 1:
            return FakeResponse(429, text="rate limited")
        content = json_module.dumps({"translations": ["Xin chào"]})
        return FakeResponse(200, {"choices": [{"message": {"content": content}}]})

    json_module = json
    monkeypatch.setattr(app_module.requests, "post", fake_post)
    result = app_module.translate_texts_with_groq(["Hello"], "vi", ["key-one", "key-two"])

    assert result == ["Xin chào"]
    assert calls == ["Bearer key-one", "Bearer key-two"]


def test_groq_reassembles_long_items(monkeypatch):
    monkeypatch.setattr(app_module, "GROQ_MAX_ITEM_CHARS", 5)
    monkeypatch.setattr(app_module, "GROQ_MAX_BATCH_CHARS", 8)
    monkeypatch.setattr(app_module, "_groq_request", lambda batch, lang, keys: [part.upper() for part in batch])

    assert app_module.translate_texts_with_groq(["abcdefghij", "xy"], "vi", ["key"]) == ["ABCDEFGHIJ", "XY"]


def test_groq_retries_count_mismatch_as_smaller_batches(monkeypatch):
    calls = []

    def fake_request(batch, lang, keys):
        calls.append(list(batch))
        if len(batch) > 1:
            raise app_module.GroqBatchShapeError("wrong count")
        return [batch[0].upper()]

    monkeypatch.setattr(app_module, "_groq_request", fake_request)
    result = app_module._groq_translate_batch_resilient(["a", "b", "c"], "Vietnamese", ["key"])

    assert result == ["A", "B", "C"]
    assert calls[0] == ["a", "b", "c"]
