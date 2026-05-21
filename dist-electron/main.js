import { BrowserWindow, Menu, Tray, app, dialog, globalShortcut, ipcMain, protocol, screen, session, shell } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import archiver from "archiver";
import { fileURLToPath } from "url";
import { execSync, spawn } from "child_process";
//#region electron/main.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
function getPublicAssetRoots() {
	const roots = [];
	if (app.isPackaged) {
		roots.push(path.join(process.resourcesPath, "public"));
		roots.push(path.join(process.resourcesPath, "dist"));
		roots.push(path.join(app.getAppPath(), "assets"));
		roots.push(path.join(app.getAppPath(), "dist", "assets"));
	}
	roots.push(path.join(__dirname, "../public"));
	roots.push(path.join(__dirname, "../dist"));
	roots.push(path.join(__dirname, "../assets"));
	return roots;
}
function resolvePublicAssetPath(relativePath) {
	const clean = relativePath.replace(/^\/+/, "").replace(/\.\./g, "");
	for (const root of getPublicAssetRoots()) {
		const full = path.join(root, clean);
		if (fs.existsSync(full)) return full;
	}
	return null;
}
var GITBOT_DIR = path.join(os.homedir(), ".gitbot");
var WORKSPACE_FILE = path.join(os.homedir(), ".gitbot", "workspace.txt");
var customWorkspacePath = null;
if (fs.existsSync(WORKSPACE_FILE)) {
	const custom = fs.readFileSync(WORKSPACE_FILE, "utf-8").trim();
	if (custom && fs.existsSync(custom)) {
		GITBOT_DIR = custom;
		customWorkspacePath = custom;
	}
}
var CONFIG_FILE = path.join(GITBOT_DIR, "config.json");
var REPOS_DIR = path.join(GITBOT_DIR, "repos");
var MODELS_DIR = path.join(GITBOT_DIR, "models");
path.join(GITBOT_DIR, "profile.png");
var GENERATED_IMAGES_DIR = path.join(GITBOT_DIR, "generated_images");
var aiProcess = null;
var imageGenProcess = null;
var imageGenStatus = { generating: false };
var imageGenLastResult = null;
var lastAiError = null;
var mainWindow = null;
var tray = null;
var isQuitting = false;
var previousBounds = null;
function killAIProcess() {
	try {
		execSync("taskkill /F /IM llama-server.exe /T", { stdio: "ignore" });
	} catch {}
	try {
		if (aiProcess) {
			try {
				if (process.platform === "win32") {
					const pid = aiProcess.pid;
					if (pid) spawn("taskkill", [
						"/pid",
						pid.toString(),
						"/f",
						"/t"
					]);
				} else process.kill(-aiProcess.pid);
			} catch (e) {}
			aiProcess = null;
		}
	} catch {}
}
if (!fs.existsSync(path.join(os.homedir(), ".gitbot"))) fs.mkdirSync(path.join(os.homedir(), ".gitbot"), { recursive: true });
for (const d of [
	GITBOT_DIR,
	REPOS_DIR,
	MODELS_DIR,
	GENERATED_IMAGES_DIR
]) if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
function createWindow() {
	mainWindow = new BrowserWindow({
		width: 980,
		height: 660,
		minWidth: 900,
		minHeight: 600,
		frame: false,
		titleBarStyle: "hidden",
		transparent: true,
		show: true,
		backgroundColor: "#12151c",
		icon: path.join(__dirname, "../assets/icon.ico"),
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: false,
			backgroundThrottling: false
		},
		...process.platform === "win32" ? { roundedCorners: true } : {}
	});
	mainWindow.once("ready-to-show", () => {
		if (!mainWindow) return;
		mainWindow.setOpacity(1);
		mainWindow.show();
		mainWindow.focus();
	});
	if (app.isPackaged) {
		Menu.setApplicationMenu(null);
		mainWindow.webContents.on("devtools-opened", () => {
			mainWindow?.webContents.closeDevTools();
		});
	}
	mainWindow.on("close", (e) => {
		if (!isQuitting) {
			e.preventDefault();
			mainWindow?.hide();
		}
	});
	mainWindow.webContents.on("before-input-event", (event, input) => {
		if (input.type !== "keyDown" || input.key !== "F11" || !mainWindow) return;
		event.preventDefault();
		if (!mainWindow.isFullScreen()) {
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
	if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
	else mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
}
protocol.registerSchemesAsPrivileged([
	{
		scheme: "gitbot-repo",
		privileges: {
			bypassCSP: true,
			supportFetchAPI: true,
			standard: true,
			secure: true,
			corsEnabled: true,
			allowServiceWorkers: true
		}
	},
	{
		scheme: "gitbot-profile",
		privileges: {
			bypassCSP: true,
			supportFetchAPI: true,
			standard: true,
			secure: true,
			corsEnabled: true
		}
	},
	{
		scheme: "xai-asset",
		privileges: {
			bypassCSP: true,
			supportFetchAPI: true,
			standard: true,
			secure: true,
			corsEnabled: true
		}
	}
]);
if (!app.requestSingleInstanceLock()) app.quit();
else {
	app.on("second-instance", (event, commandLine, workingDirectory) => {
		if (mainWindow) {
			if (!mainWindow.isVisible()) mainWindow.show();
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}
	});
	app.whenReady().then(() => {
		protocol.registerFileProtocol("xai-asset", (request, callback) => {
			try {
				const resolved = resolvePublicAssetPath(decodeURIComponent(request.url.replace(/^xai-asset:\/\//, "")));
				if (resolved) callback({ path: resolved });
				else callback({ error: -6 });
			} catch {
				callback({ error: -2 });
			}
		});
		ipcMain.on("sync-is-packaged", (event) => {
			event.returnValue = app.isPackaged;
		});
		const iconPath = app.isPackaged ? path.join(app.getAppPath(), "assets", "icon.ico") : path.join(__dirname, "../assets/icon.ico");
		if (fs.existsSync(iconPath)) {
			tray = new Tray(iconPath);
			const contextMenu = Menu.buildFromTemplate([
				{
					label: "Show XAi",
					click: () => {
						mainWindow?.show();
						mainWindow?.focus();
					}
				},
				{
					label: "Hide XAi",
					click: () => mainWindow?.hide()
				},
				{ type: "separator" },
				{
					label: "Quit",
					click: () => {
						isQuitting = true;
						killAIProcess();
						app.quit();
					}
				}
			]);
			tray.setToolTip("XAi — F8 to show/hide");
			tray.setContextMenu(contextMenu);
			tray.on("double-click", () => {
				if (!mainWindow) return;
				if (mainWindow.isVisible()) mainWindow.hide();
				else {
					mainWindow.show();
					mainWindow.focus();
				}
			});
			console.log("Tray initialized successfully");
		}
		const toggleWindowVisibility = () => {
			if (!mainWindow) return;
			if (mainWindow.isVisible()) mainWindow.hide();
			else {
				mainWindow.show();
				mainWindow.focus();
			}
		};
		for (const key of ["F8", "F9"]) if (!globalShortcut.register(key, toggleWindowVisibility)) console.error(`${key} registration failed`);
		else console.log(`${key} shortcut registered`);
		protocol.registerFileProtocol("gitbot-repo", (request, callback) => {
			try {
				let urlPath = request.url.replace("gitbot-repo://local/", "").replace("gitbot-repo://", "");
				const decoded = decodeURIComponent(urlPath);
				callback({ path: path.join(REPOS_DIR, decoded) });
			} catch {
				callback({ error: -6 });
			}
		});
		protocol.registerFileProtocol("gitbot-profile", (request, callback) => {
			let url = decodeURIComponent(request.url.replace("gitbot-profile://", ""));
			if (url.match(/^[a-zA-Z]\//)) url = url.charAt(0) + ":" + url.substring(1);
			try {
				callback(url);
			} catch {
				callback({ error: -6 });
			}
		});
		createWindow();
		session.defaultSession.on("will-download", (event, item, webContents) => {
			item.setSaveDialogOptions({
				title: "Save Image",
				defaultPath: item.getFilename()
			});
		});
		setTimeout(() => {
			let configObj = {};
			try {
				if (fs.existsSync(CONFIG_FILE)) configObj = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
			} catch {}
			if (configObj.autoStartAI !== false) {
				mainWindow?.webContents.send("ai-server-starting");
				let aiModel = configObj.aiModels?.find((m) => m.isActive);
				const argvModel = process.argv.find((arg) => arg.toLowerCase().endsWith(".gguf") && fs.existsSync(arg));
				let aiPath = argvModel || aiModel?.modelPath || configObj.lastModelPath;
				let mmprojPath = argvModel ? null : aiModel?.mmprojPath || configObj.lastMmprojPath;
				if (argvModel) {
					configObj.lastModelPath = argvModel;
					configObj.lastMmprojPath = null;
					try {
						fs.writeFileSync(CONFIG_FILE, JSON.stringify(configObj, null, 2));
					} catch {}
				}
				if (aiPath && fs.existsSync(aiPath)) {
					console.log("Auto-starting AI...");
					const serverExe = app.isPackaged ? path.join(process.resourcesPath, "cpp", "llama-server.exe") : path.join(__dirname, "../cpp", "llama-server.exe");
					const args = [
						"-m",
						aiPath,
						"--port",
						"8080",
						"--ctx-size",
						!!(mmprojPath && fs.existsSync(mmprojPath)) ? "4096" : "8192",
						"-ngl",
						"99",
						"--parallel",
						"1",
						"--host",
						"127.0.0.1",
						"--threads",
						Math.max(1, os.cpus().length - 1).toString(),
						"--threads-batch",
						os.cpus().length.toString(),
						"--batch-size",
						"2048"
					];
					if (mmprojPath && fs.existsSync(mmprojPath)) args.push("--mmproj", mmprojPath);
					aiProcess = spawn(serverExe, args, { detached: true });
					aiProcess.on("error", () => {});
					aiProcess.stdout?.on("data", (d) => console.log(`[AI] ${d}`));
					aiProcess.stderr?.on("data", (d) => console.error(`[AI ERR] ${d}`));
					aiProcess.on("exit", (code) => console.log(`[AI Exit] code ${code}`));
					aiProcess.unref();
					mainWindow?.webContents.send("ai-server-started");
				}
			}
		}, 600);
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) createWindow();
			else mainWindow?.show();
		});
	});
}
app.on("before-quit", () => {
	isQuitting = true;
	killAIProcess();
});
app.on("window-all-closed", () => {
	killAIProcess();
	if (process.platform !== "darwin") app.quit();
});
function getSupertonic3Path() {
	return app.isPackaged ? path.join(process.resourcesPath, "supertonic-3") : path.join(__dirname, "../supertonic-3");
}
var ttsWorker = null;
var ttsReadyPromise = null;
var ttsResolvers = /* @__PURE__ */ new Map();
function ensureTtsWorker() {
	if (ttsWorker) return ttsReadyPromise;
	ttsReadyPromise = new Promise((resolveReady) => {
		const stPath = getSupertonic3Path();
		const exePath = path.join(stPath, "tts_worker.exe");
		const workerPath = path.join(stPath, "tts_worker.py");
		if (fs.existsSync(exePath)) ttsWorker = spawn(exePath, ["--model-dir", stPath], { windowsHide: true });
		else ttsWorker = spawn("python", [
			workerPath,
			"--model-dir",
			stPath
		], { windowsHide: true });
		let buffer = "";
		ttsWorker.stdout?.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const result = JSON.parse(line);
					if (result.status === "ready") resolveReady();
					else if (result.id && ttsResolvers.has(result.id)) {
						ttsResolvers.get(result.id)(result);
						ttsResolvers.delete(result.id);
					}
				} catch (e) {}
			}
		});
		ttsWorker.on("close", () => {
			ttsWorker = null;
			ttsReadyPromise = null;
			for (const res of ttsResolvers.values()) res({
				success: false,
				message: "Worker closed"
			});
			ttsResolvers.clear();
		});
	});
	return ttsReadyPromise;
}
async function generateTTS(text, voiceId, lang) {
	try {
		await ensureTtsWorker();
		const stPath = getSupertonic3Path();
		const voiceStylePath = path.join(stPath, "voice_styles", `${voiceId}.json`);
		if (!fs.existsSync(voiceStylePath)) return {
			success: false,
			message: "Voice style not found"
		};
		const reqId = Date.now().toString() + Math.random().toString().substring(2, 6);
		const outputPath = path.join(app.getPath("temp"), `tts_speech_${reqId}.wav`);
		return new Promise((resolve) => {
			ttsResolvers.set(reqId, (result) => {
				if (result.success) try {
					const base64Audio = `data:audio/wav;base64,${fs.readFileSync(outputPath).toString("base64")}`;
					try {
						fs.unlinkSync(outputPath);
					} catch (e) {}
					resolve({
						audioPath: outputPath,
						base64Audio,
						...result
					});
					return;
				} catch (e) {}
				resolve({
					success: false,
					message: "TTS generation failed"
				});
			});
			ttsWorker?.stdin?.write(JSON.stringify({
				id: reqId,
				text,
				voice: voiceId,
				output: outputPath,
				lang: lang || "auto"
			}) + "\n");
		});
	} catch (e) {
		return {
			success: false,
			message: String(e)
		};
	}
}
ipcMain.handle("preview-tts", async (_, voiceId) => {
	return generateTTS(voiceId.startsWith("F") ? "Hello! I am your AI assistant. How can I help you today?" : "Hi there. I am ready to assist you with anything you need.", voiceId);
});
ipcMain.handle("stop-tts", async () => {
	return true;
});
ipcMain.handle("speak-tts", async (_, text, voiceId, lang) => {
	return generateTTS(text, voiceId, lang);
});
function getSTTPath() {
	return app.isPackaged ? path.join(process.resourcesPath, "my_local_model") : path.join(__dirname, "../my_local_model");
}
var sttWorker = null;
var sttReadyPromise = null;
var sttResolvers = /* @__PURE__ */ new Map();
function ensureSttWorker() {
	if (sttWorker) return sttReadyPromise;
	sttReadyPromise = new Promise((resolveReady) => {
		const stPath = getSTTPath();
		const exePath = path.join(stPath, "talk.exe");
		const workerPath = path.join(stPath, "talk.py");
		if (fs.existsSync(exePath)) sttWorker = spawn(exePath, ["--model-dir", stPath], { windowsHide: true });
		else sttWorker = spawn("python", [
			workerPath,
			"--model-dir",
			stPath
		], { windowsHide: true });
		let buffer = "";
		sttWorker.stdout?.on("data", (data) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";
			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const result = JSON.parse(line);
					if (result.status === "ready") resolveReady();
					else if (result.id && sttResolvers.has(result.id)) {
						sttResolvers.get(result.id)(result);
						sttResolvers.delete(result.id);
					}
				} catch (e) {}
			}
		});
		sttWorker.on("close", () => {
			sttWorker = null;
			sttReadyPromise = null;
			for (const res of sttResolvers.values()) res({
				success: false,
				message: "Worker closed"
			});
			sttResolvers.clear();
		});
	});
	return sttReadyPromise;
}
async function transcribeAudio(audioPath) {
	try {
		await ensureSttWorker();
		const reqId = Date.now().toString() + Math.random().toString().substring(2, 6);
		return new Promise((resolve) => {
			sttResolvers.set(reqId, (result) => {
				if (result.success) {
					resolve({
						text: result.text,
						...result
					});
					return;
				}
				resolve({
					success: false,
					message: "STT transcription failed"
				});
			});
			sttWorker?.stdin?.write(JSON.stringify({
				id: reqId,
				audio: audioPath
			}) + "\n");
		});
	} catch (e) {
		return {
			success: false,
			message: String(e)
		};
	}
}
ipcMain.handle("transcribe-audio", async (_, audioPath) => {
	return transcribeAudio(audioPath);
});
ipcMain.handle("save-audio-to-temp", async (_, base64Audio, filename) => {
	try {
		const buffer = Buffer.from(base64Audio.split(",")[1], "base64");
		const tempPath = path.join(app.getPath("temp"), filename);
		fs.writeFileSync(tempPath, buffer);
		return {
			success: true,
			path: tempPath
		};
	} catch (e) {
		return {
			success: false,
			message: String(e)
		};
	}
});
ipcMain.on("win-minimize", () => mainWindow?.minimize());
ipcMain.on("win-maximize", () => {
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
ipcMain.on("win-close", () => mainWindow?.hide());
ipcMain.on("set-mini-mode", (event, enabled) => {
	if (!mainWindow) return;
	if (enabled) {
		previousBounds = mainWindow.getBounds();
		mainWindow.setAlwaysOnTop(true, "screen-saver");
		mainWindow.setMinimumSize(0, 0);
		mainWindow.setResizable(false);
		mainWindow.setBackgroundColor("#00000000");
		mainWindow.setSize(750, 60);
		const { width } = screen.getPrimaryDisplay().workAreaSize;
		mainWindow.setPosition(Math.floor(width / 2 - 375), 40);
	} else {
		mainWindow.setAlwaysOnTop(false);
		mainWindow.setResizable(true);
		mainWindow.setMinimumSize(900, 600);
		if (previousBounds) mainWindow.setBounds(previousBounds);
		else {
			mainWindow.setSize(1280, 860);
			mainWindow.center();
		}
	}
});
ipcMain.on("resize-window", (event, w, h) => {
	if (mainWindow) mainWindow.setSize(w, h);
});
ipcMain.on("set-ignore-mouse-events", (event, ignore, options) => {
	mainWindow?.setIgnoreMouseEvents(ignore, options);
});
ipcMain.handle("download-project-zip", async (event, name, files) => {
	if (!mainWindow) return { success: false };
	const { filePath } = await dialog.showSaveDialog(mainWindow, {
		title: "Download Project ZIP",
		defaultPath: `${name || "project"}.zip`,
		filters: [{
			name: "ZIP Archives",
			extensions: ["zip"]
		}]
	});
	if (!filePath) return { success: false };
	return new Promise((resolve) => {
		const output = fs.createWriteStream(filePath);
		const archive = archiver("zip", { zlib: { level: 9 } });
		output.on("close", () => resolve({
			success: true,
			path: filePath
		}));
		archive.on("error", (err) => {
			console.error(err);
			resolve({
				success: false,
				error: err.message
			});
		});
		archive.pipe(output);
		files.forEach((f) => {
			archive.append(f.content, { name: f.path });
		});
		archive.finalize();
	});
});
ipcMain.handle("get-settings", async () => {
	let settings = {
		theme: "dark",
		profileName: "YASSER-27",
		profileImage: "",
		country: "Unknown",
		bio: "",
		systemPrompt: "You are a professional coding assistant. Provide clear, accurate, and concise answers.",
		introEnabled: false,
		promptTemplates: [],
		aiModels: [],
		imageModel: null,
		fluxModels: {
			diffusion: "",
			vae: "",
			clip_l: "",
			t5xxl: ""
		},
		blurEnabled: false,
		wallEnabled: false,
		currentWallpaper: "wallpaper.png"
	};
	if (fs.existsSync(CONFIG_FILE)) try {
		settings = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
	} catch (e) {}
	settings.customWorkspace = customWorkspacePath;
	return settings;
});
ipcMain.handle("save-settings", async (_, s) => {
	if (s.aiModels?.length) {
		const active = s.aiModels.find((m) => m.isActive);
		if (active) {
			s.lastModelPath = active.modelPath;
			s.lastMmprojPath = active.mmprojPath || null;
		}
	}
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(s, null, 2));
	return true;
});
ipcMain.handle("get-wallpapers", async () => {
	const WALLPAPER_LIST = [
		"3b96a816f648.png",
		"holographic.jpg",
		"cool.jpg",
		"fractal.jpg",
		"May.png",
		"wallpaper.png",
		"white.jpg"
	];
	const roots = getPublicAssetRoots();
	const found = [];
	for (const name of WALLPAPER_LIST) for (const root of roots) if (fs.existsSync(path.join(root, name))) {
		found.push(name);
		break;
	}
	return found.length ? found : [...WALLPAPER_LIST];
});
ipcMain.handle("upload-profile-image", async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: "Select Profile Image",
		filters: [{
			name: "Images",
			extensions: [
				"png",
				"jpg",
				"jpeg",
				"gif",
				"webp"
			]
		}],
		properties: ["openFile"]
	});
	if (canceled || filePaths.length === 0) return null;
	const dest = path.join(GITBOT_DIR, "profile" + path.extname(filePaths[0]));
	fs.copyFileSync(filePaths[0], dest);
	return "gitbot-profile://" + dest;
});
ipcMain.handle("get-storage-usage", async () => {
	let size = 0;
	const scan = (dir) => {
		if (!fs.existsSync(dir)) return;
		for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, item.name);
			if (item.isDirectory()) scan(p);
			else size += fs.statSync(p).size;
		}
	};
	scan(REPOS_DIR);
	return size;
});
ipcMain.handle("get-repos", async () => {
	if (!fs.existsSync(REPOS_DIR)) return [];
	return fs.readdirSync(REPOS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
});
ipcMain.handle("create-repo", async (_, name) => {
	const p = path.join(REPOS_DIR, name);
	if (fs.existsSync(p)) return false;
	fs.mkdirSync(p, { recursive: true });
	fs.writeFileSync(path.join(p, ".gitbot-commits.json"), JSON.stringify([], null, 2));
	return true;
});
ipcMain.handle("delete-repo", async (_, name) => {
	const p = path.join(REPOS_DIR, name);
	if (fs.existsSync(p)) {
		fs.rmSync(p, {
			recursive: true,
			force: true
		});
		return true;
	}
	return false;
});
ipcMain.handle("rename-repo", async (_, oldName, newName) => {
	const oldPath = path.join(REPOS_DIR, oldName);
	const newPath = path.join(REPOS_DIR, newName);
	if (!fs.existsSync(oldPath)) return {
		ok: false,
		message: "Repository not found"
	};
	if (fs.existsSync(newPath)) return {
		ok: false,
		message: "A repository with that name already exists"
	};
	fs.renameSync(oldPath, newPath);
	return { ok: true };
});
ipcMain.handle("toggle-star", async (_, name) => {
	const cfg = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) : {};
	const stars = cfg.stars || [];
	const idx = stars.indexOf(name);
	if (idx >= 0) stars.splice(idx, 1);
	else stars.push(name);
	cfg.stars = stars;
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
	return stars;
});
ipcMain.handle("get-stars", async () => {
	return (fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) : {}).stars || [];
});
var recursiveScan = (dir, base = "") => {
	const results = [];
	if (!fs.existsSync(dir)) return results;
	for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
		if (item.name === ".gitbot-commits.json") continue;
		const relPath = base ? base + "/" + item.name : item.name;
		const fullPath = path.join(dir, item.name);
		const stats = fs.statSync(fullPath);
		results.push({
			name: item.name,
			path: relPath,
			isDirectory: item.isDirectory(),
			size: stats.size,
			date: stats.mtime.toLocaleDateString()
		});
	}
	return results.sort((a, b) => (b.isDirectory ? 1 : 0) - (a.isDirectory ? 1 : 0) || a.name.localeCompare(b.name));
};
ipcMain.handle("get-repo-files", async (_, name, subPath = "") => {
	return recursiveScan(path.join(REPOS_DIR, name, subPath), subPath);
});
ipcMain.handle("get-file-content", async (_, repoName, filePath) => {
	const p = path.join(REPOS_DIR, repoName, filePath);
	if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) return fs.readFileSync(p, "utf8");
	return null;
});
ipcMain.handle("open-file", async (_, repoName, filePath) => {
	const p = path.join(REPOS_DIR, repoName, filePath);
	if (fs.existsSync(p)) {
		shell.openPath(p);
		return true;
	}
	return false;
});
ipcMain.handle("get-readme", async (_, name) => {
	const repoPath = path.join(REPOS_DIR, name);
	if (!fs.existsSync(repoPath)) return null;
	let found = "";
	const searchReadme = (dir, depth) => {
		if (depth > 2 || found) return;
		try {
			const items = fs.readdirSync(dir, { withFileTypes: true });
			for (const item of items) if (item.name.toLowerCase() === "readme.md" || item.name.toLowerCase() === "readme") {
				found = path.join(dir, item.name);
				return;
			} else if (item.isDirectory() && !item.name.startsWith(".") && item.name !== "node_modules") searchReadme(path.join(dir, item.name), depth + 1);
		} catch {}
	};
	searchReadme(repoPath, 0);
	if (found) return fs.readFileSync(found, "utf8");
	return null;
});
ipcMain.handle("get-repo-about", async (_, name) => {
	const aboutFile = path.join(REPOS_DIR, name, ".gitbot-about.txt");
	if (fs.existsSync(aboutFile)) return fs.readFileSync(aboutFile, "utf8").trim();
	return "";
});
ipcMain.handle("save-repo-about", async (_, name, about) => {
	const aboutFile = path.join(REPOS_DIR, name, ".gitbot-about.txt");
	fs.writeFileSync(aboutFile, about, "utf8");
	return true;
});
ipcMain.handle("save-file-content", async (_, repoName, filePath, content) => {
	const p = path.join(REPOS_DIR, repoName, filePath);
	if (!fs.existsSync(p)) return false;
	fs.writeFileSync(p, content, "utf8");
	return true;
});
ipcMain.handle("get-language-stats", async (_, name) => {
	const p = path.join(REPOS_DIR, name);
	const stats = {};
	const scan = (dir, base = "") => {
		if (!fs.existsSync(dir)) return;
		for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
			if ([
				"node_modules",
				".git",
				".gitbot-commits.json"
			].includes(item.name)) continue;
			const full = path.join(dir, item.name);
			const rel = base ? base + "/" + item.name : item.name;
			if (item.isDirectory()) scan(full, rel);
			else {
				const ext = path.extname(item.name).toLowerCase();
				if (ext) {
					if (!stats[ext]) stats[ext] = {
						size: 0,
						files: []
					};
					stats[ext].size += fs.statSync(full).size;
					stats[ext].files.push(rel);
				}
			}
		}
	};
	scan(p);
	return stats;
});
ipcMain.handle("pick-model-file", async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: "Select AI Model File (.gguf)",
		filters: [{
			name: "GGUF Models",
			extensions: ["gguf"]
		}],
		properties: ["openFile"]
	});
	if (canceled || filePaths.length === 0) return null;
	return filePaths[0];
});
ipcMain.handle("pick-image-model", async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: "Select Image Model (.gguf or .safetensors)",
		filters: [{
			name: "Image Models",
			extensions: [
				"gguf",
				"safetensors",
				"sft"
			]
		}],
		properties: ["openFile"]
	});
	if (canceled || filePaths.length === 0) return null;
	return filePaths[0];
});
ipcMain.handle("pick-mmproj-file", async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: "Select Vision Projector File (.gguf)",
		filters: [{
			name: "Multimodal Projectors",
			extensions: ["gguf", "bin"]
		}],
		properties: ["openFile"]
	});
	if (canceled || filePaths.length === 0) return null;
	return filePaths[0];
});
ipcMain.handle("copy-ai-model", async (event, sourcePath) => {
	if (!fs.existsSync(sourcePath)) return {
		success: false,
		message: "Source not found"
	};
	const fileName = path.basename(sourcePath);
	const destPath = path.join(MODELS_DIR, fileName);
	if (path.resolve(sourcePath) === path.resolve(destPath)) return {
		success: true,
		destPath
	};
	if (fs.existsSync(destPath)) return {
		success: true,
		destPath
	};
	const totalSize = fs.statSync(sourcePath).size;
	let copiedSize = 0;
	return new Promise((resolve) => {
		const readStream = fs.createReadStream(sourcePath);
		const writeStream = fs.createWriteStream(destPath);
		readStream.on("data", (chunk) => {
			copiedSize += chunk.length;
			const percent = Math.round(copiedSize / totalSize * 100);
			event.sender.send("copy-progress", {
				fileName,
				percent
			});
		});
		writeStream.on("finish", () => resolve({
			success: true,
			destPath
		}));
		writeStream.on("error", (err) => resolve({
			success: false,
			message: err.message
		}));
		readStream.pipe(writeStream);
	});
});
ipcMain.handle("delete-model-file", async (_, filePath) => {
	if (filePath && filePath.startsWith(MODELS_DIR) && fs.existsSync(filePath)) try {
		fs.unlinkSync(filePath);
		return true;
	} catch {
		return false;
	}
	return false;
});
ipcMain.handle("pick-skill-files", async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: "Select Skill Files or Folders",
		filters: [{
			name: "Documents",
			extensions: [
				"md",
				"txt",
				"js",
				"ts",
				"py",
				"json",
				"css",
				"html"
			]
		}],
		properties: ["openFile", "multiSelections"]
	});
	if (canceled || filePaths.length === 0) return null;
	const results = [];
	for (const p of filePaths) if (fs.existsSync(p) && fs.lstatSync(p).isFile()) results.push({
		name: path.basename(p),
		path: p,
		content: fs.readFileSync(p, "utf-8")
	});
	return results;
});
ipcMain.handle("change-workspace", async () => {
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: "Select New Global Storage Location",
		properties: ["openDirectory", "createDirectory"]
	});
	if (canceled || filePaths.length === 0) return false;
	const newPath = filePaths[0];
	const pointerFile = path.join(os.homedir(), ".gitbot", "workspace.txt");
	fs.writeFileSync(pointerFile, newPath, "utf-8");
	if (!fs.existsSync(path.join(newPath, "repos"))) fs.mkdirSync(path.join(newPath, "repos"), { recursive: true });
	return true;
});
ipcMain.handle("change-workspace-default", async () => {
	const pointerFile = path.join(os.homedir(), ".gitbot", "workspace.txt");
	if (fs.existsSync(pointerFile)) fs.unlinkSync(pointerFile);
	return true;
});
ipcMain.handle("export-multi-repos", async (_, repos) => {
	const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
		title: "Export Selected Repositories",
		defaultPath: `Gitbot-Backup-${Date.now()}.zip`,
		filters: [{
			name: "Zip Archives",
			extensions: ["zip"]
		}]
	});
	if (canceled || !filePath) return false;
	return new Promise((resolve) => {
		const output = fs.createWriteStream(filePath);
		const archive = archiver("zip", { zlib: { level: 9 } });
		output.on("close", () => resolve(true));
		archive.on("error", () => resolve(false));
		archive.pipe(output);
		for (const repo of repos) {
			const p = path.join(REPOS_DIR, repo);
			if (fs.existsSync(p)) archive.directory(p, repo);
		}
		archive.finalize();
	});
});
ipcMain.handle("upload-file", async (_, repoName) => {
	const repoPath = path.join(REPOS_DIR, repoName);
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: "Upload to Project",
		properties: [
			"openFile",
			"openDirectory",
			"multiSelections"
		]
	});
	if (canceled || filePaths.length === 0) return {
		ok: false,
		files: []
	};
	const SKIP_DIRS = new Set([
		"node_modules",
		".git",
		".svn",
		".hg",
		"dist",
		"build",
		"out",
		"__pycache__",
		".venv",
		"venv",
		"env",
		".env",
		".next",
		".nuxt",
		".cache",
		"vendor",
		"bower_components",
		"packages",
		".dart_tool",
		"target",
		"bin",
		"obj",
		"Pods",
		".gradle",
		".idea",
		".vs",
		".vscode",
		"coverage",
		".nyc_output",
		"tmp",
		"temp",
		".turbo",
		".vercel"
	]);
	const smartCopy = (src, dest) => {
		if (fs.statSync(src).isDirectory()) {
			const dirName = path.basename(src);
			if (SKIP_DIRS.has(dirName)) return;
			if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
			for (const child of fs.readdirSync(src)) smartCopy(path.join(src, child), path.join(dest, child));
		} else fs.copyFileSync(src, dest);
	};
	const collected = [];
	const collectFiles = (dir, base) => {
		if (fs.statSync(dir).isDirectory()) {
			if (SKIP_DIRS.has(path.basename(dir))) return;
			for (const child of fs.readdirSync(dir)) collectFiles(path.join(dir, child), base + "/" + child);
		} else collected.push(path.basename(base));
	};
	for (const p of filePaths) {
		if (fs.statSync(p).isDirectory()) for (const child of fs.readdirSync(p)) smartCopy(path.join(p, child), path.join(repoPath, child));
		else smartCopy(p, path.join(repoPath, path.basename(p)));
		collectFiles(p, path.basename(p));
	}
	return {
		ok: true,
		files: collected
	};
});
ipcMain.handle("open-in-powershell", async (_, repoName) => {
	const repoPath = path.join(REPOS_DIR, repoName);
	if (!fs.existsSync(repoPath)) return false;
	spawn("cmd.exe", [
		"/c",
		"start",
		"powershell.exe",
		"-NoExit",
		"-Command",
		`Set-Location -LiteralPath "${repoPath}"`
	], {
		detached: true,
		stdio: "ignore"
	}).unref();
	return true;
});
ipcMain.handle("download-repo", async (_, name) => {
	const p = path.join(REPOS_DIR, name);
	const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
		title: "Download Project",
		defaultPath: `${name}.zip`,
		filters: [{
			name: "Zip Files",
			extensions: ["zip"]
		}]
	});
	if (canceled || !filePath) return { success: false };
	return new Promise((resolve) => {
		const output = fs.createWriteStream(filePath);
		const archive = archiver("zip", { zlib: { level: 9 } });
		output.on("close", () => resolve({ success: true }));
		archive.on("error", (err) => resolve({
			success: false,
			message: err.message
		}));
		archive.pipe(output);
		archive.directory(p, false);
		archive.finalize();
	});
});
ipcMain.handle("get-commits", async (_, name) => {
	const ledger = path.join(REPOS_DIR, name, ".gitbot-commits.json");
	if (!fs.existsSync(ledger)) return [];
	return JSON.parse(fs.readFileSync(ledger, "utf-8"));
});
ipcMain.handle("create-commit", async (_, name, message) => {
	const repoPath = path.join(REPOS_DIR, name);
	const ledger = path.join(repoPath, ".gitbot-commits.json");
	const commits = fs.existsSync(ledger) ? JSON.parse(fs.readFileSync(ledger, "utf-8")) : [];
	const id = Date.now().toString(36);
	const gitbotDir = path.join(repoPath, ".gitbot");
	if (!fs.existsSync(gitbotDir)) fs.mkdirSync(gitbotDir, { recursive: true });
	const snapshotZip = path.join(gitbotDir, `${id}.zip`);
	await new Promise((resolve) => {
		const output = fs.createWriteStream(snapshotZip);
		const archive = archiver("zip", { zlib: { level: 9 } });
		output.on("close", () => resolve(true));
		archive.on("error", () => resolve(false));
		archive.pipe(output);
		archive.glob("**/*", {
			cwd: repoPath,
			ignore: [
				".gitbot/**",
				"node_modules/**",
				".gitbot-commits.json",
				"releases/**"
			]
		});
		archive.finalize();
	});
	const snapshot = [];
	const scan = (dir, base = "") => {
		for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
			if (item.name === ".gitbot-commits.json" || item.name === "releases" || item.name === ".gitbot") continue;
			const rel = base ? base + "/" + item.name : item.name;
			if (item.isDirectory()) scan(path.join(dir, item.name), rel);
			else snapshot.push(rel);
		}
	};
	try {
		scan(repoPath);
	} catch {}
	commits.unshift({
		id,
		message,
		date: (/* @__PURE__ */ new Date()).toISOString(),
		files: snapshot
	});
	fs.writeFileSync(ledger, JSON.stringify(commits, null, 2));
	return {
		id,
		date: (/* @__PURE__ */ new Date()).toISOString()
	};
});
ipcMain.handle("open-commit", async (_, name, id) => {
	const p = path.join(REPOS_DIR, name, ".gitbot", `${id}.zip`);
	if (fs.existsSync(p)) shell.showItemInFolder(p);
	return true;
});
ipcMain.handle("get-releases", async (_, name) => {
	const relDir = path.join(REPOS_DIR, name, "releases");
	if (!fs.existsSync(relDir)) return [];
	return fs.readdirSync(relDir, { withFileTypes: true }).filter((f) => !f.isDirectory()).map((f) => {
		const stat = fs.statSync(path.join(relDir, f.name));
		return {
			name: f.name,
			size: stat.size,
			date: stat.mtime.toISOString()
		};
	});
});
ipcMain.handle("upload-release", async (_, name) => {
	const relDir = path.join(REPOS_DIR, name, "releases");
	if (!fs.existsSync(relDir)) fs.mkdirSync(relDir, { recursive: true });
	const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
		title: "Upload Release Asset",
		properties: ["openFile", "multiSelections"]
	});
	if (canceled || filePaths.length === 0) return false;
	for (const fp of filePaths) fs.copyFileSync(fp, path.join(relDir, path.basename(fp)));
	return true;
});
ipcMain.handle("open-release", async (_, name, filename) => {
	const p = path.join(REPOS_DIR, name, "releases", filename);
	if (fs.existsSync(p)) shell.showItemInFolder(p);
	return true;
});
ipcMain.handle("delete-release", async (_, name, filename) => {
	const p = path.join(REPOS_DIR, name, "releases", filename);
	if (fs.existsSync(p)) {
		fs.unlinkSync(p);
		return true;
	}
	return false;
});
ipcMain.handle("start-ai", async (_, providedModelPath, providedMmprojPath) => {
	killAIProcess();
	await new Promise((r) => setTimeout(r, 1500));
	let configObj = {};
	try {
		if (fs.existsSync(CONFIG_FILE)) configObj = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
	} catch {}
	const modelPath = providedModelPath || configObj.lastModelPath;
	const mmprojPath = providedModelPath || providedMmprojPath !== void 0 ? providedMmprojPath || null : configObj.lastMmprojPath || null;
	const serverExe = app.isPackaged ? path.join(process.resourcesPath, "cpp", "llama-server.exe") : path.join(__dirname, "../cpp", "llama-server.exe");
	if (!fs.existsSync(serverExe)) return {
		success: false,
		message: "Server not found"
	};
	if (!fs.existsSync(modelPath)) return {
		success: false,
		message: "Model not found at " + modelPath
	};
	const isVision = !!(mmprojPath && fs.existsSync(mmprojPath));
	const args = [
		"-m",
		modelPath,
		"--port",
		"8080",
		"--ctx-size",
		isVision ? "4096" : "8192",
		"-ngl",
		"99",
		"--parallel",
		"1",
		"--host",
		"127.0.0.1",
		"--threads",
		Math.max(1, os.cpus().length - 1).toString(),
		"--threads-batch",
		os.cpus().length.toString(),
		"--batch-size",
		"2048"
	];
	if (isVision) {
		args.push("--mmproj", mmprojPath);
		args.push("--image-min-tokens", "1024");
	}
	aiProcess = spawn(serverExe, args, { detached: true });
	lastAiError = null;
	aiProcess.stdout?.on("data", (d) => console.log(`[AI] ${d}`));
	aiProcess.stderr?.on("data", (d) => {
		const msg = d.toString();
		console.error(`[AI ERR] ${msg}`);
		if (msg.includes("error:") || msg.includes("failed") || msg.includes("mismatch")) lastAiError = msg;
	});
	aiProcess.on("exit", (code) => {
		if (code !== null && code !== 0) console.log(`[AI Exit] code ${code}`);
	});
	if (providedModelPath) {
		configObj.lastModelPath = providedModelPath;
		if (!configObj.aiModels) configObj.aiModels = [];
		if (!configObj.aiModels.find((m) => m.modelPath === providedModelPath)) configObj.aiModels.push({
			id: Date.now().toString(),
			name: path.basename(providedModelPath),
			modelPath: providedModelPath,
			mmprojPath: providedMmprojPath || null,
			isActive: true
		});
	}
	if (providedMmprojPath) configObj.lastMmprojPath = providedMmprojPath;
	else if (!providedModelPath && !providedMmprojPath && mmprojPath) configObj.lastMmprojPath = mmprojPath;
	fs.writeFileSync(CONFIG_FILE, JSON.stringify(configObj, null, 2));
	return { success: true };
});
ipcMain.handle("ping-ai", async () => {
	try {
		return (await fetch("http://127.0.0.1:8080/v1/models")).ok;
	} catch {
		return false;
	}
});
ipcMain.handle("generate-image", async (event, options) => {
	const sdCli = app.isPackaged ? path.join(process.resourcesPath, "cpp", "sd-cli.exe") : path.join(__dirname, "../cpp", "sd-cli.exe");
	if (!fs.existsSync(sdCli)) return {
		success: false,
		message: "sd-cli.exe not found"
	};
	killAIProcess();
	const id = Date.now().toString();
	const outPath = path.join(GENERATED_IMAGES_DIR, `gen_${id}.png`);
	const allThreads = os.cpus().length;
	const args = [
		"-m",
		options.modelPath,
		"-p",
		options.prompt,
		"-o",
		outPath,
		"--width",
		(options.width || 512).toString(),
		"--height",
		(options.height || 512).toString(),
		"--steps",
		(options.steps || 4).toString(),
		"--cfg-scale",
		(options.cfgScale || 2).toString(),
		"--vae-tiling",
		"--vae-on-cpu",
		"-s",
		"-1",
		"--threads",
		allThreads.toString(),
		"--sampling-method",
		"euler_a"
	];
	if (options.vaePath && fs.existsSync(options.vaePath)) args.push("--vae", options.vaePath);
	if (options.clipLPath && fs.existsSync(options.clipLPath)) args.push("--clip_l", options.clipLPath);
	if (options.t5xxlPath && fs.existsSync(options.t5xxlPath)) args.push("--t5xxl", options.t5xxlPath);
	imageGenStatus = {
		generating: true,
		prompt: options.prompt,
		startedAt: Date.now()
	};
	return new Promise((resolve) => {
		imageGenProcess = spawn(sdCli, args);
		let output = "";
		imageGenProcess.stdout?.on("data", (d) => {
			const line = d.toString();
			output += line;
			mainWindow?.webContents.send("image-gen-log", line);
		});
		imageGenProcess.stderr?.on("data", (d) => {
			const line = d.toString();
			output += line;
			mainWindow?.webContents.send("image-gen-log", line);
		});
		imageGenProcess.on("exit", (code) => {
			imageGenProcess = null;
			const durationStr = imageGenStatus.startedAt ? ((Date.now() - imageGenStatus.startedAt) / 1e3).toFixed(1) : void 0;
			imageGenStatus = { generating: false };
			if (code === 0 && fs.existsSync(outPath)) {
				const result = {
					success: true,
					imagePath: "gitbot-profile://" + outPath,
					prompt: options.prompt,
					duration: durationStr
				};
				imageGenLastResult = result;
				mainWindow?.webContents.send("image-gen-complete", result);
				resolve(result);
			} else {
				const result = {
					success: false,
					message: output || "Generation failed or stopped",
					duration: durationStr
				};
				imageGenLastResult = result;
				mainWindow?.webContents.send("image-gen-complete", result);
				resolve(result);
			}
			if (!aiProcess) try {
				const configObj = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) : {};
				const activeModel = configObj.aiModels?.find((m) => m.isActive);
				const aiPath = activeModel?.modelPath || configObj.lastModelPath;
				const mmprojPath = activeModel?.mmprojPath || configObj.lastMmprojPath || null;
				const serverExe = app.isPackaged ? path.join(process.resourcesPath, "cpp", "llama-server.exe") : path.join(__dirname, "../cpp", "llama-server.exe");
				if (aiPath && fs.existsSync(aiPath) && fs.existsSync(serverExe)) {
					const isVision = !!(mmprojPath && fs.existsSync(mmprojPath));
					const restartArgs = [
						"-m",
						aiPath,
						"--port",
						"8080",
						"--ctx-size",
						isVision ? "8192" : "8192",
						"--n-predict",
						"4096",
						"--threads",
						Math.max(1, os.cpus().length - 1).toString(),
						"--threads-batch",
						os.cpus().length.toString(),
						"--parallel",
						"1",
						"--batch-size",
						"512",
						"--flash-attn",
						"auto",
						"--ctx-shift"
					];
					if (isVision) {
						restartArgs.push("--mmproj", mmprojPath);
						restartArgs.push("--image-min-tokens", "1024");
					}
					console.log("[AI] Auto-restarting after image generation...");
					aiProcess = spawn(serverExe, restartArgs, { detached: true });
					lastAiError = null;
					aiProcess.stdout?.on("data", (d) => console.log(`[AI] ${d}`));
					aiProcess.stderr?.on("data", (d) => console.error(`[AI ERR] ${d}`));
					aiProcess.on("exit", (code) => {
						aiProcess = null;
						console.log(`[AI Exit] code ${code}`);
					});
				}
			} catch (e) {
				console.error("[AI] Failed to auto-restart after generation:", e);
			}
		});
	});
});
ipcMain.handle("get-image-gen-status", async () => imageGenStatus);
ipcMain.handle("get-image-gen-last-result", async () => {
	const result = imageGenLastResult;
	imageGenLastResult = null;
	return result;
});
ipcMain.handle("stop-generate-image", async () => {
	if (imageGenProcess) {
		imageGenProcess.kill();
		imageGenProcess = null;
		return true;
	}
	return false;
});
ipcMain.handle("get-generated-images", async () => {
	if (!fs.existsSync(GENERATED_IMAGES_DIR)) return [];
	return fs.readdirSync(GENERATED_IMAGES_DIR).filter((f) => f.endsWith(".png")).map((f) => ({
		name: f,
		path: "gitbot-profile://" + path.join(GENERATED_IMAGES_DIR, f),
		date: fs.statSync(path.join(GENERATED_IMAGES_DIR, f)).mtime.toISOString()
	})).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
});
ipcMain.handle("delete-generated-image", async (_, imagePath) => {
	try {
		let realPath = imagePath;
		if (imagePath.startsWith("gitbot-profile://")) {
			realPath = imagePath.replace("gitbot-profile://", "");
			if (realPath.match(/^[a-zA-Z]\//)) realPath = realPath.charAt(0) + ":" + realPath.substring(1);
		}
		if (fs.existsSync(realPath)) {
			fs.unlinkSync(realPath);
			return { success: true };
		}
		return {
			success: false,
			message: "File not found"
		};
	} catch (err) {
		return {
			success: false,
			message: err.message
		};
	}
});
ipcMain.handle("get-ai-error", async () => {
	return lastAiError;
});
ipcMain.handle("create-repo-from-plan", async (_, repoName, files) => {
	let finalName = repoName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase() || "ai-project";
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
		fs.writeFileSync(fullPath, f.content, "utf-8");
	}
	const commits = [{
		id: "init",
		message: "Initial commit (AI Generated)",
		date: (/* @__PURE__ */ new Date()).toISOString(),
		files: files.map((f) => f.path)
	}];
	fs.writeFileSync(path.join(repoPath, ".gitbot-commits.json"), JSON.stringify(commits, null, 2));
	return {
		success: true,
		name: finalName
	};
});
//#endregion
