#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  export_fmm003_avl_samples.sh DEVICE_ID START_UTC END_UTC [OUTPUT_FILE]

Example:
  scripts/export_fmm003_avl_samples.sh 12 \
    '2026-09-01 00:00:00-04' '2026-09-03 00:00:00-04' \
    /tmp/fmm003-avl-samples.jsonl

Times must include a UTC offset. The script reads the Traccar database and
exports one JSON object per matching position, with position context and only
the profile fields useful for FMM003 mapping validation. VIN is included only
if it was transmitted in a position attribute.
Set TRACCAR_DB_CONTAINER if the PostgreSQL container is not named traccar-db.
EOF
  exit 2
}

[[ $# -ge 3 && $# -le 4 ]] || usage

DEVICE_ID="$1"
START_UTC="$2"
END_UTC="$3"
OUTPUT_FILE="${4:-fmm003-avl-samples.jsonl}"
DATABASE_CONTAINER="${TRACCAR_DB_CONTAINER:-traccar-db}"

if [[ ! "$DEVICE_ID" =~ ^[0-9]+$ ]]; then
  echo "DEVICE_ID must be a numeric Traccar device ID." >&2
  exit 2
fi

umask 077
mkdir -p "$(dirname "$OUTPUT_FILE")"

sudo docker exec -i "$DATABASE_CONTAINER" \
  psql -X -q -A -t -v ON_ERROR_STOP=1 \
    -U traccar -d traccar \
    -v device_id="$DEVICE_ID" \
    -v start_utc="$START_UTC" \
    -v end_utc="$END_UTC" > "$OUTPUT_FILE" <<'SQL'
SET TIME ZONE 'UTC';

WITH sample_keys AS (
  SELECT ARRAY[
    'axisX', 'axisY', 'axisZ', 'battery', 'bleTemp1', 'bleTemp2', 'bleTemp3', 'bleTemp4', 'distance', 'event', 'hdop', 'hours', 'ignition',
    'io12', 'io13', 'io15', 'io20', 'io22', 'io23', 'io24', 'io29', 'io30', 'io31', 'io32', 'io33', 'io34',
    'io36', 'io37', 'io38', 'io39', 'io40', 'io41', 'io42', 'io43', 'io44',
    'io45', 'io46', 'io47', 'io48', 'io49', 'io50', 'io51', 'io52', 'io53',
    'io54', 'io55', 'io56', 'io57', 'io58', 'io59', 'io60', 'io68', 'io69', 'io80',
    'io86', 'io100', 'io101', 'io104', 'io106', 'io108', 'io113', 'io138', 'io181', 'io182', 'io200', 'io206', 'io237',
    'io205', 'io240', 'io241', 'io256', 'io281', 'io388', 'io389', 'io390',
    'io402', 'io411', 'io529', 'io540', 'io541', 'io542', 'io759', 'motion',
    'odometer', 'operator', 'pdop', 'power', 'priority', 'rssi', 'sat', 'tripOdometer',
    'totalDistance', 'vin'
  ]::text[] AS keys
)
SELECT jsonb_build_object(
  'positionId', p.id,
  'deviceId', p.deviceid,
  'fixTime', p.fixtime,
  'position', jsonb_build_object(
    'latitude', p.latitude,
    'longitude', p.longitude,
    'speedKnots', p.speed,
    'courseDeg', p.course,
    'altitudeM', p.altitude,
    'accuracyM', p.accuracy
  ),
  'attributes', (
    SELECT jsonb_object_agg(field.key, field.value)
    FROM jsonb_each(p.attributes::jsonb) AS field(key, value)
    WHERE field.key = ANY(sample_keys.keys)
  )
)::text
FROM public.tc_positions AS p
CROSS JOIN sample_keys
WHERE p.deviceid = :'device_id'::integer
  AND p.fixtime >= :'start_utc'::timestamptz
  AND p.fixtime < :'end_utc'::timestamptz
  AND p.attributes::jsonb ?| sample_keys.keys
ORDER BY p.fixtime ASC, p.id ASC;
SQL

chmod 600 "$OUTPUT_FILE"
printf 'Wrote Traccar AVL samples to %s\n' "$OUTPUT_FILE"
printf 'Review the file locally and redact deviceId/positionId if sharing it outside your trusted environment.\n'
