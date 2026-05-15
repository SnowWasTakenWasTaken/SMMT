const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const VALID_TABS = new Set(['youtube', 'spotify', 'soundcloud', 'x', 'twitch', 'tiktok', 'other', 'settings']);
const DOWNLOAD_SERVICES = new Set(['youtube', 'spotify', 'soundcloud', 'x', 'twitch', 'tiktok', 'other']);
const DOWNLOAD_FORMATS = new Set(['mp3', 'mp4']);
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

function getDefaultSettings() {
  return {
    darkMode: true,
    activeTab: 'youtube',
    saveFormat: 'json',
    saveDirectory: app.getPath('downloads'),
    customBackgroundEnabled: false,
    customBackgroundStart: '#0c1020',
    customBackgroundEnd: '#121b2f',
  };
}

function resolveBundledBackendExecutable() {
  const candidates = [];

  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'backend', 'youtube_downloader.exe'));
    candidates.push(path.join(process.resourcesPath, 'backend', 'youtube_downloader-macos'));
    candidates.push(path.join(process.resourcesPath, 'backend', 'youtube_downloader-linux'));
  }

  candidates.push(path.join(__dirname, 'dist', 'youtube_downloader.exe'));
  candidates.push(path.join(__dirname, 'dist', 'youtube_downloader-macos'));
  candidates.push(path.join(__dirname, 'dist', 'youtube_downloader-linux'));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getSettingsPath(format) {
  return path.join(app.getPath('userData'), `settings.${format}`);
}

function parseSettings(rawContent, format) {
  if (format === 'yaml') {
    return yaml.load(rawContent);
  }
  return JSON.parse(rawContent);
}

function serializeSettings(settings, format) {
  if (format === 'yaml') {
    return yaml.dump(settings, { indent: 2, lineWidth: 120 });
  }
  return JSON.stringify(settings, null, 2);
}

function normalizeHexColor(color, fallback) {
  if (typeof color === 'string' && HEX_COLOR_REGEX.test(color)) {
    return color.toLowerCase();
  }
  return fallback;
}

function sanitizeSettings(settings) {
  const defaults = getDefaultSettings();
  return {
    darkMode: Boolean(settings.darkMode),
    activeTab: typeof settings.activeTab === 'string' && VALID_TABS.has(settings.activeTab)
      ? settings.activeTab
      : defaults.activeTab,
    saveFormat: settings.saveFormat === 'yaml' ? 'yaml' : 'json',
    saveDirectory: typeof settings.saveDirectory === 'string' && settings.saveDirectory.trim().length > 0
      ? settings.saveDirectory.trim()
      : defaults.saveDirectory,
    customBackgroundEnabled: Boolean(settings.customBackgroundEnabled),
    customBackgroundStart: normalizeHexColor(settings.customBackgroundStart, defaults.customBackgroundStart),
    customBackgroundEnd: normalizeHexColor(settings.customBackgroundEnd, defaults.customBackgroundEnd),
  };
}

function getBackgroundCacheDirectory() {
  return path.join(app.getPath('userData'), 'background-cache');
}

function tryReadSettings(format) {
  const settingsPath = getSettingsPath(format);
  if (!fs.existsSync(settingsPath)) {
    return null;
  }

  try {
    const rawContent = fs.readFileSync(settingsPath, 'utf8');
    const parsedContent = parseSettings(rawContent, format);
    if (!parsedContent || typeof parsedContent !== 'object') {
      return null;
    }

    const stats = fs.statSync(settingsPath);
    return {
      format,
      mtimeMs: stats.mtimeMs,
      data: parsedContent,
    };
  } catch (error) {
    console.warn(`Could not read settings file (${format}):`, error);
    return null;
  }
}

function loadSettings() {
  const settingsCandidates = ['json', 'yaml']
    .map((format) => tryReadSettings(format))
    .filter(Boolean)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const defaults = getDefaultSettings();

  if (settingsCandidates.length === 0) {
    return { ...defaults };
  }

  const latest = settingsCandidates[0];
  return sanitizeSettings({
    ...defaults,
    ...latest.data,
    saveFormat: latest.format,
  });
}

function saveSettings(partialSettings = {}) {
  const defaults = getDefaultSettings();
  const mergedSettings = sanitizeSettings({
    ...defaults,
    ...loadSettings(),
    ...partialSettings,
  });

  const targetFormat = mergedSettings.saveFormat;
  const targetPath = getSettingsPath(targetFormat);
  const oppositeFormat = targetFormat === 'json' ? 'yaml' : 'json';
  const oppositePath = getSettingsPath(oppositeFormat);

  fs.writeFileSync(targetPath, serializeSettings(mergedSettings, targetFormat), 'utf8');

  if (fs.existsSync(oppositePath)) {
    fs.unlinkSync(oppositePath);
  }

  return mergedSettings;
}

