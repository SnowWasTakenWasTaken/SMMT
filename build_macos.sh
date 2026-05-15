#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_PATH=""
DIST_DIR="$SCRIPT_DIR/dist"
for candidate in "$SCRIPT_DIR/SMMT.py" "$SCRIPT_DIR/youtube_downloader.py"; do
  if [[ -f "$candidate" ]]; then
    APP_PATH="$candidate"
    break
  fi
done

if [[ -z "$APP_PATH" ]]; then
  echo "Could not find backend entrypoint. Expected SMMT.py or youtube_downloader.py in $SCRIPT_DIR" >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. Install it first (example: brew install ffmpeg)." >&2
  exit 1
fi

if ! command -v ffprobe >/dev/null 2>&1; then
  echo "ffprobe is required. Install it first (example: brew install ffmpeg)." >&2
  exit 1
fi

FFMPEG_BIN="$(command -v ffmpeg)"
FFPROBE_BIN="$(command -v ffprobe)"

python3 -m pip install --upgrade pyinstaller yt-dlp

python3 -m PyInstaller \
  --clean \
  --noconfirm \
  --onefile \
  --name youtube_downloader-macos \
  --add-binary "${FFMPEG_BIN}:." \
  --add-binary "${FFPROBE_BIN}:." \
  "$APP_PATH"

echo "Build complete. macOS distribution is in ${DIST_DIR}/youtube_downloader-macos"
