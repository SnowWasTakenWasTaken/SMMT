$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppPath = Join-Path $ScriptDir "youtube_downloader.py"
$IconPath = Join-Path $ScriptDir "icon.ico"
$VersionFile = Join-Path $ScriptDir "version_info.txt"
$FfmpegRoot = $env:FFMPEG_ROOT
if ([string]::IsNullOrWhiteSpace($FfmpegRoot)) {
    $FfmpegRoot = "C:\Users\alex2\Downloads\ffmpeg-2026-05-06-git-f2e5eff3ff-essentials_build"
}

if (!(Test-Path $AppPath)) {
    throw "Could not find youtube_downloader.py at $AppPath"
}
if (!(Test-Path $IconPath)) {
    throw "Could not find icon.ico at $IconPath"
}

@'
# UTF-8
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=(1, 0, 0, 0),
    prodvers=(1, 0, 0, 0),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo(
      [
        StringTable(
          '040904B0',
          [
            StringStruct('CompanyName', 'Silverback'),
            StringStruct('FileDescription', 'Generic'),
            StringStruct('FileVersion', '1.0.0'),
            StringStruct('InternalName', 'youtube_downloader'),
            StringStruct('LegalCopyright', 'Silverback'),
            StringStruct('OriginalFilename', 'youtube_downloader.exe'),
            StringStruct('ProductName', 'Silverback'),
            StringStruct('ProductVersion', '1.0.0'),
            StringStruct('Comments', 'Creator: Silverback')
          ]
        )
      ]
    ),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
'@ | Set-Content -Path $VersionFile -Encoding UTF8

$FfmpegExe = $null
$FfprobeExe = $null

$directCandidates = @(
    (Join-Path $FfmpegRoot "ffmpeg.exe"),
    (Join-Path $FfmpegRoot "bin\ffmpeg.exe")
)
foreach ($candidate in $directCandidates) {
    if (Test-Path $candidate) {
        $FfmpegExe = (Resolve-Path $candidate).Path
        break
    }
}

if (-not $FfmpegExe) {
    $found = Get-ChildItem -Path $FfmpegRoot -Filter "ffmpeg.exe" -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
        $FfmpegExe = $found.FullName
    }
}

if (-not $FfmpegExe) {
    throw "Could not find ffmpeg.exe under $FfmpegRoot"
}

$FfmpegDir = Split-Path -Parent $FfmpegExe
$FfprobeCandidate = Join-Path $FfmpegDir "ffprobe.exe"
if (Test-Path $FfprobeCandidate) {
    $FfprobeExe = (Resolve-Path $FfprobeCandidate).Path
}
if (-not $FfprobeExe) {
    throw "Could not find ffprobe.exe next to ffmpeg.exe at $FfmpegDir"
}

Write-Host "Using ffmpeg: $FfmpegExe"
Write-Host "Using ffprobe: $FfprobeExe"
Write-Host "Using icon: $IconPath"
Write-Host "Using version file: $VersionFile"
python -m pip install --upgrade pyinstaller yt-dlp

python -m PyInstaller `
    --clean `
    --noconfirm `
    --onefile `
    --name youtube_downloader `
    --icon "$IconPath" `
    --version-file "$VersionFile" `
    --add-binary "$FfmpegExe;." `
    --add-binary "$FfprobeExe;." `
    "$AppPath"

Write-Host "Build complete. EXE is in .\dist\youtube_downloader.exe"
