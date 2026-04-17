import urllib.parse
from http.server import BaseHTTPRequestHandler

from api._lib import (
  _origin,
  _oauth_cookie_encode,
  _cookie_set,
  _b64d,
  _now_s,
  _read_app_cfg,
  exchange_code_for_token,
  extract_token_data,
  redirect,
)


class handler(BaseHTTPRequestHandler):
  def do_OPTIONS(self):
    self.send_response(204)
    self.end_headers()

  def do_GET(self):
    cfg = _read_app_cfg()
    if not cfg:
      redirect(self, "/")
      return

    p = urllib.parse.urlparse(self.path)
    q = urllib.parse.parse_qs(p.query)
    code = (q.get("code") or [None])[0]
    state = (q.get("state") or [None])[0] or ""
    tool_url = ""
    try:
      tool_url = _b64d(state)
    except Exception:
      tool_url = _origin(self) + "/"

    if not code:
      redirect(self, tool_url)
      return

    origin = _origin(self)
    redirect_uri = f"{origin}/auth/feishu/callback"
    token_resp = exchange_code_for_token(code, redirect_uri, cfg["app_id"], cfg["app_secret"])
    data = extract_token_data(token_resp)
    access_token = data.get("access_token")
    refresh_tok = data.get("refresh_token")
    expires_in = int(data.get("expires_in") or 0)
    
    import json
    if not access_token:
      err_html = f"<html><body><h3>Auth Failed</h3><p>Code: {code}</p><p>Redirect: {redirect_uri}</p><p>Resp: {json.dumps(token_resp, ensure_ascii=False)}</p></body></html>"
      self.send_response(400)
      self.send_header("Content-Type", "text/html; charset=utf-8")
      self.end_headers()
      self.wfile.write(err_html.encode("utf-8"))
      return

    rec = {
      "access_token": access_token,
      "refresh_token": refresh_tok,
      "token_type": data.get("token_type") or "Bearer",
      "scope": data.get("scope") or "",
      "obtained_at": _now_s(),
      "expires_at": _now_s() + expires_in if expires_in else 0,
    }
    cookie = _cookie_set("fs_oauth", _oauth_cookie_encode(rec), max_age_s=60 * 60 * 24 * 30)
    redirect(self, tool_url, headers={"Set-Cookie": cookie})