async function pickSaveDirectory(currentPath) {
  const defaultPath = typeof currentPath === 'string' && currentPath.trim().length > 0
    ? currentPath
    : app.getPath('downloads');

  const result = await dialog.showOpenDialog({
    title: 'Choose save folder',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

function clearBackgroundCache() {
  const cacheDirectory = getBackgroundCacheDirectory();
  fs.mkdirSync(cacheDirectory, { recursive: true });
  const entries = fs.readdirSync(cacheDirectory);

  entries.forEach((entryName) => {
    const entryPath = path.join(cacheDirectory, entryName);
    fs.rmSync(entryPath, { recursive: true, force: true });
  });

  return {
    cacheDirectory,
    deletedEntries: entries.length,
  };
}

function resolvePythonLauncher() {
  const candidates = [
    { command: 'python', prefixArgs: [] },
    { command: 'python3', prefixArgs: [] },
    { command: 'py', prefixArgs: ['-3'] },
  ];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.prefixArgs, '--version'], {
      windowsHide: true,
    });

    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  throw new Error('Python runtime not found. Install Python and ensure python/py is on PATH.');
}

function sanitizeDownloadRequest(payload = {}) {
  const service = typeof payload.service === 'string' ? payload.service.trim().toLowerCase() : '';
  if (!DOWNLOAD_SERVICES.has(service)) {
    throw new Error('Unsupported media service.');
  }

  const url = typeof payload.url === 'string' ? payload.url.trim() : '';
  if (!url) {
    throw new Error('A source URL is required.');
  }

  const requestedFormat = typeof payload.format === 'string' ? payload.format.trim().toLowerCase() : 'mp3';
  let format = DOWNLOAD_FORMATS.has(requestedFormat) ? requestedFormat : 'mp3';
  if ((service === 'spotify' || service === 'soundcloud') && format !== 'mp3') {
    format = 'mp3';
  }

  const requestedOutputDir = typeof payload.outputDirectory === 'string' ? payload.outputDirectory.trim() : '';
  const settings = loadSettings();
  const outputDirectory = requestedOutputDir || settings.saveDirectory;

  if (!outputDirectory) {
    throw new Error('A save directory is required before downloading.');
  }

  fs.mkdirSync(outputDirectory, { recursive: true });

  return {
    service,
    url,
    format,
    outputDirectory,
  };
}

function runDownloadTask(payload = {}) {
  const request = sanitizeDownloadRequest(payload);
  const backendExe = resolveBundledBackendExecutable();

  let command = '';
  let args = [];
  let commandCwd = __dirname;
  if (backendExe) {
    command = backendExe;
    commandCwd = path.dirname(backendExe);
    args = [
      '--url',
      request.url,
      '--service',
      request.service,
      '--format',
      request.format,
      '--output-dir',
      request.outputDirectory,
      '--playlist-scope',
      'auto',
    ];
  } else {
    const launcher = resolvePythonLauncher();
    const packagedScriptPath = path.join(process.resourcesPath, 'backend', 'youtube_downloader.py');
    const devScriptPath = path.join(__dirname, 'youtube_downloader.py');
    const scriptPath = fs.existsSync(packagedScriptPath) ? packagedScriptPath : devScriptPath;

    command = launcher.command;
    commandCwd = path.dirname(scriptPath);
    args = [
      ...launcher.prefixArgs,
      scriptPath,
      '--url',
      request.url,
      '--service',
      request.service,
      '--format',
      request.format,
      '--output-dir',
      request.outputDirectory,
      '--playlist-scope',
      'auto',
    ];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: commandCwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(new Error(`Could not start downloader: ${error.message}`));
    });

    child.on('close', (code) => {
      const trimmedStdout = stdout.trim();
      const trimmedStderr = stderr.trim();
      const combinedOutput = [trimmedStdout, trimmedStderr].filter(Boolean).join('\n');

      if (code === 0) {
        resolve({
          service: request.service,
          format: request.format,
          outputDirectory: request.outputDirectory,
          log: combinedOutput || 'Download completed.',
        });
        return;
      }

      reject(new Error(combinedOutput || `Downloader exited with code ${code}.`));
    });
  });
}

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    title: "Snow's Multi-Media Tool",
    icon: path.join(__dirname, 'icon.ico'), // Placeholder icon for the native app window/taskbar; swap this path to your final branded icon.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.snow.smmt');

  ipcMain.handle('settings:load', () => loadSettings());
  ipcMain.handle('settings:save', (_event, partialSettings) => saveSettings(partialSettings ?? {}));
  ipcMain.handle('settings:pick-save-directory', (_event, currentPath) => pickSaveDirectory(currentPath));
  ipcMain.handle('cache:clear-background', () => clearBackgroundCache());
  ipcMain.handle('download:run', (_event, payload) => runDownloadTask(payload ?? {}));

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
