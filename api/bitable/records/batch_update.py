import urllib.parse
from http.server import BaseHTTPRequestHandler

from api._lib import _read_body, bitable_records_action, ensure_access_token, json_send


class handler(BaseHTTPRequestHandler):
  def do_OPTIONS(self):
    self.send_response(204)
    self.end_headers()

  def do_POST(self):
    p = urllib.parse.urlparse(self.path)
    q = urllib.parse.parse_qs(p.query)
    app_token = (q.get("app_token") or [None])[0]
    table_id = (q.get("table_id") or [None])[0]
    if not app_token or not table_id:
      json_send(self, 400, {"ok": False, "error": "missing_params"})
      return
    token, cookie, err = ensure_access_token(self)
    if err:
      json_send(self, 401, {"ok": False, **err})
      return
    body = _read_body(self)
    resp = bitable_records_action(app_token, table_id, token, "batch_update", body)
    headers = {"Set-Cookie": cookie} if cookie else None
    json_send(self, 200, resp, headers=headers)

