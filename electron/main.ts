import { app, BrowserWindow, ipcMain, dialog, shell, protocol, Tray, Menu, globalShortcut, session, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import archiver from 'archiver';
import { fileURLToPath } from 'url';
import { spawn, execSync, ChildProcess } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getPublicAssetRoots(): string[] {
  const roots: string[] = [];
  if (app.isPackaged) {
    roots.push(path.join(process.resourcesPath, 'public'));
    roots.push(path.join(process.resourcesPath, 'dist'));
    roots.push(path.join(app.getAppPath(), 'assets'));
    roots.push(path.join(app.getAppPath(), 'dist', 'assets'));
  }
  roots.push(path.join(__dirname, '../public'));
  roots.push(path.join(__dirname, '../dist'));
  roots.push(path.join(__dirname, '../assets'));
  return roots;
}

function resolvePublicAssetPath(relativePath: string): string | null {
  const clean = relativePath.replace(/^\/+/, '').replace(/\.\./g, '');
  for (const root of getPublicAssetRoots()) {
    const full = path.join(root, clean);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

// Dynamic Workspace configuration
let GITBOT_DIR = path.join(os.homedir(), '.gitbot');
const WORKSPACE_FILE = path.join(os.homedir(), '.gitbot', 'workspace.txt');
let customWorkspacePath: string | null = null;
if (fs.existsSync(WORKSPACE_FILE)) {
  const custom = fs.readFileSync(WORKSPACE_FILE, 'utf-8').trim();
  if (custom && fs.existsSync(custom)) {
    GITBOT_DIR = custom;
    customWorkspacePath = custom;
  }
}

let CONFIG_FILE = path.join(GITBOT_DIR, 'config.json');
let REPOS_DIR = path.join(GITBOT_DIR, 'repos');
let MODELS_DIR = path.join(GITBOT_DIR, 'models');
let PROFILE_IMAGE = path.join(GITBOT_DIR, 'profile.png');
let GENERATED_IMAGES_DIR = path.join(GITBOT_DIR, 'generated_images');

let aiProcess: ChildProcess | null = null;
let imageGenProcess: ChildProcess | null = null;
let imageGenStatus: { generating: boolean; prompt?: string; startedAt?: number } = { generating: false };
let imageGenLastResult: any = null;
let lastAiError: string | null = null;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let previousBounds: any = null;

function killAIProcess() {
  try {
    // Force-kill all llama-server instances to release DLL file locks
    execSync('taskkill /F /IM llama-server.exe /T', { stdio: 'ignore' });
  } catch { }
  try {
    if (aiProcess) {
      try {
        if (process.platform === 'win32') {
          // Check if process exists before killing
          const pid = aiProcess.pid;
          if (pid) {
            spawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
          }
        } else {
          process.kill(-aiProcess.pid!);
        }
      } catch (e) {
        // Silently catch if process is already gone
      }
      aiProcess = null;
    }
  } catch { }
}


// Ensure base directories exist
if (!fs.existsSync(path.join(os.homedir(), '.gitbot'))) fs.mkdirSync(path.join(os.homedir(), '.gitbot'), { recursive: true });
for (const d of [GITBOT_DIR, REPOS_DIR, MODELS_DIR, GENERATED_IMAGES_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ─── Window ──────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 660,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    transparent: true,
    show: true,
    backgroundColor: '#12151c',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      // FIX: Better performance for background tasks
      backgroundThrottling: false,
    },
    ...(process.platform === 'win32' ? { roundedCorners: true as const } : {}),
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    mainWindow.setOpacity(1);
    mainWindow.show();
    mainWindow.focus();
  });

  if (app.isPackaged) {
    Menu.setApplicationMenu(null);
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow?.webContents.closeDevTools();
    });
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F11' || !mainWindow) return;
    event.preventDefault();
    const goingFull = !mainWindow.isFullScreen();
    if (goingFull) {
      if (!mainWindow.isMaximized()) previousBounds = mainWindow.getBounds();
      mainWindow.setFullScreen(true);
    } else {
      mainWindow.setFullScreen(false);
      if (previousBounds) {
        mainWindow.setBounds(previousBounds);
        previousBounds = null;
      } else {
        mainWindow.unmaximize();
        mainWindow.setSize(980, 660);
        mainWindow.center();
      }
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Global flag to track genuine quit request (unused on app object, now using local variable)
// protocol registration...

protocol.registerSchemesAsPrivileged([
  { scheme: 'gitbot-repo', privileges: { bypassCSP: true, supportFetchAPI: true, standard: true, secure: true, corsEnabled: true, allowServiceWorkers: true } },
  { scheme: 'gitbot-profile', privileges: { bypassCSP: true, supportFetchAPI: true, standard: true, secure: true, corsEnabled: true } },
  { scheme: 'xai-asset', privileges: { bypassCSP: true, supportFetchAPI: true, standard: true, secure: true, corsEnabled: true } },
]);

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.registerFileProtocol('xai-asset', (request, callback) => {
      try {
        const rel = decodeURIComponent(request.url.replace(/^xai-asset:\/\//, ''));
        const resolved = resolvePublicAssetPath(rel);
        if (resolved) callback({ path: resolved });
        else callback({ error: -6 });
      } catch {
        callback({ error: -2 });
      }
    });

    ipcMain.on('sync-is-packaged', (event) => {
      event.returnValue = app.isPackaged;
    });

    // Setup System Tray
    const iconPath = app.isPackaged ? path.join(app.getAppPath(), 'assets', 'icon.ico') : path.join(__dirname, '../assets/icon.ico');
    if (fs.existsSync(iconPath)) {
      tray = new Tray(iconPath);
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Show XAi', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
        { label: 'Hide XAi', click: () => mainWindow?.hide() },
        { type: 'separator' },
        { label: 'Quit', click: () => { isQuitting = true; killAIProcess(); app.quit(); } }
      ]);
      tray.setToolTip('XAi — F8 to show/hide');
      tray.setContextMenu(contextMenu);
      tray.on('double-click', () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) mainWindow.hide();
        else { mainWindow.show(); mainWindow.focus(); }
      });
      console.log('Tray initialized successfully');
    }

    const toggleWindowVisibility = () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    };

    // F8 / F9 — hide/show (minimize to tray)
    for (const key of ['F8', 'F9'] as const) {
      const registered = globalShortcut.register(key, toggleWindowVisibility);
      if (!registered) console.error(`${key} registration failed`);
      else console.log(`${key} shortcut registered`);
    }

    protocol.registerFileProtocol('gitbot-repo', (request, callback) => {
      try {
        // Robust path extraction that handles both gitbot-repo://local/RepoName and gitbot-repo://RepoName
        let urlPath = request.url.replace('gitbot-repo://local/', '').replace('gitbot-repo://', '');

        const decoded = decodeURIComponent(urlPath);
        const fullPath = path.join(REPOS_DIR, decoded);
        callback({ path: fullPath });
      } catch { callback({ error: -6 }); }
    });
    protocol.registerFileProtocol('gitbot-profile', (request, callback) => {
      let url = decodeURIComponent(request.url.replace('gitbot-profile://', ''));
      if (url.match(/^[a-zA-Z]\//)) url = url.charAt(0) + ':' + url.substring(1);
      try { callback(url); } catch { callback({ error: -6 }); }
    });

    createWindow();

    session.defaultSession.on('will-download', (event, item, webContents) => {
      // Only ask where to save if it's explicitly downloaded by user
      item.setSaveDialogOptions({
        title: 'Save Image',
        defaultPath: item.getFilename()
      });
    });

    setTimeout(() => {
      let configObj: any = {};
      try { if (fs.existsSync(CONFIG_FILE)) configObj = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { }

      if (configObj.autoStartAI !== false) {
        mainWindow?.webContents.send('ai-server-starting');
        let aiModel = configObj.aiModels?.find((m: any) => m.isActive);

        // Handle double-clicked .gguf files via process args (Windows/Linux)
        const argvModel = process.argv.find(arg => arg.toLowerCase().endsWith('.gguf') && fs.existsSync(arg));

        let aiPath = argvModel || aiModel?.modelPath || configObj.lastModelPath;
        let mmprojPath = argvModel ? null : (aiModel?.mmprojPath || configObj.lastMmprojPath);

        if (argvModel) {
          configObj.lastModelPath = argvModel;
          configObj.lastMmprojPath = null;
          try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(configObj, null, 2)); } catch { }
        }

        if (aiPath && fs.existsSync(aiPath)) {
          console.log('Auto-starting AI...');
          const serverExe = app.isPackaged
            ? path.join(process.resourcesPath, 'cpp', 'llama-server.exe')
            : path.join(__dirname, '../cpp', 'llama-server.exe');

          const isVision = !!(mmprojPath && fs.existsSync(mmprojPath));

          const args = [
            '-m', aiPath,
            '--port', '8080',
            '--ctx-size', isVision ? '4096' : '8192',
            '-ngl', '99',
            '--parallel', '1',
            '--host', '127.0.0.1',
            '--threads', Math.max(1, os.cpus().length - 1).toString(),
            '--threads-batch', os.cpus().length.toString(),
            '--batch-size', '2048'
          ];
          if (mmprojPath && fs.existsSync(mmprojPath)) {
            args.push('--mmproj', mmprojPath);
          }

          aiProcess = spawn(serverExe, args, { detached: true });
          aiProcess.on('error', () => { });
          aiProcess.stdout?.on('data', d => console.log(`[AI] ${d}`));
          aiProcess.stderr?.on('data', d => console.error(`[AI ERR] ${d}`));
          aiProcess.on('exit', code => console.log(`[AI Exit] code ${code}`));
          aiProcess.unref();
          mainWindow?.webContents.send('ai-server-started');
        }
      }
    }, 600);

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else mainWindow?.show(); });
  });
}

