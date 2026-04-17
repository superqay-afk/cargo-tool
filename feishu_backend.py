import json
import os
import time
import html
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DIR = os.path.join(ROOT_DIR, ".local")
APP_CFG_PATH = os.path.join(LOCAL_DIR, "feishu_app.json")
TOKEN_PATH = os.path.join(LOCAL_DIR, "feishu_oauth.json")

FEISHU_BASE_URL = "https://open.feishu.cn"
AUTHORIZATION_ENDPOINT = "https://accounts.feishu.cn/open-apis/authen/v1/authorize"
TOKEN_ENDPOINT = f"{FEISHU_BASE_URL}/open-apis/authen/v2/oauth/token"
USERINFO_ENDPOINT = f"{FEISHU_BASE_URL}/open-apis/authen/v1/user_info"


def _json_load(path):
  try:
    with open(path, "r", encoding="utf-8") as f:
      return json.load(f)
  except FileNotFoundError:
    return None


def _json_save(path, data):
  os.makedirs(os.path.dirname(path), exist_ok=True)
  tmp = f"{path}.tmp"
  with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
  os.replace(tmp, path)


def _now_s():
  return int(time.time())


def _read_app_cfg():
  cfg = _json_load(APP_CFG_PATH) or {}
  app_id = cfg.get("app_id") or os.environ.get("FEISHU_APP_ID") or os.environ.get("FS_APP_ID")
  app_secret = cfg.get("app_secret") or os.environ.get("FEISHU_APP_SECRET") or os.environ.get("FS_APP_SECRET")
  if not app_id or not app_secret:
    return None
  return {"app_id": app_id, "app_secret": app_secret}


def _http_json(method, url, headers=None, body=None, timeout_s=20):
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
      return {"code": -1, "msg": "http_error", "http_status": e.code, "detail": j}
    except Exception:
      return {"code": -1, "msg": "http_error", "http_status": e.code, "detail": txt}


def _get_token_record():
  return _json_load(TOKEN_PATH)


def _save_token_record(rec):
  _json_save(TOKEN_PATH, rec)


def _html_page(title, lines):
  body = "".join([f"<div>{html.escape(str(x))}</div>" for x in lines])
  return (
    "<!doctype html><html><head><meta charset='utf-8'>"
    f"<title>{html.escape(str(title))}</title>"
    "</head>"
    "<body style='font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, PingFang SC, Microsoft YaHei, sans-serif; padding:24px'>"
    f"<h2>{html.escape(str(title))}</h2>"
    f"{body}"
    "</body></html>"
  )


def _auth_done_page(tool_url, ok=True, message_lines=None):
  title = "飞书授权成功" if ok else "飞书授权失败"
  lines = message_lines or []
  raw_tool_url = str(tool_url or "")
  safe_tool_url = html.escape(raw_tool_url)
  tool_url_js = json.dumps(raw_tool_url, ensure_ascii=False)
  extra = "".join([f"<div>{html.escape(str(x))}</div>" for x in lines])
  back_html = (
    f"<a id='btnBack' href='{safe_tool_url}' style='display:inline-block;padding:8px 12px;border:1px solid #ccc;border-radius:8px;text-decoration:none'>返回工作台</a>"
    if raw_tool_url
    else ""
  )
  return "".join([
    "<!doctype html><html><head><meta charset='utf-8'>",
    f"<title>{html.escape(title)}</title>",
    "</head>",
    "<body style='font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, PingFang SC, Microsoft YaHei, sans-serif; padding:24px'>",
    f"<h2>{html.escape(title)}</h2>",
    f"{extra}",
    "<div style='margin-top:12px'>",
    back_html,
    "</div>",
    "<script>",
    "try { if (window.opener) { window.opener.postMessage({type:'feishu_authed'}, '*'); } } catch (e) {}",
    f"(function(){{var url={tool_url_js}; if(!url) return; try {{ if(window.opener) return; setTimeout(function(){{ try{{ location.replace(url); }}catch(e){{}} }},200); }} catch(e){{}} }})();",
    "</script>",
    "</body></html>",
  ])


def _exchange_code_for_token(code, redirect_uri, app_id, app_secret):
  payload = {
    "grant_type": "authorization_code",
    "client_id": app_id,
    "client_secret": app_secret,
    "code": code,
    "redirect_uri": redirect_uri
  }
  return _http_json("POST", TOKEN_ENDPOINT, body=payload)


