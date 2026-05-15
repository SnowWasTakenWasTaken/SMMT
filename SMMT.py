#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    import yt_dlp
except ImportError:
    print("Missing dependency: yt-dlp")
    print("Install it with: pip install yt-dlp")
    sys.exit(1)

SERVICE_CHOICES = ("youtube", "spotify", "soundcloud", "x", "twitch", "tiktok", "other")
FORMAT_CHOICES = ("mp3", "mp4")
PLAYLIST_SCOPE_CHOICES = ("auto", "single", "playlist")


def download_source(
    url: str,
    output_dir: Path,
    audio_only: bool,
    download_playlist: bool,
) -> list[Path]:
    source_format = "bestaudio[ext=webm]/bestaudio" if audio_only else "best[ext=webm]/best"
    outtmpl = "%(playlist_index)s - %(title)s.%(ext)s" if download_playlist else "%(title)s.%(ext)s"
    downloaded_files: list[Path] = []
    seen: set[str] = set()

    def progress_hook(status: dict) -> None:
        if status.get("status") != "finished":
            return
        filename = status.get("filename")
        if not filename:
            return
        file_path = Path(filename)
        key = str(file_path).lower()
        if key in seen:
            return
        seen.add(key)
        downloaded_files.append(file_path)

    opts = {
        "format": source_format,
        "outtmpl": str(output_dir / outtmpl),
        "noplaylist": not download_playlist,
        "quiet": False,
        "progress_hooks": [progress_hook],
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])

    if not downloaded_files:
        raise RuntimeError("No downloadable media was found for the provided link.")
    return downloaded_files


def resolve_ffmpeg_tools() -> tuple[str, str] | None:
    ffmpeg_names = ["ffmpeg.exe", "ffmpeg"]
    ffprobe_names = ["ffprobe.exe", "ffprobe"]
    env_dir = os.environ.get("FFMPEG_DIR", "").strip()
    search_roots: list[Path] = []

    if env_dir:
        search_roots.append(Path(env_dir))
    if getattr(sys, "frozen", False):
        search_roots.append(Path(sys.executable).resolve().parent)

    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        search_roots.append(Path(meipass))

    search_roots.append(Path(__file__).resolve().parent)

    unique_roots: list[Path] = []
    seen: set[str] = set()
    for root in search_roots:
        key = str(root).lower()
        if key not in seen:
            unique_roots.append(root)
            seen.add(key)

    for root in unique_roots:
        candidate_dirs = (root, root / "bin", root / "ffmpeg", root / "ffmpeg" / "bin")
        for directory in candidate_dirs:
            for ffmpeg_name in ffmpeg_names:
                for ffprobe_name in ffprobe_names:
                    ffmpeg = directory / ffmpeg_name
                    ffprobe = directory / ffprobe_name
                    if ffmpeg.exists() and ffprobe.exists():
                        return str(ffmpeg), str(ffprobe)

    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    if ffmpeg_path and ffprobe_path:
        return ffmpeg_path, ffprobe_path

    return None


def convert_media(source_path: Path, target_format: str, ffmpeg_cmd: str) -> Path:
    target_ext = f".{target_format}"
    if source_path.suffix.lower() == target_ext:
        return source_path

    target_path = source_path.with_suffix(f".{target_format}")
    if target_format == "mp3":
        cmd = [
            ffmpeg_cmd,
            "-y",
            "-i",
            str(source_path),
            "-vn",
            "-acodec",
            "libmp3lame",
            "-q:a",
            "2",
            str(target_path),
        ]
    else:
        cmd = [
            ffmpeg_cmd,
            "-y",
            "-i",
            str(source_path),
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            str(target_path),
        ]

    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr = result.stderr.strip() or "Unknown ffmpeg error."
        raise RuntimeError(stderr)
    return target_path


def resolve_spotdl_command() -> list[str] | None:
    candidates = [
        [sys.executable, "-m", "spotdl"],
        ["spotdl"],
    ]

    for candidate in candidates:
        try:
            probe = subprocess.run(candidate + ["--version"], capture_output=True, text=True, check=False)
        except FileNotFoundError:
            continue
        if probe.returncode == 0:
            return candidate
    return None


def run_streaming_subprocess(command: list[str]) -> None:
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    output_lines: list[str] = []
    if process.stdout is None:
        raise RuntimeError("Failed to capture subprocess output.")

    for line in process.stdout:
        output_lines.append(line.rstrip())
        print(line.rstrip())

    exit_code = process.wait()
    if exit_code != 0:
        tail = "\n".join(output_lines[-20:])
        if tail:
            raise RuntimeError(f"Command failed with exit code {exit_code}:\n{tail}")
        raise RuntimeError(f"Command failed with exit code {exit_code}")


def download_with_spotdl(url: str, output_dir: Path, target_format: str) -> None:
    if target_format != "mp3":
        print("Spotify downloads via spotdl are audio-first; using MP3 output.")
        target_format = "mp3"

    spotdl_command = resolve_spotdl_command()
    if spotdl_command is None:
        raise RuntimeError("spotdl is not installed. Install it with: pip install spotdl")

    output_template = str(output_dir / "{artist} - {title}.{output-ext}")
    command = [
        *spotdl_command,
        "--output",
        output_template,
        "--format",
        target_format,
        url,
    ]

    print("Downloading with spotdl...")
    run_streaming_subprocess(command)
    print("Spotify download completed.")