app.on('before-quit', () => { isQuitting = true; killAIProcess(); });

app.on('window-all-closed', () => {
  killAIProcess();
  if (process.platform !== 'darwin') app.quit();
});

// ─── TTS (Supertonic-3) Persistent Worker ──────────────────────────────────────
function getSupertonic3Path() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'supertonic-3')
    : path.join(__dirname, '../supertonic-3');
}

let ttsWorker: ChildProcess | null = null;
let ttsReadyPromise: Promise<void> | null = null;
let ttsResolvers = new Map<string, (val: any) => void>();

function ensureTtsWorker() {
  if (ttsWorker) return ttsReadyPromise;
  
  ttsReadyPromise = new Promise((resolveReady) => {
    const stPath = getSupertonic3Path();
    const exePath = path.join(stPath, 'tts_worker.exe');
    const workerPath = path.join(stPath, 'tts_worker.py');
    
    if (fs.existsSync(exePath)) {
      ttsWorker = spawn(exePath, ['--model-dir', stPath], { windowsHide: true });
    } else {
      ttsWorker = spawn('python', [workerPath, '--model-dir', stPath], { windowsHide: true });
    }
    
    let buffer = '';
    ttsWorker.stdout?.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const result = JSON.parse(line);
          if (result.status === 'ready') {
            resolveReady();
          } else if (result.id && ttsResolvers.has(result.id)) {
            ttsResolvers.get(result.id)!(result);
            ttsResolvers.delete(result.id);
          }
        } catch (e) {}
      }
    });
    
    ttsWorker.on('close', () => {
      ttsWorker = null;
      ttsReadyPromise = null;
      for (const res of ttsResolvers.values()) res({ success: false, message: 'Worker closed' });
      ttsResolvers.clear();
    });
  });
  
  return ttsReadyPromise;
}

