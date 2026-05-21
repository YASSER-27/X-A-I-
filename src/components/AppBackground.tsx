/** Shared blur / wallpaper layers for AI panel and Settings. */
import { wallpaperImageUrl } from '../lib/publicAssets';

interface AppBackgroundProps {
  blurEnabled?: boolean;
  wallEnabled?: boolean;
  wallpaper?: string;
}

export default function AppBackground({
  blurEnabled = false,
  wallEnabled = false,
  wallpaper = 'wallpaper.png',
}: AppBackgroundProps) {
  return (
    <>
      {blurEnabled && (
        <div className="ai-blur-bg" aria-hidden>
          <div className="bg-layer" />
          <div className="wave-layer" />
          <div className="wave-layer w2" />
          <div className="light-layer" />
          <div className="grain-layer" />
        </div>
      )}
      {wallEnabled && (
        <div
          className="ai-wallpaper-bg"
          aria-hidden
          style={{ backgroundImage: `url(${wallpaperImageUrl(wallpaper || 'wallpaper.png')})` }}
        />
      )}
    </>
  );
}
