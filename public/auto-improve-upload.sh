#!/bin/sh

# Durable transcript uploader for Codex and Claude Code hooks.
# V2 tails complete JSONL records into a local outbox before network delivery.

set -u

SOURCE="${1:-auto}"
CONFIG_FILE="${AUTO_IMPROVE_HOOK_CONFIG:-"$HOME/.auto-improve-hook.env"}"
DEFAULT_SEGMENT_URL="https://api.penelopa.ai/v2/transcript-segments"
DEFAULT_SEGMENT_MAX_BYTES=8388608
DEFAULT_DRAIN_MAX_ATTEMPTS=16
DEFAULT_DRAIN_MAX_SECONDS=40
TIMEOUT_SECONDS="${AUTO_IMPROVE_TIMEOUT_SECONDS:-15}"
FINISHED=0
STATE_LOCK_HELD=0
DRAIN_LOCK_HELD=0
NETWORK_ATTEMPTED=0

log() {
  printf '%s\n' "auto-improve hook: $*" >&2
}

finish() {
  code="${1:-0}"
  release_state_lock
  release_drain_lock
  if [ "$FINISHED" -eq 0 ] && [ "${SOURCE:-auto}" = "codex-openai" ]; then
    printf '{}\n'
  fi
  FINISHED=1
  exit "$code"
}

read_config_value() {
  key="$1"
  file="$2"
  [ -f "$file" ] || return 0
  line=$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)
  [ -n "$line" ] || return 0
  value=${line#*=}
  case "$value" in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  printf '%s' "$value"
}

json_field_python() {
  command_name="$1"
  input_file="$2"
  field_name="$3"
  "$command_name" -c '
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
value = data.get(sys.argv[2])
if value is not None:
    print(value, end="")
' "$input_file" "$field_name" 2>/dev/null
}

json_field_node() {
  input_file="$1"
  field_name="$2"
  node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8") || "{}");
const value = data[process.argv[2]];
if (value !== undefined && value !== null) process.stdout.write(String(value));
' "$input_file" "$field_name" 2>/dev/null
}

json_field_sed() {
  input_file="$1"
  field_name="$2"
  value=$(sed -n "s/.*\"${field_name}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$input_file" \
    | head -n 1 \
    | sed 's#\\/#/#g; s#\\"#"#g; s#\\\\#\\#g')
  if [ -z "$value" ]; then
    value=$(sed -n "s/.*\"${field_name}\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$input_file" \
      | head -n 1)
  fi
  printf '%s' "$value"
}

json_field() {
  input_file="$1"
  field_name="$2"
  if command -v python3 >/dev/null 2>&1; then
    json_field_python python3 "$input_file" "$field_name"
  elif command -v python >/dev/null 2>&1; then
    json_field_python python "$input_file" "$field_name"
  elif command -v node >/dev/null 2>&1; then
    json_field_node "$input_file" "$field_name"
  else
    json_field_sed "$input_file" "$field_name"
  fi
}

sha256_file() {
  target="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$target" | awk '{print $1}' | tr '[:upper:]' '[:lower:]'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$target" | awk '{print $1}' | tr '[:upper:]' '[:lower:]'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$target" | awk '{print $NF}' | tr '[:upper:]' '[:lower:]'
  else
    return 1
  fi
}

sha256_text() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}' | tr '[:upper:]' '[:lower:]'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}' | tr '[:upper:]' '[:lower:]'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 | awk '{print $NF}' | tr '[:upper:]' '[:lower:]'
  else
    return 1
  fi
}

file_size() {
  wc -c < "$1" | tr -d '[:space:]'
}