async function generateTTS(text: string, voiceId: string, lang?: string) {
  try {
    await ensureTtsWorker();
    const stPath = getSupertonic3Path();
    const voiceStylePath = path.join(stPath, 'voice_styles', `${voiceId}.json`);
    if (!fs.existsSync(voiceStylePath)) return { success: false, message: 'Voice style not found' };
    
    const reqId = Date.now().toString() + Math.random().toString().substring(2, 6);
    const outputPath = path.join(app.getPath('temp'), `tts_speech_${reqId}.wav`);
    
    return new Promise((resolve) => {
      ttsResolvers.set(reqId, (result) => {
        if (result.success) {
          try {
            const audioData = fs.readFileSync(outputPath);
            const base64Audio = `data:audio/wav;base64,${audioData.toString('base64')}`;
            try { fs.unlinkSync(outputPath); } catch (e) {}
            resolve({ audioPath: outputPath, base64Audio, ...result });
            return;
          } catch (e) {}
        }
        resolve({ success: false, message: 'TTS generation failed' });
      });
      
      ttsWorker?.stdin?.write(JSON.stringify({
        id: reqId,
        text,
        voice: voiceId,
        output: outputPath,
        lang: lang || 'auto'
      }) + '\n');
    });
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

ipcMain.handle('preview-tts', async (_, voiceId: string) => {
  const text = voiceId.startsWith('F') 
    ? 'Hello! I am your AI assistant. How can I help you today?'
    : 'Hi there. I am ready to assist you with anything you need.';
  return generateTTS(text, voiceId);
});

ipcMain.handle('stop-tts', async () => {
  return true;
});

ipcMain.handle('speak-tts', async (_, text: string, voiceId: string, lang?: string) => {
  return generateTTS(text, voiceId, lang);
});


// ─── STT (Speech-to-Text) Worker ─────────────────────────────────────────────
function getSTTPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'my_local_model')
    : path.join(__dirname, '../my_local_model');
}

let sttWorker: ChildProcess | null = null;
let sttReadyPromise: Promise<void> | null = null;
let sttResolvers = new Map<string, (val: any) => void>();

function ensureSttWorker() {
  if (sttWorker) return sttReadyPromise;
  
  sttReadyPromise = new Promise((resolveReady) => {
    const stPath = getSTTPath();
    const exePath = path.join(stPath, 'talk.exe');
    const workerPath = path.join(stPath, 'talk.py');
    
    if (fs.existsSync(exePath)) {
      sttWorker = spawn(exePath, ['--model-dir', stPath], { windowsHide: true });
    } else {
      sttWorker = spawn('python', [workerPath, '--model-dir', stPath], { windowsHide: true });
    }
    
    let buffer = '';
    sttWorker.stdout?.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const result = JSON.parse(line);
          if (result.status === 'ready') {
            resolveReady();
          } else if (result.id && sttResolvers.has(result.id)) {
            sttResolvers.get(result.id)!(result);
            sttResolvers.delete(result.id);
          }
        } catch (e) {}
      }
    });
    
    sttWorker.on('close', () => {
      sttWorker = null;
      sttReadyPromise = null;
      for (const res of sttResolvers.values()) res({ success: false, message: 'Worker closed' });
      sttResolvers.clear();
    });
  });
  
  return sttReadyPromise;
}

async function transcribeAudio(audioPath: string) {
  try {
    await ensureSttWorker();
    
    const reqId = Date.now().toString() + Math.random().toString().substring(2, 6);
    
    return new Promise((resolve) => {
      sttResolvers.set(reqId, (result) => {
        if (result.success) {
          resolve({ text: result.text, ...result });
          return;
        }
        resolve({ success: false, message: 'STT transcription failed' });
      });
      
      sttWorker?.stdin?.write(JSON.stringify({
        id: reqId,
        audio: audioPath
      }) + '\n');
    });
  } catch (e) {
    return { success: false, message: String(e) };
  }
}

ipcMain.handle('transcribe-audio', async (_, audioPath: string) => {
  return transcribeAudio(audioPath);
});

ipcMain.handle('save-audio-to-temp', async (_, base64Audio: string, filename: string) => {
  try {
    const buffer = Buffer.from(base64Audio.split(',')[1], 'base64');
    const tempPath = path.join(app.getPath('temp'), filename);
    fs.writeFileSync(tempPath, buffer);
    return { success: true, path: tempPath };
  } catch (e) {
    return { success: false, message: String(e) };
  }
});


// ─── Window controls ─────────────────────────────────────────────────────────
// ─── Window controls ─────────────────────────────────────────────────────────
ipcMain.on('win-minimize', () => mainWindow?.minimize());
ipcMain.on('win-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isFullScreen()) {
    mainWindow.setFullScreen(false);
    if (previousBounds) {
      mainWindow.setBounds(previousBounds);
      previousBounds = null;
    }
    return;
  }
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    if (previousBounds) mainWindow.setBounds(previousBounds);
  } else {
    previousBounds = mainWindow.getBounds();
    mainWindow.maximize();
  }
});
ipcMain.on('win-close', () => mainWindow?.hide());

ipcMain.on('set-mini-mode', (event, enabled) => {
  if (!mainWindow) return;
  if (enabled) {
    previousBounds = mainWindow.getBounds();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setMinimumSize(0, 0);
    mainWindow.setResizable(false);
    mainWindow.setBackgroundColor('#00000000'); // Fully transparent in mini mode
    mainWindow.setSize(750, 60); // Tight fit for the 52px bar
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setPosition(Math.floor(width / 2 - 375), 40);
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(900, 600);
    if (previousBounds) {
      mainWindow.setBounds(previousBounds);
    } else {
      mainWindow.setSize(1280, 860);
      mainWindow.center();
    }
  }
});

ipcMain.on('resize-window', (event, w, h) => {
  if (mainWindow) {
    mainWindow.setSize(w, h);
  }
});

ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  mainWindow?.setIgnoreMouseEvents(ignore, options);
});

