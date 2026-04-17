import base64
import json
import os
import time
import urllib.parse
import urllib.request
import urllib.error


FEISHU_BASE_URL = "https://open.feishu.cn"
AUTHORIZATION_ENDPOINT = "https://accounts.feishu.cn/open-apis/authen/v1/authorize"
TOKEN_ENDPOINT = f"{FEISHU_BASE_URL}/open-apis/authen/v2/oauth/token"
USERINFO_ENDPOINT = f"{FEISHU_BASE_URL}/open-apis/authen/v1/user_info"


def _now_s():
  return int(time.time())


def _env(name, default=""):
  return os.environ.get(name) or default


def _read_body(handler):
  length = int(handler.headers.get("Content-Length") or 0)
  raw = handler.rfile.read(length) if length else b"{}"
  try:
    return json.loads(raw.decode("utf-8"))
  except Exception:
    return {}


def _send(handler, status, body_bytes, content_type="application/json; charset=utf-8", headers=None):
  handler.send_response(status)
  handler.send_header("Content-Type", content_type)
  origin = handler.headers.get("Origin")
  if origin:
    handler.send_header("Access-Control-Allow-Origin", origin)
    handler.send_header("Access-Control-Allow-Credentials", "true")
  else:
    handler.send_header("Access-Control-Allow-Origin", "*")
  handler.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
  handler.send_header("Access-Control-Allow-Headers", "Content-Type,Authorization")
  if headers:
    for k, v in headers.items():
      handler.send_header(k, v)
  handler.end_headers()
  handler.wfile.write(body_bytes)


def json_send(handler, status, obj, headers=None):
  _send(handler, status, json.dumps(obj, ensure_ascii=False).encode("utf-8"), headers=headers)


def text_send(handler, status, text, headers=None):
  _send(handler, status, str(text).encode("utf-8"), content_type="text/plain; charset=utf-8", headers=headers)


def redirect(handler, url, headers=None):
  hdrs = {"Location": url}
  if headers:
    hdrs.update(headers)
  _send(handler, 302, b"", content_type="text/plain; charset=utf-8", headers=hdrs)


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


def _origin(handler):
  proto = handler.headers.get("x-forwarded-proto") or "https"
  host = handler.headers.get("host") or ""
  return f"{proto}://{host}" if host else ""


def _cookie_get(handler, name):
  raw = handler.headers.get("Cookie") or ""
  parts = [p.strip() for p in raw.split(";") if p.strip()]
  for p in parts:
    if "=" not in p:
      continue
    k, v = p.split("=", 1)
    if k.strip() == name:
      return v.strip()
  return ""


def _cookie_set(name, value, max_age_s=None, path="/", http_only=True, same_site="None"):
  secure = True
  items = [f"{name}={value}", f"Path={path}", f"SameSite={same_site}"]
  if secure:
    items.append("Secure")
  if http_only:
    items.append("HttpOnly")
  if max_age_s is not None:
    items.append(f"Max-Age={int(max_age_s)}")
  return "; ".join(items)


def _b64e(s):
  return base64.urlsafe_b64encode(s.encode("utf-8")).decode("ascii").rstrip("=")


def _b64d(s):
  pad = "=" * ((4 - (len(s) % 4)) % 4)
  return base64.urlsafe_b64decode((s + pad).encode("ascii")).decode("utf-8")


def _oauth_cookie_encode(rec):
  return _b64e(json.dumps(rec, ensure_ascii=False))


def _oauth_cookie_decode(val):
  if not val:
    return None
  try:
    return json.loads(_b64d(val))
  except Exception:
    return None


def _read_app_cfg():
  app_id = _env("FEISHU_APP_ID") or _env("FS_APP_ID")
  app_secret = _env("FEISHU_APP_SECRET") or _env("FS_APP_SECRET")
  if not app_id or not app_secret:
    return None
  return {"app_id": app_id, "app_secret": app_secret}


def exchange_code_for_token(code, redirect_uri, app_id, app_secret):
  payload = {
    "grant_type": "authorization_code",
    "client_id": app_id,
    "client_secret": app_secret,
    "code": code,
    "redirect_uri": redirect_uri,
  }
  return _http_json("POST", TOKEN_ENDPOINT, body=payload)


