from http.server import BaseHTTPRequestHandler

from api._lib import _cookie_get, _oauth_cookie_decode, ensure_access_token, json_send, user_info


class handler(BaseHTTPRequestHandler):
  def do_OPTIONS(self):
    self.send_response(204)
    self.end_headers()

  def do_GET(self):
    token, cookie, err = ensure_access_token(self)
    if err:
      json_send(self, 200, {"connected": False, "scope": ""})
      return
    rec = _oauth_cookie_decode(_cookie_get(self, "fs_oauth")) or {}
    scope = rec.get("scope") or ""
    ui = user_info(token)
    ok = bool(ui and isinstance(ui, dict) and ui.get("code") == 0)
    headers = {"Set-Cookie": cookie} if cookie else None
    json_send(self, 200, {"connected": ok, "scope": scope, "user_info": ui.get("data") if ok else None}, headers=headers)
