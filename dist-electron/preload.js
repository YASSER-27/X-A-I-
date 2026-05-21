import { contextBridge, ipcRenderer } from "electron";
//#region electron/preload.ts
var isPackaged = false;
try {
	isPackaged = ipcRenderer.sendSync("sync-is-packaged");
} catch {
	isPackaged = false;
}
contextBridge.exposeInMainWorld("api", {
	isPackaged,
	getSettings: () => ipcRenderer.invoke("get-settings"),
	saveSettings: (s) => ipcRenderer.invoke("save-settings", s),
	uploadProfileImage: () => ipcRenderer.invoke("upload-profile-image"),
	getStorageUsage: () => ipcRenderer.invoke("get-storage-usage"),
	pickModelFile: () => ipcRenderer.invoke("pick-model-file"),
	pickMmprojFile: () => ipcRenderer.invoke("pick-mmproj-file"),
	pickSkillFiles: () => ipcRenderer.invoke("pick-skill-files"),
	changeWorkspace: () => ipcRenderer.invoke("change-workspace"),
	changeWorkspaceDefault: () => ipcRenderer.invoke("change-workspace-default"),
	exportMultiRepos: (repos) => ipcRenderer.invoke("export-multi-repos", repos),
	pickImageModel: () => ipcRenderer.invoke("pick-image-model"),
	getWallpapers: () => ipcRenderer.invoke("get-wallpapers"),
	getRepos: () => ipcRenderer.invoke("get-repos"),
	createRepo: (name) => ipcRenderer.invoke("create-repo", name),
	deleteRepo: (name) => ipcRenderer.invoke("delete-repo", name),
	renameRepo: (oldName, newName) => ipcRenderer.invoke("rename-repo", oldName, newName),
	downloadRepo: (name) => ipcRenderer.invoke("download-repo", name),
	toggleStar: (name) => ipcRenderer.invoke("toggle-star", name),
	getStars: () => ipcRenderer.invoke("get-stars"),
	getRepoFiles: (name, subPath = "") => ipcRenderer.invoke("get-repo-files", name, subPath),
	getFileContent: (name, filePath) => ipcRenderer.invoke("get-file-content", name, filePath),
	saveFileContent: (name, filePath, content) => ipcRenderer.invoke("save-file-content", name, filePath, content),
	openFile: (name, filePath) => ipcRenderer.invoke("open-file", name, filePath),
	getReadme: (name) => ipcRenderer.invoke("get-readme", name),
	getLanguageStats: (name) => ipcRenderer.invoke("get-language-stats", name),
	uploadFile: (name) => ipcRenderer.invoke("upload-file", name),
	getRepoAbout: (name) => ipcRenderer.invoke("get-repo-about", name),
	saveRepoAbout: (name, about) => ipcRenderer.invoke("save-repo-about", name, about),
	openInPowershell: (name) => ipcRenderer.invoke("open-in-powershell", name),
	getCommits: (name) => ipcRenderer.invoke("get-commits", name),
	createCommit: (name, message) => ipcRenderer.invoke("create-commit", name, message),
	openCommit: (name, id) => ipcRenderer.invoke("open-commit", name, id),
	getReleases: (name) => ipcRenderer.invoke("get-releases", name),
	uploadRelease: (name) => ipcRenderer.invoke("upload-release", name),
	openRelease: (name, filename) => ipcRenderer.invoke("open-release", name, filename),
	deleteRelease: (name, filename) => ipcRenderer.invoke("delete-release", name, filename),
	createRepoFromPlan: (name, files) => ipcRenderer.invoke("create-repo-from-plan", name, files),
	downloadProjectZip: (name, files) => ipcRenderer.invoke("download-project-zip", name, files),
	startAI: (modelPath, mmprojPath) => ipcRenderer.invoke("start-ai", modelPath, mmprojPath),
	stopAI: () => ipcRenderer.invoke("stop-ai"),
	pingAI: () => ipcRenderer.invoke("ping-ai"),
	copyAIModel: (sourcePath) => ipcRenderer.invoke("copy-ai-model", sourcePath),
	deleteModelFile: (filePath) => ipcRenderer.invoke("delete-model-file", filePath),
	getAIError: () => ipcRenderer.invoke("get-ai-error"),
	generateImage: (options) => ipcRenderer.invoke("generate-image", options),
	stopGenerateImage: () => ipcRenderer.invoke("stop-generate-image"),
	getGeneratedImages: () => ipcRenderer.invoke("get-generated-images"),
	deleteGeneratedImage: (path) => ipcRenderer.invoke("delete-generated-image", path),
	getImageGenStatus: () => ipcRenderer.invoke("get-image-gen-status"),
	getImageGenLastResult: () => ipcRenderer.invoke("get-image-gen-last-result"),
	onImageGenComplete: (callback) => {
		const sub = (_, data) => callback(data);
		ipcRenderer.on("image-gen-complete", sub);
		return () => ipcRenderer.removeListener("image-gen-complete", sub);
	},
	onImageGenLog: (callback) => {
		const sub = (_, data) => callback(data);
		ipcRenderer.on("image-gen-log", sub);
		return () => ipcRenderer.removeListener("image-gen-log", sub);
	},
	onCopyProgress: (callback) => {
		const subscription = (_, data) => callback(data);
		ipcRenderer.on("copy-progress", subscription);
		return () => ipcRenderer.removeListener("copy-progress", subscription);
	},
	winMinimize: () => ipcRenderer.send("win-minimize"),
	winMaximize: () => ipcRenderer.send("win-maximize"),
	winClose: () => ipcRenderer.send("win-close"),
	setMiniMode: (enabled) => ipcRenderer.send("set-mini-mode", enabled),
	resizeWindow: (w, h) => ipcRenderer.send("resize-window", w, h),
	setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send("set-ignore-mouse-events", ignore, options),
	onPlaySound: (callback) => {
		const sub = (_, data) => callback(data);
		ipcRenderer.on("play-sound", sub);
		return () => ipcRenderer.removeListener("play-sound", sub);
	},
	onAiServerStarting: (callback) => {
		const sub = () => callback();
		ipcRenderer.on("ai-server-starting", sub);
		return () => ipcRenderer.removeListener("ai-server-starting", sub);
	},
	previewTTS: (voiceId) => ipcRenderer.invoke("preview-tts", voiceId),
	stopTTS: () => ipcRenderer.invoke("stop-tts"),
	speakTTS: (text, voiceId, lang) => ipcRenderer.invoke("speak-tts", text, voiceId, lang),
	transcribeAudio: (audioPath) => ipcRenderer.invoke("transcribe-audio", audioPath),
	saveAudioToTemp: (base64Audio, filename) => ipcRenderer.invoke("save-audio-to-temp", base64Audio, filename)
});
//#endregion
