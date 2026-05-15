const VALID_TABS = new Set(['youtube', 'spotify', 'soundcloud', 'x', 'twitch', 'tiktok', 'other', 'settings']);
const DOWNLOAD_SERVICES = new Set(['youtube', 'spotify', 'soundcloud', 'x', 'twitch', 'tiktok', 'other']);
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_BACKGROUND_START = '#0c1020';
const DEFAULT_BACKGROUND_END = '#121b2f';

const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));
const downloadButtons = Array.from(document.querySelectorAll('[data-download-service]'));
const darkModeToggle = document.getElementById('dark-mode-toggle');
const saveFormatSelect = document.getElementById('save-format');
const saveStatus = document.getElementById('save-status');
const saveDirectoryInput = document.getElementById('save-directory');
const chooseSaveDirectoryButton = document.getElementById('choose-save-directory');
const clearBackgroundCacheButton = document.getElementById('clear-background-cache');
const cacheStatus = document.getElementById('cache-status');
const customBackgroundEnabledToggle = document.getElementById('custom-background-enabled');
const bgColorStartInput = document.getElementById('bg-color-start');
const bgColorEndInput = document.getElementById('bg-color-end');

const state = {
  darkMode: true,
  activeTab: 'youtube',
  saveFormat: 'json',
  saveDirectory: '',
  customBackgroundEnabled: false,
  customBackgroundStart: DEFAULT_BACKGROUND_START,
  customBackgroundEnd: DEFAULT_BACKGROUND_END,
};

function normalizeTab(tab) {
  if (typeof tab === 'string' && VALID_TABS.has(tab)) {
    return tab;
  }
  return 'youtube';
}

function normalizeSaveFormat(format) {
  return format === 'yaml' ? 'yaml' : 'json';
}

function normalizeSaveDirectory(directory) {
  return typeof directory === 'string' ? directory.trim() : '';
}

function normalizeHexColor(color, fallback) {
  if (typeof color === 'string' && HEX_COLOR_REGEX.test(color)) {
    return color.toLowerCase();
  }
  return fallback;
}

function normalizeDownloadService(service) {
  const normalized = typeof service === 'string' ? service.trim().toLowerCase() : '';
  return DOWNLOAD_SERVICES.has(normalized) ? normalized : 'other';
}

function normalizeDownloadFormat(format, service) {
  const requested = typeof format === 'string' ? format.trim().toLowerCase() : 'mp3';
  if (service === 'spotify' || service === 'soundcloud') {
    return 'mp3';
  }
  if (requested === 'mp4') {
    return 'mp4';
  }
  return 'mp3';
}

function getDownloadElement(service, key) {
  return document.querySelector(`[${key}="${service}"]`);
}

function setDownloadStatus(service, text, tone = 'neutral') {
  const element = getDownloadElement(service, 'data-download-status');
  if (!element) {
    return;
  }
  element.textContent = text;
  element.dataset.tone = tone;
}

function setDownloadLog(service, text) {
  const element = getDownloadElement(service, 'data-download-log');
  if (!element) {
    return;
  }
  element.textContent = text || '';
}

function applySettingsPayload(settings) {
  if (!settings || typeof settings !== 'object') {
    return;
  }

  state.darkMode = Boolean(settings.darkMode);
  state.activeTab = normalizeTab(settings.activeTab);
  state.saveFormat = normalizeSaveFormat(settings.saveFormat);
  state.saveDirectory = normalizeSaveDirectory(settings.saveDirectory);
  state.customBackgroundEnabled = Boolean(settings.customBackgroundEnabled);
  state.customBackgroundStart = normalizeHexColor(settings.customBackgroundStart, DEFAULT_BACKGROUND_START);
  state.customBackgroundEnd = normalizeHexColor(settings.customBackgroundEnd, DEFAULT_BACKGROUND_END);
}

function setStatus(text, tone = 'neutral') {
  saveStatus.textContent = text;
  saveStatus.dataset.tone = tone;
}

function setCacheStatus(text, tone = 'neutral') {
  if (!cacheStatus) {
    return;
  }
  cacheStatus.textContent = text;
  cacheStatus.dataset.tone = tone;
}