def _refresh_token(refresh_token, app_id, app_secret):
  payload = {
    "grant_type": "refresh_token",
    "client_id": app_id,
    "client_secret": app_secret,
    "refresh_token": refresh_token
  }
  return _http_json("POST", TOKEN_ENDPOINT, body=payload)

def _extract_token_data(resp):
  if not isinstance(resp, dict):
    return {}
  if resp.get("code") == 0 and isinstance(resp.get("data"), dict):
    return resp["data"]
  return resp


def _ensure_user_access_token():
  cfg = _read_app_cfg()
  if not cfg:
    return None, {"error": "missing_app_config", "message": "请在项目 .local/feishu_app.json 配置 app_id/app_secret"}

  rec = _get_token_record()
  if not rec:
    return None, {"error": "not_connected", "message": "未连接飞书，请先完成 OAuth 登录"}

  access_token = rec.get("access_token")
  refresh_token = rec.get("refresh_token")
  expires_at = int(rec.get("expires_at") or 0)

  if not access_token:
    return None, {"error": "invalid_token_store", "message": "本地 token 文件缺少 access_token"}

  if expires_at and expires_at - _now_s() <= 300 and refresh_token:
    refreshed = _refresh_token(refresh_token, cfg["app_id"], cfg["app_secret"])
    if refreshed.get("code") != 0:
      return None, {"error": "refresh_failed", "message": refreshed.get("msg") or "refresh_failed", "detail": refreshed}
    data = _extract_token_data(refreshed)
    access_token = data.get("access_token") or access_token
    refresh_token2 = data.get("refresh_token") or refresh_token
    expires_in = int(data.get("expires_in") or 0)
    rec2 = {
      "access_token": access_token,
      "refresh_token": refresh_token2,
      "token_type": data.get("token_type") or "Bearer",
      "scope": data.get("scope") or rec.get("scope"),
      "obtained_at": _now_s(),
      "expires_at": _now_s() + expires_in if expires_in else expires_at
    }
    _save_token_record({**rec, **rec2})

  return access_token, None


def _list_bitable_fields(app_token, table_id, token):
  url = f"{FEISHU_BASE_URL}/open-apis/bitable/v1/apps/{urllib.parse.quote(app_token)}/tables/{urllib.parse.quote(table_id)}/fields"
  return _http_json("GET", url, headers={"Authorization": f"Bearer {token}"}, body=None)


def _create_bitable_field(app_token, table_id, token, field_name, field_type=1):
  url = f"{FEISHU_BASE_URL}/open-apis/bitable/v1/apps/{urllib.parse.quote(app_token)}/tables/{urllib.parse.quote(table_id)}/fields"
  body1 = {"field_name": field_name, "field_type": field_type}
  r1 = _http_json("POST", url, headers={"Authorization": f"Bearer {token}"}, body=body1)
  if isinstance(r1, dict) and r1.get("code") == 0:
    return r1
  body2 = {"field_name": field_name, "type": field_type}
  r2 = _http_json("POST", url, headers={"Authorization": f"Bearer {token}"}, body=body2)
  if isinstance(r2, dict) and r2.get("code") == 0:
    return r2
  return {"code": -1, "msg": "create_field_failed", "detail": {"try_field_type": r1, "try_type": r2}}