ipcMain.handle('download-project-zip', async (event, name, files: { path: string, content: string }[]) => {
  if (!mainWindow) return { success: false };
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Download Project ZIP',
    defaultPath: `${name || 'project'}.zip`,
    filters: [{ name: 'ZIP Archives', extensions: ['zip'] }]
  });

  if (!filePath) return { success: false };

  return new Promise((resolve) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve({ success: true, path: filePath }));
    archive.on('error', (err: any) => { console.error(err); resolve({ success: false, error: err.message }); });

    archive.pipe(output);
    files.forEach(f => {
      archive.append(f.content, { name: f.path });
    });
    archive.finalize();
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', async () => {
  let settings: any = {
    theme: 'dark', profileName: 'YASSER-27', profileImage: '',
    country: 'Unknown', bio: '',
    systemPrompt: 'You are a professional coding assistant. Provide clear, accurate, and concise answers.',
    introEnabled: false,
    promptTemplates: [],
    aiModels: [],
    imageModel: null,
    fluxModels: { diffusion: '', vae: '', clip_l: '', t5xxl: '' },
    blurEnabled: false,
    wallEnabled: false,
    currentWallpaper: 'wallpaper.png'
  };
  if (fs.existsSync(CONFIG_FILE)) {
    try { settings = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch (e) { }
  }
  settings.customWorkspace = customWorkspacePath;
  return settings;
});
ipcMain.handle('save-settings', async (_, s) => {
  // Sync lastModelPath from active model so auto-start works on next launch
  if (s.aiModels?.length) {
    const active = s.aiModels.find((m: any) => m.isActive);
    if (active) {
      s.lastModelPath = active.modelPath;
      s.lastMmprojPath = active.mmprojPath || null;
    }
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(s, null, 2));
  return true;
});

ipcMain.handle('get-wallpapers', async () => {
  const WALLPAPER_LIST = [
    '3b96a816f648.png',
    'holographic.jpg',
    'cool.jpg',
    'fractal.jpg',
    'May.png',
    'wallpaper.png',
    'white.jpg',
  ];
  const roots = getPublicAssetRoots();
  const found: string[] = [];
  for (const name of WALLPAPER_LIST) {
    for (const root of roots) {
      if (fs.existsSync(path.join(root, name))) {
        found.push(name);
        break;
      }
    }
  }
  return found.length ? found : [...WALLPAPER_LIST];
});

// Profile image upload
ipcMain.handle('upload-profile-image', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Profile Image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    properties: ['openFile']
  });
  if (canceled || filePaths.length === 0) return null;
  const dest = path.join(GITBOT_DIR, 'profile' + path.extname(filePaths[0]));
  fs.copyFileSync(filePaths[0], dest);
  return 'gitbot-profile://' + dest; // Custom protocol marker
});

// Storage usage
ipcMain.handle('get-storage-usage', async () => {
  let size = 0;
  const scan = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, item.name);
      if (item.isDirectory()) scan(p);
      else size += fs.statSync(p).size;
    }
  };
  scan(REPOS_DIR);
  return size; // bytes
});

// ─── Repositories ─────────────────────────────────────────────────────────────
ipcMain.handle('get-repos', async () => {
  if (!fs.existsSync(REPOS_DIR)) return [];
  return fs.readdirSync(REPOS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
});

ipcMain.handle('create-repo', async (_, name: string) => {
  const p = path.join(REPOS_DIR, name);
  if (fs.existsSync(p)) return false;
  fs.mkdirSync(p, { recursive: true });
  // Initialize commit ledger
  fs.writeFileSync(path.join(p, '.gitbot-commits.json'), JSON.stringify([], null, 2));
  return true;
});

ipcMain.handle('delete-repo', async (_, name: string) => {
  const p = path.join(REPOS_DIR, name);
  if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); return true; }
  return false;
});

ipcMain.handle('rename-repo', async (_, oldName: string, newName: string) => {
  const oldPath = path.join(REPOS_DIR, oldName);
  const newPath = path.join(REPOS_DIR, newName);
  if (!fs.existsSync(oldPath)) return { ok: false, message: 'Repository not found' };
  if (fs.existsSync(newPath)) return { ok: false, message: 'A repository with that name already exists' };
  fs.renameSync(oldPath, newPath);
  return { ok: true };
});

ipcMain.handle('toggle-star', async (_, name: string) => {
  const cfg = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) : {};
  const stars: string[] = cfg.stars || [];
  const idx = stars.indexOf(name);
  if (idx >= 0) stars.splice(idx, 1); else stars.push(name);
  cfg.stars = stars;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
  return stars;
});

ipcMain.handle('get-stars', async () => {
  const cfg = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) : {};
  return cfg.stars || [];
});

// ─── Advanced File Operations ──────────────────────────────────────────────────
const recursiveScan = (dir: string, base = ''): any[] => {
  const results: any[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name === '.gitbot-commits.json') continue;
    const relPath = (base ? base + '/' + item.name : item.name);
    const fullPath = path.join(dir, item.name);
    const stats = fs.statSync(fullPath);
    results.push({ name: item.name, path: relPath, isDirectory: item.isDirectory(), size: stats.size, date: stats.mtime.toLocaleDateString() });
  }
  return results.sort((a, b) => (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0) || a.name.localeCompare(b.name));
};

ipcMain.handle('get-repo-files', async (_, name: string, subPath = '') => {
  const p = path.join(REPOS_DIR, name, subPath);
  return recursiveScan(p, subPath);
});

ipcMain.handle('get-file-content', async (_, repoName: string, filePath: string) => {
  const p = path.join(REPOS_DIR, repoName, filePath);
  if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) return fs.readFileSync(p, 'utf8');
  return null;
});

ipcMain.handle('open-file', async (_, repoName: string, filePath: string) => {
  const p = path.join(REPOS_DIR, repoName, filePath);
  if (fs.existsSync(p)) { shell.openPath(p); return true; }
  return false;
});

