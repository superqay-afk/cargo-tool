import json
import os
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler

from api._lib import _read_body, json_send


def _http_json(method, url, headers=None, body=None, timeout_s=35):
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
    api_key = os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("BAILIAN_API_KEY") or ""
    if not api_key:
      json_send(self, 400, {"ok": False, "error": "missing_api_key", "message": "缺少 DASHSCOPE_API_KEY/BAILIAN_API_KEY"})
      return

    body = _read_body(self) or {}
    image_data_url = str(body.get("image_data_url") or "").strip()
    if not image_data_url.startswith("data:image/"):
      json_send(self, 400, {"ok": False, "error": "missing_image"})
      return

    payload = {
      "model": "qwen-vl-max",
      "messages": [
        {
          "role": "user",
          "content": [
            {"type": "text", "text": "请提取图片中的所有货源信息文字，每条货源占一行。不要输出任何多余的解释和前缀。请尽量保持原图文字内容即可。"},
            {"type": "image_url", "image_url": {"url": image_data_url}},
          ],
        }
      ],
    }

    resp = _http_json(
      "POST",
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      headers={"Authorization": f"Bearer {api_key}"},
      body=payload,
      timeout_s=60,
    )
    text = ""
    try:
      choices = resp.get("choices") or []
      if choices:
        text = (choices[0].get("message") or {}).get("content") or ""
    except Exception:
      text = ""

    if not text:
      json_send(self, 500, {"ok": False, "error": "empty_response", "detail": resp})
      return

    json_send(self, 200, {"ok": True, "text": text})