class Handler(BaseHTTPRequestHandler):
  def _send(self, status, body_bytes, content_type="application/json; charset=utf-8"):
    self.send_response(status)
    self.send_header("Content-Type", content_type)
    origin = self.headers.get("Origin") or "*"
    self.send_header("Access-Control-Allow-Origin", origin)
    self.send_header("Access-Control-Allow-Credentials", "true")
    self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    self.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")
    self.end_headers()
    self.wfile.write(body_bytes)

  def _send_json(self, status, obj):
    self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

  def do_OPTIONS(self):
    self._send(204, b"")

  def do_GET(self):
    p = urllib.parse.urlparse(self.path)
    path = p.path
    q = urllib.parse.parse_qs(p.query)

    if path == "/":
      self._send_json(200, {"ok": True})
      return

    if path == "/auth/feishu/login":
      cfg = _read_app_cfg()
      if not cfg:
        self._send_json(400, {"ok": False, "error": "missing_app_config", "message": "请在项目 .local/feishu_app.json 配置 app_id/app_secret"})
        return
      redirect_uri = os.environ.get("FEISHU_REDIRECT_URI") or "http://localhost:8787/auth/feishu/callback"
      state = str(int(time.time() * 1000))
      params = {
        "app_id": cfg["app_id"],
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": "offline_access auth:user.id:read base:record:read base:record:create base:record:update base:record:delete base:table:read base:field:read base:field:create base:view:read"
      }
      url = f"{AUTHORIZATION_ENDPOINT}?{urllib.parse.urlencode(params)}"
      self.send_response(302)
      self.send_header("Location", url)
      self.end_headers()
      return

    if path == "/auth/feishu/callback":
      cfg = _read_app_cfg()
      if not cfg:
        self._send(400, b"missing app config", content_type="text/plain; charset=utf-8")
        return
      code = (q.get("code") or [None])[0]
      if not code:
        self._send(400, b"missing code", content_type="text/plain; charset=utf-8")
        return
      redirect_uri = os.environ.get("FEISHU_REDIRECT_URI") or "http://localhost:8787/auth/feishu/callback"
      tool_url = os.environ.get("FEISHU_TOOL_URL") or "http://127.0.0.1:8000/"
      token_resp = _exchange_code_for_token(code, redirect_uri, cfg["app_id"], cfg["app_secret"])

      if token_resp.get("code") != 0:
        if token_resp.get("code") == 20065 or token_resp.get("error") == "invalid_grant":
          rec = _get_token_record() or {}
          if rec.get("access_token") and rec.get("last_code") == code:
            html = _auth_done_page(tool_url, ok=True, message_lines=["检测到授权回调被重复打开（授权码只能使用一次）。你已完成授权，可直接关闭此页面。"])
            self._send(200, html.encode("utf-8"), content_type="text/html; charset=utf-8")
            return
          html = _auth_done_page(tool_url, ok=False, message_lines=["授权码已被使用（授权码只能使用一次）。请回到工作台点“重新授权/连接飞书”再试。"])
          self._send(400, html.encode("utf-8"), content_type="text/html; charset=utf-8")
          return

        html = _auth_done_page(tool_url, ok=False, message_lines=[f"换取 token 失败：{token_resp.get('msg') or token_resp.get('error_description') or token_resp.get('error') or 'unknown'}"])
        self._send(400, html.encode("utf-8"), content_type="text/html; charset=utf-8")
        return

      data = _extract_token_data(token_resp)
      access_token = data.get("access_token")
      refresh_token = data.get("refresh_token")
      expires_in = int(data.get("expires_in") or 0)
      if not access_token:
        html = _auth_done_page(tool_url, ok=False, message_lines=["换取 token 成功响应中缺少 access_token，请重新授权再试。"])
        self._send(400, html.encode("utf-8"), content_type="text/html; charset=utf-8")
        return
      rec = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": data.get("token_type") or "Bearer",
        "scope": data.get("scope"),
        "obtained_at": _now_s(),
        "expires_at": _now_s() + expires_in if expires_in else None,
        "last_code": code
      }
      if access_token:
        try:
          ui = _http_json("GET", USERINFO_ENDPOINT, headers={"Authorization": f"Bearer {access_token}"}, body=None)
          if ui.get("code") == 0 and ui.get("data"):
            rec["user_info"] = ui["data"]
        except Exception:
          pass
      _save_token_record(rec)
      html = _auth_done_page(tool_url, ok=True, message_lines=["你可以关闭此页面，回到工作台点击“检查连接”。"])
      self._send(200, html.encode("utf-8"), content_type="text/html; charset=utf-8")
      return

    if path == "/api/feishu/status":
      rec = _get_token_record() or {}
      ok = bool(rec.get("access_token"))
      self._send_json(200, {"connected": ok, "expires_at": rec.get("expires_at"), "user_info": rec.get("user_info"), "scope": rec.get("scope")})
      return

    if path == "/api/bitable/fields":
      app_token = (q.get("app_token") or [None])[0]
      table_id = (q.get("table_id") or [None])[0]
      if not app_token or not table_id:
        self._send_json(400, {"ok": False, "error": "missing_params"})
        return
      token, err = _ensure_user_access_token()
      if err:
        self._send_json(401, {"ok": False, **err})
        return
      resp = _list_bitable_fields(app_token, table_id, token)
      self._send_json(200, resp)
      return

    self._send_json(404, {"ok": False, "error": "not_found"})

  def do_POST(self):
    p = urllib.parse.urlparse(self.path)
    path = p.path
    q = urllib.parse.parse_qs(p.query)

    length = int(self.headers.get("Content-Length") or 0)
    raw = self.rfile.read(length) if length else b"{}"
    try:
      body = json.loads(raw.decode("utf-8"))
    except Exception:
      body = {}

    if path == "/api/feishu/logout":
      try:
        if os.path.exists(TOKEN_PATH):
          os.remove(TOKEN_PATH)
      except Exception as ex:
        self._send_json(500, {"ok": False, "error": "logout_failed", "message": str(ex)})
        return
      self._send_json(200, {"ok": True})
      return

    if path == "/api/bitable/records/search":
      app_token = (q.get("app_token") or [None])[0]
      table_id = (q.get("table_id") or [None])[0]
      if not app_token or not table_id:
        self._send_json(400, {"ok": False, "error": "missing_params"})
        return
      token, err = _ensure_user_access_token()
      if err:
        self._send_json(401, {"ok": False, **err})
        return
      url = f"{FEISHU_BASE_URL}/open-apis/bitable/v1/apps/{urllib.parse.quote(app_token)}/tables/{urllib.parse.quote(table_id)}/records/search"
      resp = _http_json("POST", url, headers={"Authorization": f"Bearer {token}"}, body=body)
      self._send_json(200, resp)
      return

    if path == "/api/bitable/fields/init":
      app_token = (q.get("app_token") or [None])[0]
      table_id = (q.get("table_id") or [None])[0]
      if not app_token or not table_id:
        self._send_json(400, {"ok": False, "error": "missing_params"})
        return
      token, err = _ensure_user_access_token()
      if err:
        self._send_json(401, {"ok": False, **err})
        return

      field_names = body.get("field_names") or []
      if not isinstance(field_names, list) or not field_names:
        self._send_json(400, {"ok": False, "error": "missing_field_names"})
        return
      field_type_map = body.get("field_type_map") or {}
      if not isinstance(field_type_map, dict):
        field_type_map = {}

      existing_resp = _list_bitable_fields(app_token, table_id, token)
      if existing_resp.get("code") != 0:
        self._send_json(200, existing_resp)
        return
      items = existing_resp.get("data", {}).get("items") or existing_resp.get("data", {}).get("fields") or []
      existing_names = {x.get("field_name") or x.get("name") for x in items}

      created = []
      skipped = []
      failed = []
      for name in [str(x).strip() for x in field_names]:
        if not name:
          continue
        if name in existing_names:
          skipped.append(name)
          continue
        ftype = int(field_type_map.get(name) or 1)
        try:
          resp = _create_bitable_field(app_token, table_id, token, name, ftype)
          if resp.get("code") == 0:
            created.append(name)
            existing_names.add(name)
          else:
            failed.append({"field_name": name, "detail": resp})
        except Exception as ex:
          failed.append({"field_name": name, "detail": str(ex)})

      self._send_json(200, {"ok": True, "created": created, "skipped": skipped, "failed": failed})
      return

    if path in ("/api/bitable/records/batch_create", "/api/bitable/records/batch_update", "/api/bitable/records/batch_delete"):
      app_token = (q.get("app_token") or [None])[0]
      table_id = (q.get("table_id") or [None])[0]
      if not app_token or not table_id:
        self._send_json(400, {"ok": False, "error": "missing_params"})
        return
      token, err = _ensure_user_access_token()
      if err:
        self._send_json(401, {"ok": False, **err})
        return
      api_action = path.split("/")[-1]
      url = f"{FEISHU_BASE_URL}/open-apis/bitable/v1/apps/{urllib.parse.quote(app_token)}/tables/{urllib.parse.quote(table_id)}/records/{api_action}"
      resp = _http_json("POST", url, headers={"Authorization": f"Bearer {token}"}, body=body)
      self._send_json(200, resp)
      return

    self._send_json(404, {"ok": False, "error": "not_found"})


def main():
  host = os.environ.get("FEISHU_BACKEND_HOST", "127.0.0.1")
  port = int(os.environ.get("FEISHU_BACKEND_PORT", "8787"))
  httpd = HTTPServer((host, port), Handler)
  print(f"Feishu backend listening on http://{host}:{port}")
  httpd.serve_forever()


if __name__ == "__main__":
  main()
