import urllib.parse
from http.server import BaseHTTPRequestHandler

from api._lib import AUTHORIZATION_ENDPOINT, _origin, _b64e, _read_app_cfg, redirect


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
    tool_url = (q.get("tool_url") or [None])[0] or (_origin(self) + "/")
    state = _b64e(str(tool_url))
    origin = _origin(self)
    redirect_uri = f"{origin}/auth/feishu/callback"
    params = {
      "app_id": cfg["app_id"],
      "redirect_uri": redirect_uri,
      "state": state,
      "scope": "offline_access auth:user.id:read base:record:read base:record:create base:record:update base:record:delete base:table:read base:field:read base:field:create base:view:read",
    }
    url = f"{AUTHORIZATION_ENDPOINT}?{urllib.parse.urlencode(params)}"
    redirect(self, url)

