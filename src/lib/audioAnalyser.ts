let sharedAudioContext: AudioContext | null = null;
let sharedAnalyser: AnalyserNode | null = null;
let webAudioDisabled = false;
let resumeAttempted = false;
const connectedAudios = new WeakSet<HTMLAudioElement>();

const disableWebAudio = () => {
  webAudioDisabled = true;
  try {
    sharedAudioContext?.close();
  } catch {
    /* ignore */
  }
  sharedAudioContext = null;
  sharedAnalyser = null;
};

export const getSharedAnalyser = () => {
  if (webAudioDisabled) return { context: null, analyser: null };

  if (!sharedAudioContext) {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return { context: null, analyser: null };
    try {
      sharedAudioContext = new AudioContextClass();
      sharedAnalyser = sharedAudioContext.createAnalyser();
      sharedAnalyser.fftSize = 256;
      sharedAnalyser.connect(sharedAudioContext.destination);
      sharedAudioContext.addEventListener('error', disableWebAudio);
    } catch {
      disableWebAudio();
      return { context: null, analyser: null };
    }
  }

  if (sharedAudioContext?.state === 'suspended' && !resumeAttempted) {
    resumeAttempted = true;
    sharedAudioContext.resume().catch(() => {
      disableWebAudio();
    });
  }

  return { context: sharedAudioContext, analyser: sharedAnalyser };
};

export const trackAudioElement = (audio: HTMLAudioElement) => {
  if (webAudioDisabled || connectedAudios.has(audio)) return;
  try {
    const { context, analyser } = getSharedAnalyser();
    if (!context || !analyser || context.state === 'closed') return;
    const source = context.createMediaElementSource(audio);
    source.connect(analyser);
    connectedAudios.add(audio);
  } catch {
    /* element already routed or WebAudio unavailable */
  }
};