function applyTheme() {
  document.body.classList.toggle('theme-dark', state.darkMode);
  document.body.classList.toggle('theme-light', !state.darkMode);

  if (state.customBackgroundEnabled) {
    document.body.style.setProperty('--bg-a', normalizeHexColor(state.customBackgroundStart, DEFAULT_BACKGROUND_START));
    document.body.style.setProperty('--bg-b', normalizeHexColor(state.customBackgroundEnd, DEFAULT_BACKGROUND_END));
  } else {
    document.body.style.removeProperty('--bg-a');
    document.body.style.removeProperty('--bg-b');
  }
}

function applyActiveTab() {
  const active = normalizeTab(state.activeTab);
  state.activeTab = active;

  tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === active;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === active;
    panel.classList.toggle('active', isActive);
  });
}

function applyControls() {
  darkModeToggle.checked = state.darkMode;
  saveFormatSelect.value = normalizeSaveFormat(state.saveFormat);

  if (saveDirectoryInput) {
    saveDirectoryInput.value = state.saveDirectory;
  }

  if (customBackgroundEnabledToggle) {
    customBackgroundEnabledToggle.checked = state.customBackgroundEnabled;
  }

  if (bgColorStartInput) {
    bgColorStartInput.value = normalizeHexColor(state.customBackgroundStart, DEFAULT_BACKGROUND_START);
    bgColorStartInput.disabled = !state.customBackgroundEnabled;
  }

  if (bgColorEndInput) {
    bgColorEndInput.value = normalizeHexColor(state.customBackgroundEnd, DEFAULT_BACKGROUND_END);
    bgColorEndInput.disabled = !state.customBackgroundEnabled;
  }
}

async function persistState() {
  if (!window.smmtApi?.saveSettings) {
    setStatus('Desktop bridge unavailable: settings are not persisted.', 'error');
    return;
  }

  try {
    const saved = await window.smmtApi.saveSettings({
      darkMode: state.darkMode,
      activeTab: state.activeTab,
      saveFormat: state.saveFormat,
      saveDirectory: state.saveDirectory,
      customBackgroundEnabled: state.customBackgroundEnabled,
      customBackgroundStart: state.customBackgroundStart,
      customBackgroundEnd: state.customBackgroundEnd,
    });

    applySettingsPayload(saved);
    applyTheme();
    applyActiveTab();
    applyControls();
    setStatus(`Preferences saved (${state.saveFormat.toUpperCase()}).`, 'success');
  } catch (error) {
    console.error('Failed to save settings:', error);
    setStatus('Could not save preferences.', 'error');
  }
}

async function initialize() {
  if (window.smmtApi?.loadSettings) {
    try {
      const loaded = await window.smmtApi.loadSettings();
      applySettingsPayload(loaded);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setStatus('Using defaults; previous preferences failed to load.', 'error');
    }
  } else {
    setStatus('Desktop bridge unavailable: defaults loaded only.', 'error');
  }

  applyTheme();
  applyActiveTab();
  applyControls();
  setCacheStatus('Cache status will appear here.');

  downloadButtons.forEach((button) => {
    const service = normalizeDownloadService(button.dataset.downloadService);
    setDownloadStatus(service, 'Ready to download.');
    setDownloadLog(service, '');
  });

  if (!saveStatus.textContent || saveStatus.textContent.startsWith('Initializing')) {
    setStatus(`Ready. Current format: ${state.saveFormat.toUpperCase()}.`);
  }
}

tabButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    state.activeTab = normalizeTab(button.dataset.tabTarget);
    applyActiveTab();
    await persistState();
  });
});

darkModeToggle.addEventListener('change', async () => {
  state.darkMode = darkModeToggle.checked;
  applyTheme();
  await persistState();
});

saveFormatSelect.addEventListener('change', async () => {
  state.saveFormat = normalizeSaveFormat(saveFormatSelect.value);
  await persistState();
});

downloadButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const service = normalizeDownloadService(button.dataset.downloadService);
    const sourceInput = getDownloadElement(service, 'data-source-url');
    const formatSelect = getDownloadElement(service, 'data-download-format');
    const url = typeof sourceInput?.value === 'string' ? sourceInput.value.trim() : '';
    const format = normalizeDownloadFormat(formatSelect?.value, service);

    if (!url) {
      setDownloadStatus(service, 'Add a source URL before downloading.', 'error');
      setDownloadLog(service, '');
      return;
    }

    if (!window.smmtApi?.runDownload) {
      setDownloadStatus(service, 'Download bridge unavailable in this runtime.', 'error');
      return;
    }

    button.disabled = true;
    setDownloadStatus(service, `Downloading ${service} media...`);
    setDownloadLog(service, `Starting ${service.toUpperCase()} download as ${format.toUpperCase()}...`);

    try {
      const result = await window.smmtApi.runDownload({
        service,
        url,
        format,
        outputDirectory: state.saveDirectory,
      });

      const outputDirectory = result?.outputDirectory ? String(result.outputDirectory) : state.saveDirectory;
      setDownloadStatus(service, `Download finished. Saved in ${outputDirectory}.`, 'success');
      setDownloadLog(service, result?.log || 'Download completed.');
    } catch (error) {
      const message = error?.message || 'Download failed.';
      setDownloadStatus(service, message, 'error');
      setDownloadLog(service, message);
    } finally {
      button.disabled = false;
    }
  });
});

if (chooseSaveDirectoryButton) {
  chooseSaveDirectoryButton.addEventListener('click', async () => {
    if (!window.smmtApi?.pickSaveDirectory) {
      setStatus('Folder picker unavailable in this runtime.', 'error');
      return;
    }

    try {
      const selectedPath = await window.smmtApi.pickSaveDirectory(state.saveDirectory);
      if (!selectedPath) {
        setStatus('Folder selection cancelled.');
        return;
      }

      state.saveDirectory = normalizeSaveDirectory(selectedPath);
      applyControls();
      await persistState();
    } catch (error) {
      console.error('Failed to select folder:', error);
      setStatus('Could not open folder selector.', 'error');
    }
  });
}

if (clearBackgroundCacheButton) {
  clearBackgroundCacheButton.addEventListener('click', async () => {
    if (!window.smmtApi?.clearBackgroundCache) {
      setCacheStatus('Cache clear action unavailable in this runtime.', 'error');
      return;
    }

    setCacheStatus('Deleting background cache...');

    try {
      const result = await window.smmtApi.clearBackgroundCache();
      const deletedCount = Number(result?.deletedEntries ?? 0);
      const suffix = deletedCount === 1 ? 'entry' : 'entries';
      setCacheStatus(`Background cache deleted (${deletedCount} ${suffix}).`, 'success');
    } catch (error) {
      console.error('Failed to clear background cache:', error);
      setCacheStatus('Could not delete background cache.', 'error');
    }
  });
}

if (customBackgroundEnabledToggle) {
  customBackgroundEnabledToggle.addEventListener('change', async () => {
    state.customBackgroundEnabled = customBackgroundEnabledToggle.checked;
    applyTheme();
    applyControls();
    await persistState();
  });
}

if (bgColorStartInput) {
  bgColorStartInput.addEventListener('input', () => {
    state.customBackgroundStart = normalizeHexColor(bgColorStartInput.value, DEFAULT_BACKGROUND_START);
    applyTheme();
  });

  bgColorStartInput.addEventListener('change', async () => {
    state.customBackgroundStart = normalizeHexColor(bgColorStartInput.value, DEFAULT_BACKGROUND_START);
    await persistState();
  });
}

if (bgColorEndInput) {
  bgColorEndInput.addEventListener('input', () => {
    state.customBackgroundEnd = normalizeHexColor(bgColorEndInput.value, DEFAULT_BACKGROUND_END);
    applyTheme();
  });

  bgColorEndInput.addEventListener('change', async () => {
    state.customBackgroundEnd = normalizeHexColor(bgColorEndInput.value, DEFAULT_BACKGROUND_END);
    await persistState();
  });
}

void initialize();
