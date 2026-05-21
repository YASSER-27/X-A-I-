/** Static assets served from Vite `public/` (project root). */

export const WALLPAPER_FILES = [
  '3b96a816f648.png',
  'holographic.jpg',
  'cool.jpg',
  'fractal.jpg',
  'May.png',
  'wallpaper.png',
  'white.jpg',
] as const;

const VOICE_IMAGE_MAP: Record<string, string> = {
  F1: 'Sofia',
  M1: 'James',
  F2: 'Luna',
  M2: 'Oliver',
  F3: 'Aria',
  M3: 'Ethan',
  F4: 'Mia',
  M4: 'Noah',
  F5: 'Zara',
  M5: 'Liam',
};

function usePackagedAssetProtocol(): boolean {
  try {
    return !!(window as Window & { api?: { isPackaged?: boolean } }).api?.isPackaged;
  } catch {
    return false;
  }
}

/** Resolve a file under `public/` for img src or CSS url(). */
export function resolvePublicUrl(file: string): string {
  if (!file) return resolvePublicUrl('wallpaper.png');
  if (file.startsWith('http') || file.startsWith('data:') || file.startsWith('xai-asset://')) return file;
  const clean = file.replace(/^\/+/, '');
  if (usePackagedAssetProtocol()) return `xai-asset://${clean}`;
  return `/${clean}`;
}

export function voiceImageUrl(voiceId: string): string {
  const name = VOICE_IMAGE_MAP[voiceId] || voiceId;
  return resolvePublicUrl(`assets/voices/${name}.png`);
}

export function wallpaperImageUrl(file: string): string {
  if (!file) return resolvePublicUrl('assets/wallpapers/wallpaper.png');
  const base = file.includes('/') ? file.split('/').pop()! : file;
  if ((WALLPAPER_FILES as readonly string[]).includes(base)) {
    return resolvePublicUrl(`assets/wallpapers/${base}`);
  }
  return resolvePublicUrl(`assets/wallpapers/${base}`);
}

export function isWallpaperFile(name: string): boolean {
  const base = name.includes('/') ? name.split('/').pop()! : name;
  return (WALLPAPER_FILES as readonly string[]).includes(base);
}