def is_playlist_url(url: str) -> bool:
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    playlist_id = params.get("list", [""])[0].strip()
    return bool(playlist_id)


def resolve_playlist_selection(url: str, playlist_scope: str) -> bool:
    if playlist_scope == "playlist":
        return True
    if playlist_scope == "single":
        return False
    return is_playlist_url(url)


def download_with_ytdlp(url: str, output_dir: Path, target_format: str, download_playlist: bool) -> list[Path]:
    print("Downloading source file(s) with yt-dlp...")
    sources = download_source(
        url=url,
        output_dir=output_dir,
        audio_only=(target_format == "mp3"),
        download_playlist=download_playlist,
    )
    print(f"Downloaded {len(sources)} source file(s).")

    tools = resolve_ffmpeg_tools()
    if not tools:
        print("ffmpeg/ffprobe not found. Keeping source files without conversion.")
        print("Set FFMPEG_DIR or bundle ffmpeg.exe + ffprobe.exe beside the EXE.")
        return sources

    ffmpeg_cmd, _ffprobe_cmd = tools
    converted_files: list[Path] = []
    for index, source in enumerate(sources, start=1):
        print(f"Converting ({index}/{len(sources)}): {source.name}")
        converted = convert_media(source, target_format, ffmpeg_cmd)
        converted_files.append(converted)
        print(f"Converted file: {converted.name}")
        if converted.resolve() != source.resolve():
            source.unlink(missing_ok=True)

    return converted_files


def run_download_job(
    url: str,
    service: str,
    target_format: str,
    output_dir: Path,
    playlist_scope: str = "auto",
) -> None:
    normalized_service = service.strip().lower()
    if normalized_service not in SERVICE_CHOICES:
        raise RuntimeError(f"Unsupported service: {service}")

    if normalized_service == "spotify":
        download_with_spotdl(url=url, output_dir=output_dir, target_format=target_format)
        return

    download_playlist = resolve_playlist_selection(url, playlist_scope)
    download_with_ytdlp(
        url=url,
        output_dir=output_dir,
        target_format=target_format,
        download_playlist=download_playlist,
    )


def choose_format() -> str:
    while True:
        print("\nChoose download format:")
        print("1) MP3 (audio only)")
        print("2) MP4 (video)")
        choice = input("Enter 1 or 2: ").strip()
        if choice == "1":
            return "mp3"
        if choice == "2":
            return "mp4"
        print("Invalid option. Please enter 1 or 2.")


def choose_playlist_scope() -> bool:
    while True:
        print("\nPlaylist detected:")
        print("1) Download entire playlist")
        print("2) Download only the currently selected video")
        choice = input("Enter 1 or 2: ").strip()
        if choice == "1":
            return True
        if choice == "2":
            return False
        print("Invalid option. Please enter 1 or 2.")


def get_default_output_dir() -> Path:
    downloads_dir = Path.home() / "Downloads"
    if downloads_dir.exists():
        return downloads_dir / "SMMT Downloads"
    return Path.home() / "SMMT Downloads"


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Snow's Multi-Media Tool downloader backend")
    parser.add_argument("--url", help="Source URL to download")
    parser.add_argument("--service", choices=SERVICE_CHOICES, default="youtube", help="Media source service")
    parser.add_argument("--format", dest="target_format", choices=FORMAT_CHOICES, default="mp3", help="Output format")
    parser.add_argument("--output-dir", default="", help="Directory where downloaded files should be saved")
    parser.add_argument(
        "--playlist-scope",
        choices=PLAYLIST_SCOPE_CHOICES,
        default="auto",
        help="Playlist behavior for yt-dlp sources",
    )
    return parser


def run_cli_mode(args: argparse.Namespace) -> int:
    url = (args.url or "").strip()
    if not url:
        raise RuntimeError("A URL is required in CLI mode.")

    output_dir = Path(args.output_dir).expanduser() if args.output_dir else get_default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Service: {args.service}")
    print(f"Target format: {args.target_format}")
    print(f"Output directory: {output_dir}")
    run_download_job(
        url=url,
        service=args.service,
        target_format=args.target_format,
        output_dir=output_dir,
        playlist_scope=args.playlist_scope,
    )
    print("Done.")
    return 0


def run_interactive_mode() -> int:
    output_dir = get_default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)

    print("Snow's Multi-Media Tool (interactive mode)")
    print("Type 'q' to quit.")
    print(f"Files will be saved in: {output_dir}")

    while True:
        url = input("\nPaste a YouTube link: ").strip()
        if url.lower() in {"q", "quit", "exit"}:
            print("Goodbye.")
            return 0
        if not url:
            print("No link provided. Try again.")
            continue

        download_playlist = False
        if is_playlist_url(url):
            download_playlist = choose_playlist_scope()

        target_format = choose_format()
        try:
            download_with_ytdlp(
                url=url,
                output_dir=output_dir,
                target_format=target_format,
                download_playlist=download_playlist,
            )
            print("Done.")
        except Exception as exc:  # noqa: BLE001
            print(f"Download failed: {exc}")

        again = input("\nDownload another link? (y/n): ").strip().lower()
        if again not in {"y", "yes"}:
            print("Goodbye.")
            return 0


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()

    if args.url:
        return run_cli_mode(args)
    return run_interactive_mode()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"Fatal error: {exc}")
        if getattr(sys, "frozen", False):
            try:
                input("Press Enter to close...")
            except EOFError:
                pass
        raise SystemExit(1)
