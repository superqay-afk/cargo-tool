import urllib.parse
from http.server import BaseHTTPRequestHandler

from api._lib import (
  _read_body,
  bitable_create_field,
  bitable_list_fields,
  ensure_access_token,
  json_send,
)


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
    field_names = body.get("field_names") or []
    if not isinstance(field_names, list) or not field_names:
      json_send(self, 400, {"ok": False, "error": "missing_field_names"})
      return
    field_type_map = body.get("field_type_map") or {}
    if not isinstance(field_type_map, dict):
      field_type_map = {}

    existing_resp = bitable_list_fields(app_token, table_id, token)
    if existing_resp.get("code") != 0:
      headers = {"Set-Cookie": cookie} if cookie else None
      json_send(self, 200, existing_resp, headers=headers)
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
      resp = bitable_create_field(app_token, table_id, token, name, ftype)
      if resp.get("code") == 0:
        created.append(name)
        existing_names.add(name)
      else:
        failed.append({"field_name": name, "detail": resp})

    headers = {"Set-Cookie": cookie} if cookie else None
    json_send(self, 200, {"ok": True, "created": created, "skipped": skipped, "failed": failed}, headers=headers)