# A successful enqueue must mean that both the bytes and the directory entry
# survived a sudden power loss.  Keep this helper dependency-light: Python or
# Node provide per-path fsync, while the final fallback uses the platform sync
# command (global sync is slower, but preserves the durability guarantee).
durable_sync_paths() {
  [ "$#" -gt 0 ] || return 0
  if command -v python3 >/dev/null 2>&1; then
    python3 -c '
import os
import sys

for path in sys.argv[1:]:
    flags = os.O_RDONLY
    if os.path.isdir(path):
        flags |= getattr(os, "O_DIRECTORY", 0)
    descriptor = os.open(path, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
' "$@"
    return $?
  fi
  if command -v python >/dev/null 2>&1; then
    python -c '
import os
import sys

for path in sys.argv[1:]:
    flags = os.O_RDONLY
    if os.path.isdir(path):
        flags |= getattr(os, "O_DIRECTORY", 0)
    descriptor = os.open(path, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
' "$@"
    return $?
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
const fs = require("fs");
for (const path of process.argv.slice(1)) {
  const descriptor = fs.openSync(path, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
' "$@"
    return $?
  fi
  if command -v sync >/dev/null 2>&1; then
    first_path="$1"
    if sync -f "$first_path" >/dev/null 2>&1; then
      shift
      for sync_path in "$@"; do
        sync -f "$sync_path" >/dev/null 2>&1 || return 1
      done
      return 0
    fi
    sync
    return $?
  fi
  log "python, node, or sync is required for durable segment spooling"
  return 1
}

durable_replace_file() {
  temporary_path="$1"
  destination_path="$2"
  destination_parent=$(dirname "$destination_path")
  durable_sync_paths "$temporary_path" || return 1
  mv "$temporary_path" "$destination_path" || return 1
  durable_sync_paths "$destination_parent"
}

durable_publish_directory() {
  temporary_directory="$1"
  destination_directory="$2"
  destination_parent=$(dirname "$destination_directory")
  # Outbox items contain only regular, non-hidden files.  Sync every file before
  # the directory, then make the single atomic rename durable in its parent.
  durable_sync_paths "$temporary_directory"/* "$temporary_directory" || return 1
  mv "$temporary_directory" "$destination_directory" || return 1
  durable_sync_paths "$destination_parent"
}

file_identity() {
  target="$1"
  identity=""
  if stat_value=$(stat -f '%d:%i' "$target" 2>/dev/null); then
    identity="$stat_value"
  elif stat_value=$(stat -c '%d:%i' "$target" 2>/dev/null); then
    identity="$stat_value"
  fi
  [ -n "$identity" ] || identity="path:$canonical_path"
  printf '%s' "$identity"
}

canonicalize_path() {
  target="$1"
  directory=$(dirname "$target")
  filename=$(basename "$target")
  resolved_directory=$(CDPATH= cd "$directory" 2>/dev/null && pwd -P) || return 1
  printf '%s/%s' "$resolved_directory" "$filename"
}

next_epoch() {
  previous="$1"
  case "$previous" in
    ''|*[!0-9]*) printf '0' ;;
    *) printf '%s' $((previous + 1)) ;;
  esac
}

state_value() {
  key="$1"
  file="$2"
  sed -n "s/^${key}=//p" "$file" 2>/dev/null | head -n 1
}

write_state() {
  key="$1"
  identity="$2"
  epoch_value="$3"
  offset_value="$4"
  sequence_value="$5"
  prefix_value="$6"
  tail_value="$7"
  finalized_value="$8"
  target="$STATE_DIR/$key.state"
  temporary="$STATE_DIR/.${key}.$$.tmp"
  {
    printf 'file_id=%s\n' "$identity"
    printf 'epoch=%s\n' "$epoch_value"
    printf 'ack_offset=%s\n' "$offset_value"
    printf 'next_segment_seq=%s\n' "$sequence_value"
    printf 'ack_prefix_sha256=%s\n' "$prefix_value"
    printf 'ack_tail_sha256=%s\n' "$tail_value"
    printf 'finalized_offset=%s\n' "$finalized_value"
  } > "$temporary" || return 1
  durable_replace_file "$temporary" "$target"
}

range_prefix_hash() {
  target="$1"
  end_offset="$2"
  case "$end_offset" in ''|*[!0-9]*) return 1 ;; esac
  [ "$(file_size "$target")" -ge "$end_offset" ] || return 1
  if [ "$end_offset" -eq 0 ]; then
    printf '' | sha256_text
  else
    head -c "$end_offset" "$target" | sha256_text
  fi
}

range_tail_hash() {
  target="$1"
  end_offset="$2"
  output="$3"
  if [ "$end_offset" -le 0 ]; then
    : > "$output"
  else
    start_offset=$((end_offset - 256))
    [ "$start_offset" -ge 0 ] || start_offset=0
    count=$((end_offset - start_offset))
    dd if="$target" of="$output" bs=1 skip="$start_offset" count="$count" 2>/dev/null || return 1
  fi
  sha256_file "$output"
}

release_state_lock() {
  if [ "$STATE_LOCK_HELD" -eq 1 ]; then
    rmdir "$STATE_LOCK_DIR" 2>/dev/null || true
    STATE_LOCK_HELD=0
  fi
}

release_drain_lock() {
  if [ "$DRAIN_LOCK_HELD" -eq 1 ]; then
    rmdir "$DRAIN_LOCK_DIR" 2>/dev/null || true
    DRAIN_LOCK_HELD=0
  fi
}

acquire_state_lock() {
  key="$1"
  STATE_LOCK_DIR="$LOCKS_DIR/state-$key.lock"
  attempts=0
  while ! mkdir "$STATE_LOCK_DIR" 2>/dev/null; do
    if find "$STATE_LOCK_DIR" -prune -mmin +5 -print 2>/dev/null | grep -q .; then
      rmdir "$STATE_LOCK_DIR" 2>/dev/null || true
      continue
    fi
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 10 ]; then
      return 1
    fi
    sleep 1
  done
  STATE_LOCK_HELD=1
  return 0
}

acquire_drain_lock() {
  DRAIN_LOCK_DIR="$LOCKS_DIR/drain.lock"
  if mkdir "$DRAIN_LOCK_DIR" 2>/dev/null; then
    DRAIN_LOCK_HELD=1
    return 0
  fi
  if find "$DRAIN_LOCK_DIR" -prune -mmin +5 -print 2>/dev/null | grep -q .; then
    rmdir "$DRAIN_LOCK_DIR" 2>/dev/null || true
    if mkdir "$DRAIN_LOCK_DIR" 2>/dev/null; then
      DRAIN_LOCK_HELD=1
      return 0
    fi
  fi
  return 1
}

first_line() {
  sed -n '1p' "$1" 2>/dev/null
}

write_item_value() {
  directory="$1"
  name="$2"
  value="$3"
  printf '%s\n' "$value" > "$directory/$name"
}

item_value() {
  first_line "$1/$2"
}

retry_after_seconds() {
  headers_file="$1"
  now_value="$2"
  value=$(tr -d '\r' < "$headers_file" | awk '
    tolower($1) == "retry-after:" {
      $1 = ""; sub(/^[[:space:]]+/, ""); value = $0
    }
    END { print value }
  ')
  case "$value" in
    ''|*[!0-9]*)
      parsed_epoch=$(date -d "$value" +%s 2>/dev/null || true)
      if [ -z "$parsed_epoch" ]; then
        parsed_epoch=$(date -j -f '%a, %d %b %Y %T GMT' "$value" +%s 2>/dev/null || true)
      fi
      if [ -n "$parsed_epoch" ] && [ "$parsed_epoch" -gt "$now_value" ]; then
        printf '%s' $((parsed_epoch - now_value))
      fi
      ;;
    *) printf '%s' "$value" ;;
  esac
}

schedule_retry() {
  item="$1"
  headers_file="$2"
  http_code="$3"
  attempts=$(item_value "$item" attempts)
  case "$attempts" in ''|*[!0-9]*) attempts=0 ;; esac
  attempts=$((attempts + 1))
  delay=5
  counter=1
  while [ "$counter" -lt "$attempts" ] && [ "$delay" -lt 300 ]; do
    delay=$((delay * 2))
    [ "$delay" -le 300 ] || delay=300
    counter=$((counter + 1))
  done
  now_value=$(date +%s)
  if [ "$http_code" = "429" ]; then
    server_delay=$(retry_after_seconds "$headers_file" "$now_value")
    case "$server_delay" in
      ''|*[!0-9]*) ;;
      *) [ "$server_delay" -le "$delay" ] || delay="$server_delay" ;;
    esac
  fi
  write_item_value "$item" attempts "$attempts"
  write_item_value "$item" next_attempt_at $((now_value + delay))
}

success_response_python() {
  command_name="$1"
  response_file="$2"
  expected_offset="$3"
  expected_sha="$4"
  "$command_name" -c '
import json
import sys

try:
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        data = json.load(handle)
except (OSError, UnicodeError, json.JSONDecodeError):
    raise SystemExit(1)

offset = data.get("accepted_offset") if isinstance(data, dict) else None
valid = (
    isinstance(data, dict)
    and isinstance(data.get("segment_id"), str)
    and bool(data["segment_id"].strip())
    and isinstance(offset, int)
    and not isinstance(offset, bool)
    and offset == int(sys.argv[2])
    and isinstance(data.get("segment_sha256"), str)
    and data["segment_sha256"].lower() == sys.argv[3]
)
raise SystemExit(0 if valid else 1)
' "$response_file" "$expected_offset" "$expected_sha" 2>/dev/null
}

success_response_node() {
  response_file="$1"
  expected_offset="$2"
  expected_sha="$3"
  node -e '
const fs = require("fs");
let data;
try {
  data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
} catch (_) {
  process.exit(1);
}
const segmentId = data && data.segment_id;
const offset = data && data.accepted_offset;
const sha = data && data.segment_sha256;
const valid = typeof segmentId === "string" && segmentId.trim().length > 0
  && Number.isSafeInteger(offset) && offset === Number(process.argv[2])
  && typeof sha === "string" && sha.toLowerCase() === process.argv[3];
process.exit(valid ? 0 : 1);
' "$response_file" "$expected_offset" "$expected_sha" 2>/dev/null
}

success_response_is_valid() {
  item="$1"
  response_file="$2"
  [ -s "$response_file" ] || return 1
  expected_offset=$(item_value "$item" byte_end)
  expected_sha=$(item_value "$item" segment_sha256 | tr '[:upper:]' '[:lower:]')
  case "$expected_offset" in ''|*[!0-9]*) return 1 ;; esac
  if command -v python3 >/dev/null 2>&1; then
    success_response_python python3 "$response_file" "$expected_offset" "$expected_sha"
  elif command -v python >/dev/null 2>&1; then
    success_response_python python "$response_file" "$expected_offset" "$expected_sha"
  elif command -v node >/dev/null 2>&1; then
    success_response_node "$response_file" "$expected_offset" "$expected_sha"
  else
    log "strict JSON acknowledgement validation requires python3, python, or node; retained in durable outbox"
    return 1
  fi
}

quarantine_item() {
  item="$1"
  http_code="$2"
  response_file="$3"
  mkdir -p "$QUARANTINE_DIR" || return 1
  item_name=$(basename "$item")
  quarantine_name="quarantined-${item_name#pending-}"
  destination="$QUARANTINE_DIR/$quarantine_name"
  [ ! -e "$destination" ] || destination="$destination.$(date +%s).$$"
  write_item_value "$item" quarantine_http_status "$http_code" || return 1
  write_item_value "$item" quarantined_at "$(date +%s)" || return 1
  if [ -f "$response_file" ]; then
    # Keep the bounded server explanation for operator diagnosis. It never
    # contains the bearer token or the transcript upload body.
    head -c 65536 "$response_file" > "$item/quarantine_response.json" 2>/dev/null || true
  fi
  durable_sync_paths "$item"/* "$item" || return 1
  mv "$item" "$destination" || return 1
  durable_sync_paths "$OUTBOX_DIR" "$QUARANTINE_DIR" || return 1
  log "segment rejected permanently (HTTP $http_code); quarantined at $destination"
}

advance_state_for_item() {
  item="$1"
  key=$(item_value "$item" state_key)
  item_epoch=$(item_value "$item" epoch)
  byte_start=$(item_value "$item" byte_start)
  byte_end=$(item_value "$item" byte_end)
  segment_seq=$(item_value "$item" segment_seq)
  prefix_sha=$(item_value "$item" ack_prefix_sha256)
  tail_sha=$(item_value "$item" ack_tail_sha256)
  final_value=$(item_value "$item" is_final)
  state_file="$STATE_DIR/$key.state"
  [ -f "$state_file" ] || return 0
  current_epoch=$(state_value epoch "$state_file")
  current_offset=$(state_value ack_offset "$state_file")
  [ "$current_epoch" = "$item_epoch" ] || return 0
  [ "$current_offset" = "$byte_start" ] || return 0
  identity=$(state_value file_id "$state_file")
  finalized_offset=$(state_value finalized_offset "$state_file")
  case "$finalized_offset" in -1) ;; ''|*[!0-9]*) finalized_offset=-1 ;; esac
  if [ "$final_value" = "true" ]; then
    finalized_offset="$byte_end"
  fi
  [ -n "$prefix_sha" ] || return 1
  write_state "$key" "$identity" "$item_epoch" "$byte_end" $((segment_seq + 1)) "$prefix_sha" "$tail_sha" "$finalized_offset"
}

send_outbox_item() {
  item="$1"
  item_timeout="${2:-$TIMEOUT_SECONDS}"
  NETWORK_ATTEMPTED=0
  if [ -z "$token" ] || ! command -v curl >/dev/null 2>&1; then
    return 1
  fi
  next_attempt=$(item_value "$item" next_attempt_at)
  case "$next_attempt" in ''|*[!0-9]*) next_attempt=0 ;; esac
  now_value=$(date +%s)
  [ "$now_value" -ge "$next_attempt" ] || return 2

  item_state_key=$(item_value "$item" state_key)
  item_epoch=$(item_value "$item" epoch)
  item_start=$(item_value "$item" byte_start)
  item_end=$(item_value "$item" byte_end)
  item_state_file="$STATE_DIR/$item_state_key.state"
  if [ -f "$item_state_file" ] && [ "$(state_value epoch "$item_state_file")" = "$item_epoch" ]; then
    acknowledged=$(state_value ack_offset "$item_state_file")
    item_is_final=$(item_value "$item" is_final)
    is_final_marker=0
    if [ "$item_is_final" = "true" ] && [ "$item_start" -eq "$item_end" ]; then
      is_final_marker=1
    fi
    if [ "$is_final_marker" -eq 1 ] \
      && [ "$(state_value finalized_offset "$item_state_file")" = "$item_end" ]; then
      rm -rf "$item"
      return 0
    fi
    if [ "$is_final_marker" -eq 0 ] && [ "$acknowledged" -ge "$item_end" ]; then
      rm -rf "$item"
      return 0
    fi
    # Preserve order within an epoch. A later segment must not be deleted merely
    # because the server accepted it before its predecessor.
    [ "$acknowledged" -eq "$item_start" ] || return 2
  fi

  headers_file="$WORK_DIR/headers.$$.tmp"
  response_file="$WORK_DIR/response.$$.tmp"
  curl_exit=0
  NETWORK_ATTEMPTED=1
  http_code=$(curl \
    --silent \
    --show-error \
    --max-time "$item_timeout" \
    --output "$response_file" \
    --dump-header "$headers_file" \
    --write-out '%{http_code}' \
    --request POST "$(item_value "$item" url)" \
    --header "Authorization: Bearer $token" \
    --header "Idempotency-Key: $(item_value "$item" idempotency_key)" \
    --form-string "source=$(item_value "$item" source)" \
    --form-string "project_id=$(item_value "$item" project_id)" \
    --form-string "external_session_id=$(item_value "$item" external_session_id)" \
    --form-string "epoch=$(item_value "$item" epoch)" \
    --form-string "segment_seq=$(item_value "$item" segment_seq)" \
    --form-string "byte_start=$(item_value "$item" byte_start)" \
    --form-string "byte_end=$(item_value "$item" byte_end)" \
    --form-string "segment_sha256=$(item_value "$item" segment_sha256)" \
    --form-string "source_schema_version=$(item_value "$item" source_schema_version)" \
    --form-string "is_final=$(item_value "$item" is_final)" \
    --form-string "metadata=$(item_value "$item" metadata)" \
    --form "segment=@$item/segment.jsonl;type=application/x-ndjson" \
    2>/dev/null) || curl_exit=$?

  invalid_ack=0
  local_commit_deferred=0
  case "$http_code" in
    2??)
      if [ "$curl_exit" -eq 0 ]; then
        if success_response_is_valid "$item" "$response_file"; then
          if [ -n "$item_state_key" ] && acquire_state_lock "$item_state_key"; then
            if advance_state_for_item "$item"; then
              rm -rf "$item"
              release_state_lock
              rm -f "$headers_file" "$response_file"
              return 0
            fi
            release_state_lock
          fi
          local_commit_deferred=1
        fi
        if [ "$local_commit_deferred" -eq 0 ]; then
          invalid_ack=1
        fi
      fi
      ;;
    409|413|415|422)
      if [ "$curl_exit" -eq 0 ]; then
        if [ -n "$item_state_key" ] && acquire_state_lock "$item_state_key"; then
          if quarantine_item "$item" "$http_code" "$response_file"; then
            release_state_lock
            rm -f "$headers_file" "$response_file"
            return 3
          fi
          release_state_lock
        fi
        local_commit_deferred=1
      fi
      ;;
  esac
  [ -f "$headers_file" ] || : > "$headers_file"
  schedule_retry "$item" "$headers_file" "${http_code:-000}"
  if [ "$local_commit_deferred" -eq 1 ]; then
    log "server response was conclusive but local state was busy; retained for idempotent retry"
  elif [ "$invalid_ack" -eq 1 ]; then
    log "segment upload returned an invalid acknowledgement; retained in durable outbox"
  elif [ "${http_code:-000}" = "429" ]; then
    log "segment upload rate-limited; retained in durable outbox"
  else
    log "segment upload deferred (HTTP ${http_code:-000}, curl $curl_exit)"
  fi
  rm -f "$headers_file" "$response_file"
  return 1
}

build_pending_order() {
  manifest_file="$1"
  ordered_file="$2"
  : > "$manifest_file" || return 1
  for pending_item in "$OUTBOX_DIR"/pending-*; do
    [ -d "$pending_item" ] || continue
    pending_name=$(basename "$pending_item")
    pending_key=$(item_value "$pending_item" state_key)
    pending_epoch=$(item_value "$pending_item" epoch)
    pending_sequence=$(item_value "$pending_item" segment_seq)
    case "$pending_epoch:$pending_sequence" in
      *[!0-9:]*) pending_key="" ;;
    esac
    if [ -n "$pending_key" ]; then
      pending_sort_key="k:$pending_key"
    else
      # Corrupt items sort last and remain fail-closed; the generated basename
      # makes their order stable without consulting wall-clock mtimes.
      pending_sort_key="z:$pending_name"
      pending_epoch=0
      pending_sequence=0
    fi
    printf '%s|%s|%s|%s\n' \
      "$pending_sort_key" "$pending_epoch" "$pending_sequence" "$pending_name" \
      >> "$manifest_file"
  done
  LC_ALL=C sort -t '|' -k1,1 -k2,2n -k3,3n -k4,4 "$manifest_file" > "$ordered_file" \
    || return 1

  drain_cursor=$(first_line "$DRAIN_CURSOR_FILE")
  [ -n "$drain_cursor" ] || return 0
  rotated_file="$ordered_file.rotated"
  awk -F '|' -v cursor="$drain_cursor" '$1 > cursor' "$ordered_file" > "$rotated_file" \
    || return 1
  awk -F '|' -v cursor="$drain_cursor" '$1 <= cursor' "$ordered_file" >> "$rotated_file" \
    || return 1
  mv "$rotated_file" "$ordered_file"
}

persist_drain_cursor() {
  cursor_value="$1"
  cursor_temporary="$DRAIN_CURSOR_FILE.$$.tmp"
  printf '%s\n' "$cursor_value" > "$cursor_temporary" || return 1
  durable_replace_file "$cursor_temporary" "$DRAIN_CURSOR_FILE"
}

drain_outbox() {
  blocked_keys="$WORK_DIR/blocked-keys.$$.tmp"
  manifest_file="$WORK_DIR/pending-manifest.$$.tmp"
  ordered_file="$WORK_DIR/pending-order.$$.tmp"
  : > "$blocked_keys" || return 1
  build_pending_order "$manifest_file" "$ordered_file" || return 1
  drain_result=0
  network_attempts=0
  drain_started_at=$(date +%s)
  while IFS='|' read -r sort_key _item_epoch _item_sequence item_name; do
    [ -n "$item_name" ] || continue
    item="$OUTBOX_DIR/$item_name"
    [ -d "$item" ] || continue
    touch "$DRAIN_LOCK_DIR" 2>/dev/null || true
    item_key=$(item_value "$item" state_key)
    block_key="${item_key:-$sort_key}"
    if grep -F -x -q "$block_key" "$blocked_keys" 2>/dev/null; then
      continue
    fi

    elapsed=$(( $(date +%s) - drain_started_at ))
    remaining_seconds=$((drain_max_seconds - elapsed))
    if [ "$network_attempts" -ge "$drain_max_attempts" ] \
      || [ "$remaining_seconds" -le 0 ]; then
      log "outbox drain budget exhausted; remaining segments stay durable for a later hook"
      break
    fi
    item_timeout="$TIMEOUT_SECONDS"
    [ "$item_timeout" -le "$remaining_seconds" ] || item_timeout="$remaining_seconds"
    [ "$item_timeout" -ge 1 ] || item_timeout=1

    send_outbox_item "$item" "$item_timeout"
    result=$?
    if [ "$NETWORK_ATTEMPTED" -eq 1 ]; then
      network_attempts=$((network_attempts + 1))
      persist_drain_cursor "$sort_key" || true
    fi
    if [ "$result" -ne 0 ]; then
      drain_result="$result"
      printf '%s\n' "$block_key" >> "$blocked_keys"
    fi
  done < "$ordered_file"
  rm -f "$blocked_keys" "$manifest_file" "$ordered_file" "$ordered_file.rotated"
  return "$drain_result"
}

pending_cursor() {
  key="$1"
  epoch_value="$2"
  cursor_offset="$3"
  cursor_sequence="$4"
  cursor_prefix_sha="$5"
  cursor_tail_sha="$6"
  cursor_finalized_offset="$7"
  for item in "$OUTBOX_DIR"/pending-* "$QUARANTINE_DIR"/quarantined-*; do
    [ -d "$item" ] || continue
    [ "$(item_value "$item" state_key)" = "$key" ] || continue
    [ "$(item_value "$item" epoch)" = "$epoch_value" ] || continue
    pending_end=$(item_value "$item" byte_end)
    pending_seq=$(item_value "$item" segment_seq)
    case "$pending_end:$pending_seq" in *[!0-9:]*) continue ;; esac
    if [ "$(item_value "$item" is_final)" = "true" ]; then
      case "$cursor_finalized_offset" in -1) ;; ''|*[!0-9]*) cursor_finalized_offset=-1 ;; esac
      if [ "$pending_end" -gt "$cursor_finalized_offset" ]; then
        cursor_finalized_offset="$pending_end"
      fi
    fi
    if [ "$pending_end" -gt "$cursor_offset" ] \
      || { [ "$pending_end" -eq "$cursor_offset" ] && [ "$pending_seq" -ge "$cursor_sequence" ]; }; then
      cursor_offset="$pending_end"
      cursor_sequence=$((pending_seq + 1))
      cursor_prefix_sha=$(item_value "$item" ack_prefix_sha256)
      cursor_tail_sha=$(item_value "$item" ack_tail_sha256)
    fi
  done
  SPOOL_OFFSET="$cursor_offset"
  SPOOL_SEQUENCE="$cursor_sequence"
  SPOOL_PREFIX_SHA="$cursor_prefix_sha"
  SPOOL_TAIL_SHA="$cursor_tail_sha"
  SPOOL_FINALIZED_OFFSET="$cursor_finalized_offset"
}

enqueue_segment() {
  complete_file="$1"
  byte_start="$2"
  byte_end="$3"
  sequence="$4"
  final_value="$5"
  fragment_value="${6:-false}"
  segment_sha=$(sha256_file "$complete_file") || return 1
  key_material="$SOURCE|$project_id|$session_id|$epoch|$sequence|$byte_start|$byte_end|$segment_sha"
  idempotency_key=$(printf '%s' "$key_material" | sha256_text) || return 1
  prefix_sha=$(range_prefix_hash "$transcript_path" "$byte_end") || return 1
  tail_file="$WORK_DIR/tail.$$.tmp"
  tail_sha=$(range_tail_hash "$transcript_path" "$byte_end" "$tail_file") || return 1
  timestamp=$(date +%s)
  temporary="$OUTBOX_DIR/.tmp-$timestamp-$$-$sequence"
  padded_start=$(printf '%020d' "$byte_start")
  item="$OUTBOX_DIR/pending-$timestamp-$padded_start-$idempotency_key"
  mkdir "$temporary" || return 1
  if ! cp "$complete_file" "$temporary/segment.jsonl" \
    || ! write_item_value "$temporary" url "$url" \
    || ! write_item_value "$temporary" idempotency_key "$idempotency_key" \
    || ! write_item_value "$temporary" source "$SOURCE" \
    || ! write_item_value "$temporary" project_id "$project_id" \
    || ! write_item_value "$temporary" external_session_id "$session_id" \
    || ! write_item_value "$temporary" epoch "$epoch" \
    || ! write_item_value "$temporary" segment_seq "$sequence" \
    || ! write_item_value "$temporary" byte_start "$byte_start" \
    || ! write_item_value "$temporary" byte_end "$byte_end" \
    || ! write_item_value "$temporary" segment_sha256 "$segment_sha" \
    || ! write_item_value "$temporary" source_schema_version "$source_schema_version" \
    || ! write_item_value "$temporary" is_final "$final_value" \
    || ! write_item_value "$temporary" metadata "{\"transport_record_fragment\":$fragment_value,\"fragment_byte_start\":$byte_start,\"fragment_byte_end\":$byte_end}" \
    || ! write_item_value "$temporary" state_key "$state_key" \
    || ! write_item_value "$temporary" ack_prefix_sha256 "$prefix_sha" \
    || ! write_item_value "$temporary" ack_tail_sha256 "$tail_sha" \
    || ! write_item_value "$temporary" attempts 0 \
    || ! write_item_value "$temporary" next_attempt_at 0 \
    || ! durable_publish_directory "$temporary" "$item"; then
    rm -rf "$temporary"
    rm -f "$tail_file"
    return 1
  fi
  rm -f "$tail_file"
}

tmp_input=$(mktemp "${TMPDIR:-/tmp}/auto-improve-hook-input.XXXXXX") || finish 0
trap 'rm -f "$tmp_input" "${candidate_file:-}" "${complete_file:-}" "${final_marker:-}"; release_state_lock; release_drain_lock' EXIT INT TERM
cat > "$tmp_input"

hook_event_name=$(json_field "$tmp_input" hook_event_name)
case "$hook_event_name" in
  Stop|SessionEnd) ;;
  *) finish 0 ;;
esac

transcript_path=$(json_field "$tmp_input" transcript_path)
if [ -z "$transcript_path" ] || [ ! -f "$transcript_path" ]; then
  log "transcript_path is missing or unreadable"
  finish 0
fi

if [ "$SOURCE" = "auto" ]; then
  case "$transcript_path" in
    *"/.claude/"*) SOURCE="claude-anthropic" ;;
    *) SOURCE="codex-openai" ;;
  esac
fi
case "$SOURCE" in
  codex-openai|claude-anthropic) ;;
  *) log "unsupported source: $SOURCE"; finish 0 ;;
esac

AUTO_IMPROVE_URL="${AUTO_IMPROVE_URL:-$(read_config_value AUTO_IMPROVE_URL "$CONFIG_FILE")}"
AUTO_IMPROVE_TOKEN="${AUTO_IMPROVE_TOKEN:-$(read_config_value AUTO_IMPROVE_TOKEN "$CONFIG_FILE")}"
AUTO_IMPROVE_PROJECT_ID="${AUTO_IMPROVE_PROJECT_ID:-$(read_config_value AUTO_IMPROVE_PROJECT_ID "$CONFIG_FILE")}"
AUTO_IMPROVE_UPLOAD_MODE="${AUTO_IMPROVE_UPLOAD_MODE:-$(read_config_value AUTO_IMPROVE_UPLOAD_MODE "$CONFIG_FILE")}"
AUTO_IMPROVE_DATA_DIR="${AUTO_IMPROVE_DATA_DIR:-$(read_config_value AUTO_IMPROVE_DATA_DIR "$CONFIG_FILE")}"
AUTO_IMPROVE_SOURCE_SCHEMA_VERSION="${AUTO_IMPROVE_SOURCE_SCHEMA_VERSION:-$(read_config_value AUTO_IMPROVE_SOURCE_SCHEMA_VERSION "$CONFIG_FILE")}"
AUTO_IMPROVE_SEGMENT_MAX_BYTES="${AUTO_IMPROVE_SEGMENT_MAX_BYTES:-$(read_config_value AUTO_IMPROVE_SEGMENT_MAX_BYTES "$CONFIG_FILE")}"
AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS="${AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS:-$(read_config_value AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS "$CONFIG_FILE")}"
AUTO_IMPROVE_DRAIN_MAX_SECONDS="${AUTO_IMPROVE_DRAIN_MAX_SECONDS:-$(read_config_value AUTO_IMPROVE_DRAIN_MAX_SECONDS "$CONFIG_FILE")}"

upload_mode="${AUTO_IMPROVE_UPLOAD_MODE:-segments}"
case "$upload_mode" in
  delta) upload_mode="segments" ;;
  segments) ;;
  full) log "legacy full upload mode has been removed; use v2 segments"; finish 0 ;;
  *) log "unsupported upload mode: $upload_mode"; finish 0 ;;
esac
if [ -n "${AUTO_IMPROVE_URL:-}" ]; then
  url="$AUTO_IMPROVE_URL"
else
  url="$DEFAULT_SEGMENT_URL"
fi
token="${AUTO_IMPROVE_TOKEN:-}"
source_schema_version="${AUTO_IMPROVE_SOURCE_SCHEMA_VERSION:-${SOURCE}-jsonl-v1}"
segment_max_bytes="${AUTO_IMPROVE_SEGMENT_MAX_BYTES:-$DEFAULT_SEGMENT_MAX_BYTES}"
drain_max_attempts="${AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS:-$DEFAULT_DRAIN_MAX_ATTEMPTS}"
drain_max_seconds="${AUTO_IMPROVE_DRAIN_MAX_SECONDS:-$DEFAULT_DRAIN_MAX_SECONDS}"
case "$segment_max_bytes" in
  ''|*[!0-9]*|0) log "AUTO_IMPROVE_SEGMENT_MAX_BYTES must be a positive integer"; finish 0 ;;
esac
case "$drain_max_attempts" in
  ''|*[!0-9]*|0) log "AUTO_IMPROVE_DRAIN_MAX_ATTEMPTS must be a positive integer"; finish 0 ;;
esac
case "$drain_max_seconds" in
  ''|*[!0-9]*|0) log "AUTO_IMPROVE_DRAIN_MAX_SECONDS must be a positive integer"; finish 0 ;;
esac

cwd_value=$(json_field "$tmp_input" cwd)
session_id=$(json_field "$tmp_input" session_id)
if [ -n "${AUTO_IMPROVE_PROJECT_ID:-}" ]; then
  project_id="$AUTO_IMPROVE_PROJECT_ID"
elif [ -n "$cwd_value" ]; then
  project_id=$(basename "$cwd_value")
else
  project_id="unknown-project"
fi

if ! command -v sha256sum >/dev/null 2>&1 \
  && ! command -v shasum >/dev/null 2>&1 \
  && ! command -v openssl >/dev/null 2>&1; then
  log "sha256sum, shasum, or openssl is required for segment uploads"
  finish 0
fi

umask 077
BASE_DIR="${AUTO_IMPROVE_DATA_DIR:-$HOME/.auto-improve}"
STATE_DIR="$BASE_DIR/state"
OUTBOX_DIR="$BASE_DIR/outbox"
QUARANTINE_DIR="$OUTBOX_DIR/quarantine"
WORK_DIR="$BASE_DIR/work"
LOCKS_DIR="$BASE_DIR/locks"
DRAIN_CURSOR_FILE="$OUTBOX_DIR/.drain-cursor"
mkdir -p "$STATE_DIR" "$OUTBOX_DIR" "$QUARANTINE_DIR" "$WORK_DIR" "$LOCKS_DIR" || finish 0
if ! durable_sync_paths \
  "$STATE_DIR" "$QUARANTINE_DIR" "$OUTBOX_DIR" "$WORK_DIR" "$LOCKS_DIR" \
  "$BASE_DIR" "$(dirname "$BASE_DIR")"; then
  log "could not make local spool directories durable"
  finish 0
fi

canonical_path=$(canonicalize_path "$transcript_path") || canonical_path="$transcript_path"
logical_session="${session_id:-$canonical_path}"
session_id="$logical_session"
state_key=$(printf '%s' "$SOURCE|$logical_session|$canonical_path" | sha256_text) || finish 0
if ! acquire_state_lock "$state_key"; then
  if [ "$hook_event_name" = "SessionEnd" ]; then
    log "SessionEnd snapshot could not acquire its local state lock; source bytes remain unspooled and require a later hook invocation"
  else
    log "transcript snapshot could not acquire its local state lock; a later hook will retry"
  fi
  finish 0
fi

# Snapshot the current local transcript before any potentially slow network I/O.
current_size=$(file_size "$transcript_path")
file_id=$(file_identity "$transcript_path")
state_file="$STATE_DIR/$state_key.state"
tail_probe="$WORK_DIR/state-tail.$$.tmp"

reset_state=0
if [ -f "$state_file" ]; then
  saved_file_id=$(state_value file_id "$state_file")
  epoch=$(state_value epoch "$state_file")
  ack_offset=$(state_value ack_offset "$state_file")
  next_sequence=$(state_value next_segment_seq "$state_file")
  saved_prefix_sha=$(state_value ack_prefix_sha256 "$state_file")
  saved_tail_sha=$(state_value ack_tail_sha256 "$state_file")
  saved_finalized_offset=$(state_value finalized_offset "$state_file")
  case "$saved_finalized_offset" in -1) ;; ''|*[!0-9]*) saved_finalized_offset=-1 ;; esac
  case "$epoch:$ack_offset:$next_sequence" in *[!0-9:]*) reset_state=1 ;; esac
  [ -n "$saved_prefix_sha" ] || reset_state=1
  [ "$saved_file_id" = "$file_id" ] || reset_state=1
  if [ "$reset_state" -eq 0 ] && [ "$current_size" -lt "$ack_offset" ]; then
    reset_state=1
  fi
  if [ "$reset_state" -eq 0 ]; then
    current_prefix_sha=$(range_prefix_hash "$transcript_path" "$ack_offset" || true)
    [ "$current_prefix_sha" = "$saved_prefix_sha" ] || reset_state=1
  fi
else
  reset_state=1
fi

if [ "$reset_state" -eq 1 ]; then
  previous_epoch=""
  if [ -f "$state_file" ]; then
    previous_epoch=$(state_value epoch "$state_file")
  fi
  epoch=$(next_epoch "$previous_epoch")
  ack_offset=0
  next_sequence=0
  empty_prefix=$(range_prefix_hash "$transcript_path" 0) || finish 0
  empty_tail=$(range_tail_hash "$transcript_path" 0 "$tail_probe") || finish 0
  saved_prefix_sha="$empty_prefix"
  saved_tail_sha="$empty_tail"
  saved_finalized_offset=-1
  write_state "$state_key" "$file_id" "$epoch" 0 0 "$empty_prefix" "$empty_tail" -1 || finish 0
fi

pending_cursor "$state_key" "$epoch" "$ack_offset" "$next_sequence" "$saved_prefix_sha" "$saved_tail_sha" "$saved_finalized_offset"
spool_snapshot_invalid=0
if [ "$current_size" -lt "$SPOOL_OFFSET" ]; then
  spool_snapshot_invalid=1
elif [ "$SPOOL_OFFSET" -gt "$ack_offset" ]; then
  if [ -z "$SPOOL_PREFIX_SHA" ]; then
    spool_snapshot_invalid=1
  else
    current_spool_prefix=$(range_prefix_hash "$transcript_path" "$SPOOL_OFFSET" || true)
    [ "$current_spool_prefix" = "$SPOOL_PREFIX_SHA" ] || spool_snapshot_invalid=1
  fi
fi
if [ "$spool_snapshot_invalid" -eq 1 ]; then
  # Unacknowledged bytes remain deliverable under the old epoch.
  epoch=$(next_epoch "$epoch")
  ack_offset=0
  next_sequence=0
  empty_prefix=$(range_prefix_hash "$transcript_path" 0) || finish 0
  empty_tail=$(range_tail_hash "$transcript_path" 0 "$tail_probe") || finish 0
  saved_prefix_sha="$empty_prefix"
  saved_finalized_offset=-1
  write_state "$state_key" "$file_id" "$epoch" 0 0 "$empty_prefix" "$empty_tail" -1 || finish 0
  SPOOL_OFFSET=0
  SPOOL_SEQUENCE=0
  SPOOL_PREFIX_SHA="$empty_prefix"
  SPOOL_FINALIZED_OFFSET=-1
fi

spool_offset="$SPOOL_OFFSET"
spool_sequence="$SPOOL_SEQUENCE"
while [ "$current_size" -gt "$spool_offset" ]; do
  candidate_file="$WORK_DIR/candidate.$$.tmp"
  complete_file="$WORK_DIR/complete.$$.tmp"
  remaining_bytes=$((current_size - spool_offset))
  read_limit="$segment_max_bytes"
  [ "$remaining_bytes" -ge "$read_limit" ] || read_limit="$remaining_bytes"
  tail -c "+$((spool_offset + 1))" "$transcript_path" 2>/dev/null \
    | head -c "$read_limit" > "$candidate_file" || finish 0
  candidate_size=$(file_size "$candidate_file")
  [ "$candidate_size" -gt 0 ] || break
  starts_inside_record=false
  if [ "$spool_offset" -gt 0 ]; then
    previous_byte=$(dd if="$transcript_path" bs=1 skip=$((spool_offset - 1)) count=1 2>/dev/null \
      | od -An -tu1 | tr -d '[:space:]')
    [ "$previous_byte" = "10" ] || starts_inside_record=true
  fi
  newline_count=$(tr -cd '\n' < "$candidate_file" | wc -c | tr -d '[:space:]')
  last_byte=$(tail -c 1 "$candidate_file" | od -An -tu1 | tr -d '[:space:]')
  record_fragment=false
  if [ "$starts_inside_record" = "true" ] && [ "$newline_count" -gt 0 ]; then
    # Keep an oversized-record continuation isolated from later valid JSONL
    # records so the parser can explicitly classify only this segment.
    sed -n '1p' "$candidate_file" > "$complete_file"
    record_fragment=true
  elif [ "$starts_inside_record" = "true" ] \
    && { [ "$remaining_bytes" -gt "$segment_max_bytes" ] \
      || [ "$hook_event_name" = "SessionEnd" ]; }; then
    cp "$candidate_file" "$complete_file"
    record_fragment=true
  elif [ "$last_byte" = "10" ]; then
    cp "$candidate_file" "$complete_file"
  elif [ "$newline_count" -gt 0 ]; then
    sed '$d' "$candidate_file" > "$complete_file"
  elif [ "$remaining_bytes" -gt "$segment_max_bytes" ]; then
    # A single JSONL record is larger than the transport limit. Preserve its
    # exact bytes in bounded raw fragments instead of blocking all later data.
    cp "$candidate_file" "$complete_file"
    record_fragment=true
  elif [ "$hook_event_name" = "SessionEnd" ] \
    && [ $((spool_offset + candidate_size)) -eq "$current_size" ]; then
    # JSONL permits the final JSON value to end at EOF without a trailing LF.
    # Stop hooks still wait because the writer may merely be between writes.
    cp "$candidate_file" "$complete_file"
  else
    : > "$complete_file"
  fi
  complete_size=$(file_size "$complete_file")
  [ "$complete_size" -gt 0 ] || break
  byte_end=$((spool_offset + complete_size))
  is_final=false
  if [ "$hook_event_name" = "SessionEnd" ] && [ "$byte_end" -eq "$current_size" ]; then
    is_final=true
  fi
  if [ "$record_fragment" = "true" ]; then
    log "oversized JSONL record preserved as transport fragment at bytes $spool_offset..$byte_end"
  fi
  if ! enqueue_segment "$complete_file" "$spool_offset" "$byte_end" "$spool_sequence" "$is_final" "$record_fragment"; then
    log "could not persist transcript segment"
    break
  fi
  spool_offset="$byte_end"
  spool_sequence=$((spool_sequence + 1))
  if [ "$is_final" = "true" ]; then
    SPOOL_FINALIZED_OFFSET="$byte_end"
  fi
done

if [ "$hook_event_name" = "SessionEnd" ] \
  && [ "$spool_offset" -eq "$current_size" ] \
  && [ "$SPOOL_FINALIZED_OFFSET" != "$current_size" ]; then
  final_marker="$WORK_DIR/final-marker.$$.tmp"
  : > "$final_marker"
  if enqueue_segment "$final_marker" "$current_size" "$current_size" "$spool_sequence" true false; then
    SPOOL_FINALIZED_OFFSET="$current_size"
    spool_sequence=$((spool_sequence + 1))
  else
    log "could not persist final transcript marker"
  fi
  rm -f "$final_marker"
fi

release_state_lock

if [ -z "$token" ]; then
  log "AUTO_IMPROVE_TOKEN is not configured; segment retained in durable outbox"
elif ! command -v curl >/dev/null 2>&1; then
  log "curl is unavailable; segment retained in durable outbox"
elif ! acquire_drain_lock; then
  log "another outbox drain is active; the durable snapshot will be retried by a later hook"
else
  drain_outbox || true
  release_drain_lock
fi

finish 0