ipcMain.handle('get-readme', async (_, name: string) => {
  const repoPath = path.join(REPOS_DIR, name);
  if (!fs.existsSync(repoPath)) return null;

  let found = '';
  const searchReadme = (dir: string, depth: number) => {
    if (depth > 2 || found) return;
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.name.toLowerCase() === 'readme.md' || item.name.toLowerCase() === 'readme') {
          found = path.join(dir, item.name);
          return;
        } else if (item.isDirectory() && !item.name.startsWith('.') && item.name !== 'node_modules') {
          searchReadme(path.join(dir, item.name), depth + 1);
        }
      }
    } catch { }
  };
  searchReadme(repoPath, 0);

  if (found) return fs.readFileSync(found, 'utf8');
  return null;
});

ipcMain.handle('get-repo-about', async (_, name: string) => {
  const aboutFile = path.join(REPOS_DIR, name, '.gitbot-about.txt');
  if (fs.existsSync(aboutFile)) return fs.readFileSync(aboutFile, 'utf8').trim();
  return '';
});

ipcMain.handle('save-repo-about', async (_, name: string, about: string) => {
  const aboutFile = path.join(REPOS_DIR, name, '.gitbot-about.txt');
  fs.writeFileSync(aboutFile, about, 'utf8');
  return true;
});

ipcMain.handle('save-file-content', async (_, repoName: string, filePath: string, content: string) => {
  const p = path.join(REPOS_DIR, repoName, filePath);
  if (!fs.existsSync(p)) return false;
  fs.writeFileSync(p, content, 'utf8');
  return true;
});

ipcMain.handle('get-language-stats', async (_, name: string) => {
  const p = path.join(REPOS_DIR, name);
  const stats: Record<string, { size: number; files: string[] }> = {};
  const scan = (dir: string, base = '') => {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.gitbot-commits.json'].includes(item.name)) continue;
      const full = path.join(dir, item.name);
      const rel = base ? base + '/' + item.name : item.name;
      if (item.isDirectory()) scan(full, rel);
      else {
        const ext = path.extname(item.name).toLowerCase();
        if (ext) {
          if (!stats[ext]) stats[ext] = { size: 0, files: [] };
          stats[ext].size += fs.statSync(full).size;
          stats[ext].files.push(rel);
        }
      }
    }
  };
  scan(p);
  return stats;
});

const copyRecursiveSync = (src: string, dest: string) => {
  if (!fs.existsSync(src)) return;
  const s = fs.statSync(src);
  if (s.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src))
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
  } else {
    fs.copyFileSync(src, dest);
  }
};

ipcMain.handle('pick-model-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select AI Model File (.gguf)',
    filters: [
      { name: 'GGUF Models', extensions: ['gguf'] }
    ],
    properties: ['openFile']
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('pick-image-model', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Image Model (.gguf or .safetensors)',
    filters: [
      { name: 'Image Models', extensions: ['gguf', 'safetensors', 'sft'] }
    ],
    properties: ['openFile']
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('pick-mmproj-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Vision Projector File (.gguf)',
    filters: [
      { name: 'Multimodal Projectors', extensions: ['gguf', 'bin'] }
    ],
    properties: ['openFile']
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
});

ipcMain.handle('copy-ai-model', async (event, sourcePath: string) => {
  if (!fs.existsSync(sourcePath)) return { success: false, message: 'Source not found' };
  const fileName = path.basename(sourcePath);
  const destPath = path.join(MODELS_DIR, fileName);
  if (path.resolve(sourcePath) === path.resolve(destPath)) return { success: true, destPath };
  if (fs.existsSync(destPath)) return { success: true, destPath };
  const stats = fs.statSync(sourcePath);
  const totalSize = stats.size;
  let copiedSize = 0;
  return new Promise((resolve) => {
    const readStream = fs.createReadStream(sourcePath);
    const writeStream = fs.createWriteStream(destPath);
    readStream.on('data', (chunk) => {
      copiedSize += chunk.length;
      const percent = Math.round((copiedSize / totalSize) * 100);
      event.sender.send('copy-progress', { fileName, percent });
    });
    writeStream.on('finish', () => resolve({ success: true, destPath }));
    writeStream.on('error', (err: any) => resolve({ success: false, message: err.message }));
    readStream.pipe(writeStream);
  });
});

ipcMain.handle('delete-model-file', async (_, filePath: string) => {
  if (filePath && filePath.startsWith(MODELS_DIR) && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); return true; } catch { return false; }
  }
  return false;
});

ipcMain.handle('pick-skill-files', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select Skill Files or Folders',
    filters: [
      { name: 'Documents', extensions: ['md', 'txt', 'js', 'ts', 'py', 'json', 'css', 'html'] }
    ],
    properties: ['openFile', 'multiSelections']
  });
  if (canceled || filePaths.length === 0) return null;

  const results = [];
  for (const p of filePaths) {
    if (fs.existsSync(p) && fs.lstatSync(p).isFile()) {
      results.push({
        name: path.basename(p),
        path: p,
        content: fs.readFileSync(p, 'utf-8')
      });
    }
  }
  return results;
});

ipcMain.handle('change-workspace', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Select New Global Storage Location',
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || filePaths.length === 0) return false;
  const newPath = filePaths[0];
  const pointerFile = path.join(os.homedir(), '.gitbot', 'workspace.txt');
  fs.writeFileSync(pointerFile, newPath, 'utf-8');
  // Initialize minimal structure to prevent crashes before reloads
  if (!fs.existsSync(path.join(newPath, 'repos'))) {
    fs.mkdirSync(path.join(newPath, 'repos'), { recursive: true });
  }
  return true;
});

ipcMain.handle('change-workspace-default', async () => {
  const pointerFile = path.join(os.homedir(), '.gitbot', 'workspace.txt');
  if (fs.existsSync(pointerFile)) fs.unlinkSync(pointerFile);
  return true;
});

ipcMain.handle('export-multi-repos', async (_, repos: string[]) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export Selected Repositories',
    defaultPath: `Gitbot-Backup-${Date.now()}.zip`,
    filters: [{ name: 'Zip Archives', extensions: ['zip'] }]
  });
  if (canceled || !filePath) return false;
  return new Promise((resolve) => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(true));
    archive.on('error', () => resolve(false));
    archive.pipe(output);
    for (const repo of repos) {
      const p = path.join(REPOS_DIR, repo);
      if (fs.existsSync(p)) archive.directory(p, repo);
    }
    archive.finalize();
  });
});

