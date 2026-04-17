#!/bin/sh
set -e

PKG_URL="https://lf3-static.bytednsdoc.com/obj/eden-cn/ylwslo-yrh/ljhwZthlaukjlkulzlp/byted-aml-ark-helper-1.2.7.tgz"
TMP_FILE="$(mktemp /tmp/ark-helper-XXXXXX.tgz)"

cleanup() { rm -f "$TMP_FILE"; }
trap cleanup EXIT

echo "Downloading ark-helper..."
curl -fsSL -o "$TMP_FILE" "$PKG_URL"

echo "Removing old version (if any)..."
npm uninstall -g @byted-aml/ark-helper 2>/dev/null || true

echo "Installing ark-helper..."
npm install "$TMP_FILE" -g --registry https://registry.npmjs.org

echo "Done! Run 'ark-helper --version' to verify."

# --- TEA analytics (fire-and-forget) ---
tea_track() {
  # Generate device ID: macOS IOPlatformUUID / Linux machine-id / fallback hostname
  if [ "$(uname)" = "Darwin" ]; then
    RAW_ID=$(ioreg -rd1 -c IOPlatformExpertDevice 2>/dev/null | awk -F'"' '/IOPlatformUUID/{print $4}')
  elif [ -f /etc/machine-id ]; then
    RAW_ID=$(cat /etc/machine-id)
  else
    RAW_ID=$(hostname)
  fi
  # Convert to 19-digit numeric string as web_id/device_id
  DID=$(printf "%s" "$RAW_ID" | md5sum 2>/dev/null || printf "%s" "$RAW_ID" | md5)
  DID=$(printf "%s0000000000000000000" "$DID" | tr -dc '0-9' | cut -c1-19)

  NOW_MS=$(date +%s)000
  NOW_S=$(date +%s)

  SID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || echo "$(date +%s)-$$")

  curl -s -o /dev/null --max-time 5 \
    -X POST "https://mcs.zijieapi.com/list?aid=940776&sdk_version=5.3.10&device_platform=cli" \
    -H "Content-Type: application/json; charset=UTF-8" \
    -d "[{\"events\":[{\"event\":\"ark_cli_lifecycle\",\"params\":\"{\\\"type\\\":\\\"install\\\"}\",\"local_time_ms\":${NOW_MS},\"session_id\":\"${SID}\"}],\"user\":{\"user_unique_id\":\"${DID}\",\"web_id\":\"${DID}\",\"device_id\":\"${DID}\"},\"header\":{\"app_id\":940776,\"os_name\":\"$(uname)\",\"os_version\":\"$(uname -r)\",\"platform\":\"cli\",\"sdk_lib\":\"js\",\"sdk_version\":\"5.3.10\",\"timezone\":$(date +%z | awk '{print int(substr($0,1,3))}'),\"tz_offset\":$(date +%z | awk '{h=substr($0,1,3);m=substr($0,4,2);print -(h*60+m)*60}')},\"local_time\":${NOW_S},\"verbose\":1}]" \
    || true
}
tea_track &
