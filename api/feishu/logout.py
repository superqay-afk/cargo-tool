from http.server import BaseHTTPRequestHandler

from api._lib import _cookie_set, json_send


class handler(BaseHTTPRequestHandler):
  def do_OPTIONS(self):
    self.send_response(204)
    self.end_headers()

  def do_POST(self):
    cookie = _cookie_set("fs_oauth", "", max_age_s=0)
    json_send(self, 200, {"ok": True}, headers={"Set-Cookie": cookie})