ipcMain.handle('upload-file', async (_, repoName: string) => {
  const repoPath = path.join(REPOS_DIR, repoName);
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Upload to Project',
    properties: ['openFile', 'openDirectory', 'multiSelections']
  });
  if (canceled || filePaths.length === 0) return { ok: false, files: [] };

  // Folders that should NEVER be copied (heavy/transient)
  const SKIP_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg', 'dist', 'build', 'out',
    '__pycache__', '.venv', 'venv', 'env', '.env', '.next', '.nuxt',
    '.cache', 'vendor', 'bower_components', 'packages', '.dart_tool',
    'target', 'bin', 'obj', 'Pods', '.gradle', '.idea', '.vs', '.vscode',
    'coverage', '.nyc_output', 'tmp', 'temp', '.turbo', '.vercel'
  ]);

  const smartCopy = (src: string, dest: string) => {
    const s = fs.statSync(src);
    if (s.isDirectory()) {
      const dirName = path.basename(src);
      if (SKIP_DIRS.has(dirName)) return; // skip heavy dirs
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      for (const child of fs.readdirSync(src))
        smartCopy(path.join(src, child), path.join(dest, child));
    } else {
      fs.copyFileSync(src, dest);
    }
  };

  const collected: string[] = [];
  const collectFiles = (dir: string, base: string) => {
    const s = fs.statSync(dir);
    if (s.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(dir))) return;
      for (const child of fs.readdirSync(dir))
        collectFiles(path.join(dir, child), base + '/' + child);
    } else {
      collected.push(path.basename(base));
    }
  };

  for (const p of filePaths) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(p))
        smartCopy(path.join(p, child), path.join(repoPath, child));
    } else {
      smartCopy(p, path.join(repoPath, path.basename(p)));
    }
    collectFiles(p, path.basename(p));
  }
  return { ok: true, files: collected };
});

ipcMain.handle('open-in-powershell', async (_, repoName: string) => {
  const repoPath = path.join(REPOS_DIR, repoName);
  if (!fs.existsSync(repoPath)) return false;
  // Use start powershell specifically for better window opening on Windows
  spawn('cmd.exe', ['/c', 'start', 'powershell.exe', '-NoExit', '-Command', `Set-Location -LiteralPath "${repoPath}"`], {
    detached: true, stdio: 'ignore'
  }).unref();
  return true;
});

ipcMain.handle('download-repo', async (_, name: string) => {
  const p = path.join(REPOS_DIR, name);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    title: 'Download Project', defaultPath: `${name}.zip`,
    filters: [{ name: 'Zip Files', extensions: ['zip'] }]
  });
  if (canceled || !filePath) return { success: false };
  return new Promise(resolve => {
    const output = fs.createWriteStream(filePath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve({ success: true }));
    archive.on('error', err => resolve({ success: false, message: err.message }));
    archive.pipe(output);
    archive.directory(p, false);
    archive.finalize();
  });
});

// ─── Commits ──────────────────────────────────────────────────────────────────
ipcMain.handle('get-commits', async (_, name: string) => {
  const ledger = path.join(REPOS_DIR, name, '.gitbot-commits.json');
  if (!fs.existsSync(ledger)) return [];
  return JSON.parse(fs.readFileSync(ledger, 'utf-8'));
});

ipcMain.handle('create-commit', async (_, name: string, message: string) => {
  const repoPath = path.join(REPOS_DIR, name);
  const ledger = path.join(repoPath, '.gitbot-commits.json');
  const commits: any[] = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, 'utf-8')) : [];
  const id = Date.now().toString(36);

  // Create snapshot ZIP
  const gitbotDir = path.join(repoPath, '.gitbot');
  if (!fs.existsSync(gitbotDir)) fs.mkdirSync(gitbotDir, { recursive: true });
  const snapshotZip = path.join(gitbotDir, `${id}.zip`);

  await new Promise(resolve => {
    const output = fs.createWriteStream(snapshotZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(true));
    archive.on('error', () => resolve(false));
    archive.pipe(output);
    archive.glob('**/*', {
      cwd: repoPath,
      ignore: ['.gitbot/**', 'node_modules/**', '.gitbot-commits.json', 'releases/**']
    });
    archive.finalize();
  });

  // Snapshot: store list of files
  const snapshot: string[] = [];
  const scan = (dir: string, base = '') => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === '.gitbot-commits.json' || item.name === 'releases' || item.name === '.gitbot') continue;
      const rel = base ? base + '/' + item.name : item.name;
      if (item.isDirectory()) scan(path.join(dir, item.name), rel);
      else snapshot.push(rel);
    }
  };
  try { scan(repoPath); } catch { }
  commits.unshift({ id, message, date: new Date().toISOString(), files: snapshot });
  fs.writeFileSync(ledger, JSON.stringify(commits, null, 2));
  return { id, date: new Date().toISOString() };
});

ipcMain.handle('open-commit', async (_, name: string, id: string) => {
  const p = path.join(REPOS_DIR, name, '.gitbot', `${id}.zip`);
  if (fs.existsSync(p)) shell.showItemInFolder(p);
  return true;
});

// ─── Releases ─────────────────────────────────────────────────────────────────
ipcMain.handle('get-releases', async (_, name: string) => {
  const relDir = path.join(REPOS_DIR, name, 'releases');
  if (!fs.existsSync(relDir)) return [];
  return fs.readdirSync(relDir, { withFileTypes: true })
    .filter(f => !f.isDirectory())
    .map(f => {
      const stat = fs.statSync(path.join(relDir, f.name));
      return { name: f.name, size: stat.size, date: stat.mtime.toISOString() };
    });
});

