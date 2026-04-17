import json
import os
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler

from api._lib import _read_body, json_send


def _http_json(method, url, headers=None, body=None, timeout_s=25):
  hdrs = {"Content-Type": "application/json; charset=utf-8"}
  if headers:
    hdrs.update(headers)
  data = None
  if body is not None:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
  req = urllib.request.Request(url=url, data=data, headers=hdrs, method=method)
  try:
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
      raw = resp.read()
      return json.loads(raw.decode("utf-8"))
  except urllib.error.HTTPError as e:
    raw = e.read()
    txt = raw.decode("utf-8", errors="replace") if raw else ""
    try:
      j = json.loads(txt) if txt else {}
      if isinstance(j, dict):
        return {**j, "_http_status": e.code}
      return {"error": "http_error", "http_status": e.code, "detail": j}
    except Exception:
      return {"error": "http_error", "http_status": e.code, "detail": txt}


class handler(BaseHTTPRequestHandler):
  def do_OPTIONS(self):
    self.send_response(204)
    self.end_headers()

  def do_POST(self):
    api_key = os.environ.get("DEEPSEEK_API_KEY") or ""
    if not api_key:
      json_send(self, 400, {"ok": False, "error": "missing_api_key", "message": "缺少 DEEPSEEK_API_KEY"})
      return

    body = _read_body(self) or {}
    text = str(body.get("text") or "").strip()
    system_prompt = str(body.get("system_prompt") or "").strip()
    if not text:
      json_send(self, 400, {"ok": False, "error": "missing_text"})
      return

    payload = {
      "model": "deepseek-chat",
      "messages": [],
      "response_format": {"type": "json_object"},
    }
    if system_prompt:
      payload["messages"].append({"role": "system", "content": system_prompt})
    payload["messages"].append({"role": "user", "content": text})

    resp = _http_json(
      "POST",
      "https://api.deepseek.com/chat/completions",
      headers={"Authorization": f"Bearer {api_key}"},
      body=payload,
      timeout_s=35,
    )
    content = ""
    try:
      choices = resp.get("choices") or []
      if choices:
        content = (choices[0].get("message") or {}).get("content") or ""
    except Exception:
      content = ""

    if not content:
      json_send(self, 500, {"ok": False, "error": "empty_response", "detail": resp})
      return

    try:
      data = json.loads(content)
      if not isinstance(data, dict):
        raise ValueError("not_object")
    except Exception:
      json_send(self, 500, {"ok": False, "error": "invalid_json", "raw": content})
      return

    json_send(self, 200, {"ok": True, "data": data})