def refresh_token(refresh_token, app_id, app_secret):
  payload = {
    "grant_type": "refresh_token",
    "client_id": app_id,
    "client_secret": app_secret,
    "refresh_token": refresh_token,
  }
  return _http_json("POST", TOKEN_ENDPOINT, body=payload)


def extract_token_data(resp):
  if not isinstance(resp, dict):
    return {}
  if resp.get("code") == 0 and isinstance(resp.get("data"), dict):
    return resp["data"]
  return resp


def ensure_access_token(handler):
  cfg = _read_app_cfg()
  if not cfg:
    return None, None, {"error": "missing_app_config", "message": "缺少 FEISHU_APP_ID/FEISHU_APP_SECRET"}

  val = _cookie_get(handler, "fs_oauth")
  rec = _oauth_cookie_decode(val) or {}
  access_token = rec.get("access_token")
  refresh_tok = rec.get("refresh_token")
  expires_at = int(rec.get("expires_at") or 0)
  scope = rec.get("scope") or ""

  if not access_token:
    return None, None, {"error": "not_connected", "message": "未连接飞书"}

  if expires_at and expires_at - _now_s() <= 300 and refresh_tok:
    rr = refresh_token(refresh_tok, cfg["app_id"], cfg["app_secret"])
    if rr.get("code") != 0:
      return None, None, {"error": "refresh_failed", "message": rr.get("msg") or "refresh_failed", "detail": rr}
    data = extract_token_data(rr)
    access_token = data.get("access_token") or access_token
    refresh_tok = data.get("refresh_token") or refresh_tok
    expires_in = int(data.get("expires_in") or 0)
    scope = data.get("scope") or scope
    rec = {
      "access_token": access_token,
      "refresh_token": refresh_tok,
      "token_type": data.get("token_type") or "Bearer",
      "scope": scope,
      "obtained_at": _now_s(),
      "expires_at": _now_s() + expires_in if expires_in else expires_at,
    }
    cookie = _cookie_set("fs_oauth", _oauth_cookie_encode(rec), max_age_s=60 * 60 * 24 * 30)
    return access_token, cookie, None

  return access_token, None, None


def user_info(access_token):
  return _http_json("GET", USERINFO_ENDPOINT, headers={"Authorization": f"Bearer {access_token}"}, body=None)


def bitable_list_fields(app_token, table_id, access_token):
  url = f"{FEISHU_BASE_URL}/open-apis/bitable/v1/apps/{urllib.parse.quote(app_token)}/tables/{urllib.parse.quote(table_id)}/fields"
  return _http_json("GET", url, headers={"Authorization": f"Bearer {access_token}"}, body=None)


def bitable_create_field(app_token, table_id, access_token, field_name, field_type=1):
  url = f"{FEISHU_BASE_URL}/open-apis/bitable/v1/apps/{urllib.parse.quote(app_token)}/tables/{urllib.parse.quote(table_id)}/fields"
  body1 = {"field_name": field_name, "field_type": field_type}
  r1 = _http_json("POST", url, headers={"Authorization": f"Bearer {access_token}"}, body=body1)
  if isinstance(r1, dict) and r1.get("code") == 0:
    return r1
  body2 = {"field_name": field_name, "type": field_type}
  r2 = _http_json("POST", url, headers={"Authorization": f"Bearer {access_token}"}, body=body2)
  if isinstance(r2, dict) and r2.get("code") == 0:
    return r2
  return {"code": -1, "msg": "create_field_failed", "detail": {"try_field_type": r1, "try_type": r2}}


def bitable_records_search(app_token, table_id, access_token, body):
  url = f"{FEISHU_BASE_URL}/open-apis/bitable/v1/apps/{urllib.parse.quote(app_token)}/tables/{urllib.parse.quote(table_id)}/records/search"
  return _http_json("POST", url, headers={"Authorization": f"Bearer {access_token}"}, body=body)


def bitable_records_action(app_token, table_id, access_token, action, body):
  url = f"{FEISHU_BASE_URL}/open-apis/bitable/v1/apps/{urllib.parse.quote(app_token)}/tables/{urllib.parse.quote(table_id)}/records/{urllib.parse.quote(action)}"
  return _http_json("POST", url, headers={"Authorization": f"Bearer {access_token}"}, body=body)