ipcMain.handle('upload-release', async (_, name: string) => {
  const relDir = path.join(REPOS_DIR, name, 'releases');
  if (!fs.existsSync(relDir)) fs.mkdirSync(relDir, { recursive: true });
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
    title: 'Upload Release Asset',
    properties: ['openFile', 'multiSelections']
  });
  if (canceled || filePaths.length === 0) return false;
  for (const fp of filePaths)
    fs.copyFileSync(fp, path.join(relDir, path.basename(fp)));
  return true;
});

ipcMain.handle('open-release', async (_, name: string, filename: string) => {
  const p = path.join(REPOS_DIR, name, 'releases', filename);
  if (fs.existsSync(p)) shell.showItemInFolder(p);
  return true;
});

ipcMain.handle('delete-release', async (_, name: string, filename: string) => {
  const p = path.join(REPOS_DIR, name, 'releases', filename);
  if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
  return false;
});

// ─── AI engine ────────────────────────────────────────────────────────────────
ipcMain.handle('start-ai', async (_, providedModelPath?: string, providedMmprojPath?: string) => {
  // if (aiProcess) { aiProcess.kill(); aiProcess = null; }
  killAIProcess(); // Robustly kill previous processes to release file locks (Smart Connection)

  // Smart Grace Period: Wait for OS to release Port 8080 and file locks
  await new Promise(r => setTimeout(r, 1500));



  let configObj: any = {};
  try { if (fs.existsSync(CONFIG_FILE)) configObj = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { }

  const modelPath = providedModelPath || configObj.lastModelPath;

  // Only use lastMmprojPath if we are auto-starting (no paths provided)
  // If providedModelPath is given, we should only use providedMmprojPath (which might be null)
  const mmprojPath = (providedModelPath || providedMmprojPath !== undefined)
    ? (providedMmprojPath || null)
    : (configObj.lastMmprojPath || null);

  const serverExe = app.isPackaged
    ? path.join(process.resourcesPath, 'cpp', 'llama-server.exe')
    : path.join(__dirname, '../cpp', 'llama-server.exe');
  if (!fs.existsSync(serverExe)) return { success: false, message: 'Server not found' };
  if (!fs.existsSync(modelPath)) return { success: false, message: 'Model not found at ' + modelPath };

  const isVision = !!(mmprojPath && fs.existsSync(mmprojPath));

  const args = [
    '-m', modelPath,
    '--port', '8080',
    '--ctx-size', isVision ? '4096' : '8192',
    '-ngl', '99',
    '--parallel', '1',
    '--host', '127.0.0.1',
    '--threads', Math.max(1, os.cpus().length - 1).toString(),
    '--threads-batch', os.cpus().length.toString(),
    '--batch-size', '2048'
  ];

  if (isVision) {
    args.push('--mmproj', mmprojPath as string);
    // Restoration of accuracy/speed parameter for Qwen models
    args.push('--image-min-tokens', '1024');
  }


  aiProcess = spawn(serverExe, args, { detached: true });

  lastAiError = null; // Reset error on new start

  aiProcess.stdout?.on('data', d => console.log(`[AI] ${d}`));
  aiProcess.stderr?.on('data', d => {
    const msg = d.toString();
    console.error(`[AI ERR] ${msg}`);
    // Capture critical error messages for frontend
    if (msg.includes('error:') || msg.includes('failed') || msg.includes('mismatch')) {
      lastAiError = msg;
    }
  });
  aiProcess.on('exit', code => {
    if (code !== null && code !== 0) {
      console.log(`[AI Exit] code ${code}`);
    }
  });

  if (providedModelPath) {
    configObj.lastModelPath = providedModelPath;
    if (!configObj.aiModels) configObj.aiModels = [];
    const exists = configObj.aiModels.find((m: any) => m.modelPath === providedModelPath);
    if (!exists) {
      configObj.aiModels.push({
        id: Date.now().toString(),
        name: path.basename(providedModelPath),
        modelPath: providedModelPath,
        mmprojPath: providedMmprojPath || null,
        isActive: true
      });
    }
  }

  if (providedMmprojPath) configObj.lastMmprojPath = providedMmprojPath;
  else if (!providedModelPath && !providedMmprojPath && mmprojPath) configObj.lastMmprojPath = mmprojPath;

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configObj, null, 2));
  return { success: true };
});

ipcMain.handle('ping-ai', async () => {
  try {
    const res = await fetch('http://127.0.0.1:8080/v1/models');
    return res.ok;
  } catch { return false; }
});

ipcMain.handle('generate-image', async (event, options: {
  prompt: string;
  modelPath: string;
  vaePath?: string;
  clipLPath?: string;
  t5xxlPath?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
}) => {
  const sdCli = app.isPackaged
    ? path.join(process.resourcesPath, 'cpp', 'sd-cli.exe')
    : path.join(__dirname, '../cpp', 'sd-cli.exe');

  if (!fs.existsSync(sdCli)) return { success: false, message: 'sd-cli.exe not found' };

  killAIProcess(); // Always stop Chat AI to free up maximum CPU/RAM for generation

  const id = Date.now().toString();
  const outPath = path.join(GENERATED_IMAGES_DIR, `gen_${id}.png`);

  const allThreads = os.cpus().length;

  const args = [
    '-m', options.modelPath,
    '-p', options.prompt,
    '-o', outPath,
    '--width', (options.width || 512).toString(),
    '--height', (options.height || 512).toString(),
    '--steps', (options.steps || 4).toString(),
    '--cfg-scale', (options.cfgScale || 2.0).toString(),
    '--vae-tiling',
    '--vae-on-cpu', // Reduce peak memory pressure
    '-s', '-1',
    '--threads', allThreads.toString(),
    '--sampling-method', 'euler_a'
  ];

  // Auto-linking logic for Flux (already passed from frontend if detected, but we ensure they exists)
  if (options.vaePath && fs.existsSync(options.vaePath)) args.push('--vae', options.vaePath);
  if (options.clipLPath && fs.existsSync(options.clipLPath)) args.push('--clip_l', options.clipLPath);
  if (options.t5xxlPath && fs.existsSync(options.t5xxlPath)) args.push('--t5xxl', options.t5xxlPath);

  imageGenStatus = { generating: true, prompt: options.prompt, startedAt: Date.now() };
  return new Promise((resolve) => {
    imageGenProcess = spawn(sdCli, args);
    let output = '';

    imageGenProcess.stdout?.on('data', d => {
      const line = d.toString();
      output += line;
      // Send progress updates if visible in logs (e.g., "[ 25%]")
      mainWindow?.webContents.send('image-gen-log', line);
    });
    imageGenProcess.stderr?.on('data', d => {
      const line = d.toString();
      output += line;
      mainWindow?.webContents.send('image-gen-log', line);
    });

    imageGenProcess.on('exit', (code) => {
      imageGenProcess = null;
      const durationStr = imageGenStatus.startedAt ? ((Date.now() - imageGenStatus.startedAt) / 1000).toFixed(1) : undefined;
      imageGenStatus = { generating: false };

      if (code === 0 && fs.existsSync(outPath)) {
        const result = { success: true, imagePath: 'gitbot-profile://' + outPath, prompt: options.prompt, duration: durationStr };
        imageGenLastResult = result;
        mainWindow?.webContents.send('image-gen-complete', result);
        resolve(result);
      } else {
        const result = { success: false, message: output || 'Generation failed or stopped', duration: durationStr };
        imageGenLastResult = result;
        mainWindow?.webContents.send('image-gen-complete', result);
        resolve(result);
      }

      //  Auto-restart Chat AI if it was killed before generation
      if (!aiProcess) {
        try {
          const configObj: any = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) : {};
          const activeModel = configObj.aiModels?.find((m: any) => m.isActive);
          const aiPath = activeModel?.modelPath || configObj.lastModelPath;
          const mmprojPath = activeModel?.mmprojPath || configObj.lastMmprojPath || null;
          const serverExe = app.isPackaged
            ? path.join(process.resourcesPath, 'cpp', 'llama-server.exe')
            : path.join(__dirname, '../cpp', 'llama-server.exe');

          if (aiPath && fs.existsSync(aiPath) && fs.existsSync(serverExe)) {
            const isVision = !!(mmprojPath && fs.existsSync(mmprojPath));
            const restartArgs = [
              '-m', aiPath,
              '--port', '8080',
              '--ctx-size', isVision ? '8192' : '8192',
              '--n-predict', '4096',
              '--threads', Math.max(1, os.cpus().length - 1).toString(),
              '--threads-batch', os.cpus().length.toString(),
              '--parallel', '1',
              '--batch-size', '512',
              '--flash-attn', 'auto',
              '--ctx-shift'
            ];
            if (isVision) {
              restartArgs.push('--mmproj', mmprojPath as string);
              restartArgs.push('--image-min-tokens', '1024');
            }
            console.log('[AI] Auto-restarting after image generation...');
            aiProcess = spawn(serverExe, restartArgs, { detached: true });
            lastAiError = null;
            aiProcess.stdout?.on('data', d => console.log(`[AI] ${d}`));
            aiProcess.stderr?.on('data', d => console.error(`[AI ERR] ${d}`));
            aiProcess.on('exit', code => { aiProcess = null; console.log(`[AI Exit] code ${code}`); });
          }
        } catch (e) {
          console.error('[AI] Failed to auto-restart after generation:', e);
        }
      }
    });

  });
});

ipcMain.handle('get-image-gen-status', async () => imageGenStatus);

ipcMain.handle('get-image-gen-last-result', async () => {
  const result = imageGenLastResult;
  imageGenLastResult = null; // consume once
  return result;
});

ipcMain.handle('stop-generate-image', async () => {
  if (imageGenProcess) {
    imageGenProcess.kill();
    imageGenProcess = null;
    return true;
  }
  return false;
});

ipcMain.handle('get-generated-images', async () => {
  if (!fs.existsSync(GENERATED_IMAGES_DIR)) return [];
  const files = fs.readdirSync(GENERATED_IMAGES_DIR)
    .filter(f => f.endsWith('.png'))
    .map(f => ({
      name: f,
      path: 'gitbot-profile://' + path.join(GENERATED_IMAGES_DIR, f),
      date: fs.statSync(path.join(GENERATED_IMAGES_DIR, f)).mtime.toISOString()
    }))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return files;
});

ipcMain.handle('delete-generated-image', async (_, imagePath: string) => {
  try {
    // If it's a URL with the protocol, extract the real path
    let realPath = imagePath;
    if (imagePath.startsWith('gitbot-profile://')) {
      realPath = imagePath.replace('gitbot-profile://', '');
      // Handle drive letters if they were transformed (C/ -> C:)
      if (realPath.match(/^[a-zA-Z]\//)) {
        realPath = realPath.charAt(0) + ':' + realPath.substring(1);
      }
    }

    if (fs.existsSync(realPath)) {
      fs.unlinkSync(realPath);
      return { success: true };
    }
    return { success: false, message: 'File not found' };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('get-ai-error', async () => {
  return lastAiError;
});

// Create files from AI plan (used by /plan command)
ipcMain.handle('create-repo-from-plan', async (_, repoName: string, files: { path: string; content: string }[]) => {
  let finalName = repoName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || 'ai-project';
  let repoPath = path.join(REPOS_DIR, finalName);

  if (fs.existsSync(repoPath)) {
    finalName = `${finalName}-${Date.now().toString().slice(-6)}`;
    repoPath = path.join(REPOS_DIR, finalName);
  }

  fs.mkdirSync(repoPath, { recursive: true });
  for (const f of files) {
    const fullPath = path.join(repoPath, f.path);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, f.content, 'utf-8');
  }
  // Initialize commit ledger
  const commits = [{ id: 'init', message: 'Initial commit (AI Generated)', date: new Date().toISOString(), files: files.map(f => f.path) }];
  fs.writeFileSync(path.join(repoPath, '.gitbot-commits.json'), JSON.stringify(commits, null, 2));
  return { success: true, name: finalName };
});
