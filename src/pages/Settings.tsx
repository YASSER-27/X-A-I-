import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, CheckCircle, Cpu, Plus, X, Loader, FileCode, ArrowLeft, Edit2, Power, Volume2, Play, Square as StopIcon, Info } from 'lucide-react';
import AppBackground from '../components/AppBackground';
import MediaPickCard from '../components/MediaPickCard';
import { WALLPAPER_FILES, voiceImageUrl, wallpaperImageUrl } from '../lib/publicAssets';
import './Settings.css';

const DEFAULT_TEMPLATES = [
  { label: 'Code Review', prompt: 'Review this code and suggest improvements for readability, performance, and best practices:' },
  { label: 'Explain Code', prompt: 'Explain this code step by step for a junior developer:' },
  { label: 'Write Tests', prompt: 'Write comprehensive unit tests for this code:' },
  { label: 'Fix Bug', prompt: 'Find and fix the bug in this code, then explain what was wrong:' },
  { label: 'Optimize', prompt: 'Optimize this code for better performance:' },
];



export default function Settings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'models' | 'ai' | 'voice' | 'info'>('models');
  const [settings, setSettings] = useState({
    theme: 'dark', profileName: 'YASSER-27', profileImage: '',
    country: 'Unknown', bio: '', systemPrompt: '', promptTemplates: [] as { label: string; prompt: string; enabled?: boolean }[],
    followers: 0, following: 0, disableThinking: false, introEnabled: false,
    skillFiles: [] as { name: string; path: string; content: string }[],
    customWorkspace: '',
    aiModels: [] as { id: string; name: string; modelPath: string; mmprojPath?: string; isActive: boolean }[],
    imageModel: '',
    imageGenKeepServer: false,
    fluxModels: { diffusion: '', vae: '', clip_l: '', t5xxl: '' },
    autoStartAI: true,
    ttsVoice: 'F1',
    ttsEnabled: false,
    autoVocal: false,
    blurEnabled: false,
    wallEnabled: false,
    currentWallpaper: 'wallpaper.png',
  });
  const [wallpaperFiles, setWallpaperFiles] = useState<string[]>([]);
  const [isStartingModel, setIsStartingModel] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [newTemplate, setNewTemplate] = useState({ label: '', prompt: '' });
  const [copyTask, setCopyTask] = useState<{ fileName: string; percent: number } | null>(null);
  const [addingTemplate, setAddingTemplate] = useState(false);
  const [editingTemplateIdx, setEditingTemplateIdx] = useState<number | null>(null);
  const [editTemplate, setEditTemplate] = useState({ label: '', prompt: '' });
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [customDialog, setCustomDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'alert' | 'confirm';
    onConfirm: () => void;
    onCancel?: () => void;
  } | null>(null);

  const VOICES = [
    { id: 'F1', label: 'Sofia', gender: 'Female', icon: 'S' },
    { id: 'M1', label: 'James', gender: 'Male', icon: 'J' },
    { id: 'F2', label: 'Luna', gender: 'Female', icon: 'L' },
    { id: 'M2', label: 'Oliver', gender: 'Male', icon: 'O' },
    { id: 'F3', label: 'Aria', gender: 'Female', icon: 'A' },
    { id: 'M3', label: 'Ethan', gender: 'Male', icon: 'E' },
    { id: 'F4', label: 'Mia', gender: 'Female', icon: 'M' },
    { id: 'M4', label: 'Noah', gender: 'Male', icon: 'N' },
    { id: 'F5', label: 'Zara', gender: 'Female', icon: 'Z' },
    { id: 'M5', label: 'Liam', gender: 'Male', icon: 'L' },
  ];


  const stopVoicePreview = () => {
    speechSynthesis.cancel();
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; audioRef.current = null; }
    (window as any).api?.stopTTS?.();
    setPlayingVoice(null);
  };

  const playVoicePreview = async (voiceId: string) => {
    stopVoicePreview();
    setPlayingVoice(voiceId);
    try {
      // Try real Supertonic-3 TTS via main process
      const result = await (window as any).api?.previewTTS?.(voiceId);
      if (result?.base64Audio) {
        const audio = new Audio(result.base64Audio);
        audioRef.current = audio;
        audio.onended = () => setPlayingVoice(null);
        audio.onerror = () => setPlayingVoice(null);
        audio.play();
        return;
      }
    } catch {}
    // Fallback: Web Speech API preview
    const utterance = new SpeechSynthesisUtterance(
      voiceId.startsWith('F') ? 'Hello! I am your AI assistant. How can I help you today?' : 'Hi there. I am ready to assist you with anything you need.'
    );
    utterance.rate = 0.95;
    utterance.pitch = voiceId.startsWith('F') ? 1.1 : 0.9;
    utterance.onend = () => setPlayingVoice(null);
    utterance.onerror = () => setPlayingVoice(null);
    speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    if ((window as any).api?.onCopyProgress) {
      const unsub = (window as any).api.onCopyProgress((data: any) => setCopyTask(data));
      return () => unsub();
    }
  }, []);

  useEffect(() => {
    window.api?.getSettings().then((s: any) => {
      if (s) setSettings(prev => ({ ...prev, ...s, promptTemplates: s.promptTemplates || [] }));
      if (s?.theme) document.documentElement.setAttribute('data-theme', s.theme);
    });
    setWallpaperFiles([...WALLPAPER_FILES]);
  }, []);



  const set = (key: string, val: any) => setSettings(prev => ({ ...prev, [key]: val }));

  const handleSave = async () => {
    await window.api?.saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };


  const addTemplate = () => {
    if (!newTemplate.label.trim() || !newTemplate.prompt.trim()) return;
    set('promptTemplates', [...settings.promptTemplates, { ...newTemplate, enabled: true }]);
    setNewTemplate({ label: '', prompt: '' });
    setAddingTemplate(false);
  };

  const removeTemplate = (i: number) => set('promptTemplates', settings.promptTemplates.filter((_, idx) => idx !== i));

  const toggleTemplate = (i: number) => {
    const updated = [...settings.promptTemplates];
    updated[i] = { ...updated[i], enabled: updated[i].enabled === false ? true : false };
    set('promptTemplates', updated);
  };

  const startEditTemplate = (i: number) => {
    setEditingTemplateIdx(i);
    setEditTemplate({ label: settings.promptTemplates[i].label, prompt: settings.promptTemplates[i].prompt });
  };

  const saveEditTemplate = () => {
    if (editingTemplateIdx === null) return;
    const updated = [...settings.promptTemplates];
    updated[editingTemplateIdx] = { ...updated[editingTemplateIdx], ...editTemplate };
    set('promptTemplates', updated);
    setEditingTemplateIdx(null);
  };



  const TABS: { key: 'models' | 'ai' | 'voice' | 'info'; label: string; icon: any }[] = [
    { key: 'models', label: 'Models', icon: Cpu },
    { key: 'voice', label: 'Voice', icon: Volume2 },
    { key: 'ai', label: 'AI Config', icon: Cpu },
    { key: 'info', label: 'About', icon: Info },
  ];

  const hasAppBg = !!(settings.blurEnabled || settings.wallEnabled);

  return (
    <div className={`settings-page ${hasAppBg ? 'has-app-bg' : ''}`}>
      <AppBackground blurEnabled={settings.blurEnabled} wallEnabled={settings.wallEnabled} wallpaper={settings.currentWallpaper} />
      <div className="wa-tab-group">
        <div className="wa-tab-list" role="tablist" aria-orientation="vertical">
          <div className="wa-tab-group-label">Settings</div>
          {TABS.map(t => (
            <button key={t.key} role="tab" aria-selected={activeTab === t.key}
              className={`wa-tab ${activeTab === t.key ? 'wa-tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}>
              <t.icon size={15} />{t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button className="wa-tab wa-tab-back" onClick={() => navigate('/ai')}>
            <ArrowLeft size={15} /> Back to Chat
          </button>
        </div>

        <div className="wa-tab-panels settings-main">

          {/* ── Models ── */}
          {activeTab === 'models' && (
            <section className="settings-section">
              <div className="settings-section-title"><Cpu size={18} /> Model Connection</div>
              <p className="form-hint" style={{ marginBottom: '16px' }}>Manage your local AI models. Toggle a model to "On" to make it the active engine.</p>

              {copyTask && (
                <div style={{ marginBottom: '20px', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Processing: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{copyTask.fileName}</span></span>
                    <span style={{ fontWeight: 600, color: 'var(--accent-color)' }}>{copyTask.percent}%</span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${copyTask.percent}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-color), #88bbff)', transition: 'width 0.2s ease-out' }} />
                  </div>
                </div>
              )}

              <button className="button button-primary" disabled={!!copyTask} style={{ marginBottom: '20px' }} onClick={async () => {
                const modelPath = await (window as any).api?.pickModelFile();
                if (modelPath) {
                  const mmprojPath = await (window as any).api?.pickMmprojFile();
                  let localModelPath = modelPath;
                  let localMmprojPath = mmprojPath;
                  try {
                    const modelRes = await (window as any).api.copyAIModel(modelPath);
                    if (modelRes.success) localModelPath = modelRes.destPath;
                    if (mmprojPath) {
                      const mmRes = await (window as any).api.copyAIModel(mmprojPath);
                      if (mmRes.success) localMmprojPath = mmRes.destPath;
                    }
                  } catch (err) { console.error('Copy failed:', err); } finally { setCopyTask(null); }
                  const baseName = localModelPath.split(/[\\/]/).pop() || 'New Model';
                  const newModel = { id: Date.now().toString(), name: baseName, modelPath: localModelPath, mmprojPath: localMmprojPath || undefined, isActive: (settings.aiModels || []).length === 0 };
                  set('aiModels', [...(settings.aiModels || []), newModel]);
                }
              }}>
                <Plus size={14} /> {copyTask ? 'Copying...' : 'Add Model Set'}
              </button>

              <div className="template-list">
                {(!settings.aiModels || settings.aiModels.length === 0) ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>No models added yet.</div>
                ) : (
                  settings.aiModels.map((m, idx) => (
                    <div key={m.id} className={`template-item ${m.isActive ? 'active' : ''}`} style={{ padding: '12px 16px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input className="template-label" style={{ fontWeight: 600, background: 'transparent', border: 'none', color: 'inherit', padding: '0', margin: '0', outline: 'none', width: 'auto', minWidth: '50px' }}
                            value={m.name} onChange={(e) => { const n = [...settings.aiModels]; n[idx].name = e.target.value; set('aiModels', n); }} title="Click to rename" />
                          <span style={{ fontSize: '9px', background: m.mmprojPath ? 'var(--accent-color)' : 'var(--bg-tertiary)', color: m.mmprojPath ? 'white' : 'var(--text-secondary)', padding: '1px 5px', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 'bold', border: m.mmprojPath ? 'none' : '1px solid var(--border-color)' }}>
                            {m.mmprojPath ? 'Vision' : 'Text'}
                          </span>
                        </div>
                        <div className="template-preview" style={{ fontSize: '11px', opacity: 0.7, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.modelPath}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: m.isActive ? 'var(--green)' : 'var(--text-secondary)' }}>{m.isActive ? 'ON' : 'OFF'}</span>
                          <label className="toggle-switch">
                            <input type="checkbox" style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} checked={m.isActive}
                              onChange={() => {
                                const newModels = settings.aiModels.map((item, i) => ({ ...item, isActive: i === idx }));
                                set('aiModels', newModels);
                                if (!m.isActive) { setIsStartingModel(m.id); (window as any).api?.startAI(m.modelPath, m.mmprojPath).finally(() => setTimeout(() => setIsStartingModel(null), 2000)); }
                              }} />
                            <span className="slider round"></span>
                          </label>
                          {isStartingModel === m.id && <Loader size={14} className="ai-spin" style={{ color: 'var(--accent-color)' }} />}
                        </div>
                        <button className="button button-danger" style={{ padding: '4px', height: '28px', width: '28px' }}
                          onClick={() => {
                            setCustomDialog({
                              isOpen: true,
                              title: 'Remove Model Set',
                              message: `Are you sure you want to remove model set "${m.name}"?`,
                              type: 'confirm',
                              onConfirm: async () => {
                                if (m.modelPath) await (window as any).api?.deleteModelFile(m.modelPath);
                                if (m.mmprojPath) await (window as any).api?.deleteModelFile(m.mmprojPath);
                                set('aiModels', settings.aiModels.filter(item => item.id !== m.id));
                              }
                            });
                          }}><X size={13} /></button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '16px' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 0 }}>Auto-Start AI on Launch</label>
                  <p className="form-hint" style={{ marginTop: '4px', marginBottom: 0 }}>Loads the AI model automatically when the program starts.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: settings.autoStartAI !== false ? 'var(--green)' : 'var(--text-secondary)' }}>{settings.autoStartAI !== false ? 'ON' : 'OFF'}</span>
                  <label className="toggle-switch">
                    <input type="checkbox" style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} checked={settings.autoStartAI !== false} onChange={e => set('autoStartAI', e.target.checked)} />
                    <span className="slider round" />
                  </label>
                </div>
              </div>

              <button className={`button ${saved ? '' : 'button-primary'} save-btn`} onClick={handleSave} style={{ background: saved ? '#238636' : undefined, marginTop: '24px' }}>
                {saved ? <CheckCircle size={16} /> : <Save size={16} />}{saved ? 'Saved!' : 'Save Settings'}
              </button>
            </section>
          )}


          {/* ── AI Config ── */}
          {activeTab === 'ai' && (
            <section className="settings-section">
              <div className="settings-section-title"><Cpu size={18} /> AI Configuration</div>

              <div className="form-field" style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div><label className="form-label">Thinking Mode</label><p className="form-hint">Enable or disable internal reasoning.</p></div>
                  <button className={`button ${!settings.disableThinking ? 'button-primary' : ''}`} onClick={() => set('disableThinking', !settings.disableThinking)}>{settings.disableThinking ? 'Off' : 'On'}</button>
                </div>
              </div>

              {/* Aesthetics & Styling */}
              <div className="form-field" style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '16px', padding: '16px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px', marginBottom: '4px' }}>Aesthetics & Styling</div>
                
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <label className="form-label" style={{ marginBottom: 0 }}>Blur Background Effect</label>
                    <p className="form-hint" style={{ marginTop: '4px', marginBottom: 0 }}>Enable premium frosted glass blur effect in the background.</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: settings.blurEnabled ? 'var(--green)' : 'var(--text-secondary)' }}>{settings.blurEnabled ? 'ON' : 'OFF'}</span>
                    <label className="toggle-switch">
                      <input type="checkbox" style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} checked={!!settings.blurEnabled} onChange={e => {
                        const val = e.target.checked;
                        setSettings(prev => ({
                          ...prev,
                          blurEnabled: val,
                          wallEnabled: val ? false : prev.wallEnabled
                        }));
                      }} />
                      <span className="slider round" />
                    </label>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <label className="form-label" style={{ marginBottom: 0 }}>Wallpaper Background</label>
                    <p className="form-hint" style={{ marginTop: '4px', marginBottom: 0 }}>Show custom background wallpaper. Click a preview to select.</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: settings.wallEnabled ? 'var(--green)' : 'var(--text-secondary)' }}>{settings.wallEnabled ? 'ON' : 'OFF'}</span>
                    <label className="toggle-switch">
                      <input type="checkbox" style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} checked={!!settings.wallEnabled} onChange={e => {
                        const val = e.target.checked;
                        setSettings(prev => ({
                          ...prev,
                          wallEnabled: val,
                          blurEnabled: val ? false : prev.blurEnabled
                        }));
                      }} />
                      <span className="slider round" />
                    </label>
                  </div>
{wallpaperFiles.length > 0 && (
                  <div className="media-pick-grid wallpaper-pick-grid">
                    {wallpaperFiles.map((file) => {
                      const src = wallpaperImageUrl(file);
                      const name = file.split('/').pop() || file;
                      return (
                        <MediaPickCard
                          key={file}
                          src={src}
                          label={name}
                          selected={(settings.currentWallpaper || 'wallpaper.png') === file}
                          onClick={() => setSettings(prev => ({
                            ...prev,
                            currentWallpaper: file,
                            wallEnabled: true,
                            blurEnabled: false,
                          }))}
                        />
                      );
                    })}
                  </div>
                )}
                {wallpaperFiles.length === 0 && (
                  <p className="form-hint" style={{ marginTop: 8 }}>
                    Add images to <code>public/wallpapers/</code> (jpg, png, webp).
                  </p>
                )}
                </div>
              </div>

              <div className="form-field">
                <label className="form-label">System Prompt</label>
                <p className="form-hint">Define the AI personality and behavior.</p>
                <textarea className="input" style={{ width: '100%', minHeight: '130px', resize: 'vertical', fontFamily: 'monospace', fontSize: '13px' }}
                  value={settings.systemPrompt} onChange={e => set('systemPrompt', e.target.value)} placeholder="You are a professional assistant…" />
              </div>

              {/* Template Prompts with on/off/edit/remove */}
              <div className="form-field" style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <label className="form-label" style={{ marginBottom: 0 }}>Template Prompts</label>
                    <p className="form-hint" style={{ marginTop: '2px' }}>Add default templates to your custom list. Toggle active templates on/off to append them dynamically to the AI system prompt without polluting the main text area.</p>
                  </div>
                  <button className="button" style={{ fontSize: '12px' }} onClick={() => setAddingTemplate(v => !v)}><Plus size={13} /> Add</button>
                </div>

                {addingTemplate && (
                  <div className="template-add-form">
                    <input className="input" placeholder="Template name" value={newTemplate.label} onChange={e => setNewTemplate(p => ({ ...p, label: e.target.value }))} />
                    <textarea className="input" placeholder="Prompt text…" style={{ minHeight: '80px', resize: 'vertical', fontSize: '13px' }}
                      value={newTemplate.prompt} onChange={e => setNewTemplate(p => ({ ...p, prompt: e.target.value }))} />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="button button-primary" style={{ fontSize: '13px' }} onClick={addTemplate}>Save</button>
                      <button className="button" style={{ fontSize: '13px' }} onClick={() => setAddingTemplate(false)}>Cancel</button>
                    </div>
                  </div>
                )}

                <div className="template-list">
                  {/* Default templates */}
                  {DEFAULT_TEMPLATES.map((t, i) => (
                    <div key={'d-' + i} className="template-item">
                      <div><div className="template-label">{t.label}</div><div className="template-preview">{t.prompt.slice(0, 80)}…</div></div>
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button className="button button-primary" style={{ fontSize: '12px' }} onClick={() => {
                          const exists = settings.promptTemplates.some(ct => ct.label === t.label);
                          if (!exists) {
                            set('promptTemplates', [...settings.promptTemplates, { label: t.label, prompt: t.prompt, enabled: true }]);
                          }
                        }}><Plus size={12} /> Add</button>
                      </div>
                    </div>
                  ))}

                  {/* Custom templates with on/off/edit/remove */}
                  {settings.promptTemplates.map((t, i) => (
                    <div key={'c-' + i} className={`template-item ${t.enabled === false ? 'template-disabled' : ''}`}>
                      {editingTemplateIdx === i ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <input className="input" value={editTemplate.label} onChange={e => setEditTemplate(p => ({ ...p, label: e.target.value }))} />
                          <textarea className="input" style={{ minHeight: '60px', resize: 'vertical', fontSize: '12px' }} value={editTemplate.prompt} onChange={e => setEditTemplate(p => ({ ...p, prompt: e.target.value }))} />
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button className="button button-primary" style={{ fontSize: '11px' }} onClick={saveEditTemplate}>Save</button>
                            <button className="button" style={{ fontSize: '11px' }} onClick={() => setEditingTemplateIdx(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div style={{ flex: 1, opacity: t.enabled === false ? 0.4 : 1 }}>
                            <div className="template-label">{t.label}</div>
                            <div className="template-preview">{t.prompt.slice(0, 80)}…</div>
                          </div>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }}>
                            <button className={`template-toggle-btn ${t.enabled !== false ? 'on' : ''}`} onClick={() => toggleTemplate(i)} title={t.enabled !== false ? 'Disable' : 'Enable'}>
                              <Power size={12} />
                            </button>
                            <button className="template-action-btn" onClick={() => startEditTemplate(i)} title="Edit"><Edit2 size={12} /></button>
                            <button className="template-action-btn danger" onClick={() => removeTemplate(i)} title="Remove"><X size={12} /></button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Skills */}
              <div className="form-field" style={{ marginTop: '24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)' }}>AI Skills & Knowledge</h3>
                    <p className="form-hint" style={{ marginTop: '2px' }}>Load specialized files as context.</p>
                  </div>
                  <button className="button" style={{ fontSize: '12px' }} onClick={async () => {
                    const skills = await (window as any).api?.pickSkillFiles?.();
                    if (skills) setSettings(s => ({ ...s, skillFiles: [...s.skillFiles, ...skills] }));
                  }}><Plus size={12} /> Add Skills</button>
                </div>
                <div className="template-list" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                  {settings.skillFiles?.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '13px', background: 'var(--bg-secondary)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>No skills loaded.</div>
                  ) : settings.skillFiles?.map((skill, idx) => (
                    <div key={idx} className="template-item" style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '6px', background: 'rgba(47,129,247,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-color)' }}><FileCode size={16} /></div>
                        <div>
                          <div className="template-label" style={{ margin: 0, fontWeight: 600 }}>{skill.name}</div>
                          <div className="template-preview" style={{ fontSize: '11px', whiteSpace: 'nowrap', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{skill.path}</div>
                        </div>
                      </div>
                      <button className="button button-danger" style={{ padding: '4px', height: '28px', width: '28px' }}
                        onClick={() => setSettings(s => ({ ...s, skillFiles: s.skillFiles.filter((_, i) => i !== idx) }))}><X size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>

              <button className={`button ${saved ? '' : 'button-primary'} save-btn`} onClick={handleSave} style={{ background: saved ? '#238636' : undefined }}>
                {saved ? <CheckCircle size={16} /> : <Save size={16} />}{saved ? 'Saved!' : 'Save Settings'}
              </button>
            </section>
          )}

          {/* ── Voice ── */}
          {activeTab === 'voice' && (
            <section className="settings-section">
              <div className="settings-section-title"><Volume2 size={18} /> Voice & TTS</div>
              <p className="form-hint" style={{ marginBottom: '16px' }}>Configure text-to-speech using Supertonic 3 engine. Supports 31 languages with automatic detection.</p>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginBottom: '20px' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 0 }}>Enable TTS</label>
                  <p className="form-hint" style={{ marginTop: '4px', marginBottom: 0 }}>Read AI responses aloud automatically.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: settings.ttsEnabled ? 'var(--green)' : 'var(--text-secondary)' }}>{settings.ttsEnabled ? 'ON' : 'OFF'}</span>
                  <label className="toggle-switch">
                    <input type="checkbox" style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} checked={!!settings.ttsEnabled} onChange={e => set('ttsEnabled', e.target.checked)} />
                    <span className="slider round" />
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'var(--bg-tertiary)', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '16px' }}>
                <div>
                  <label className="form-label" style={{ marginBottom: 0 }}>Auto Vocal</label>
                  <p className="form-hint" style={{ marginTop: '4px', marginBottom: 0 }}>Automatically generate and play a voice message after each AI response.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: settings.autoVocal ? 'var(--green)' : 'var(--text-secondary)' }}>{settings.autoVocal ? 'ON' : 'OFF'}</span>
                  <label className="toggle-switch">
                    <input type="checkbox" style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} checked={!!settings.autoVocal} onChange={e => set('autoVocal', e.target.checked)} />
                    <span className="slider round" />
                  </label>
                </div>
              </div>

              <div className="form-field">
                <label className="form-label">Select Voice</label>
                <p className="form-hint" style={{ marginBottom: '12px' }}>Choose a voice style. Click play to preview.</p>
                <div className="voice-grid">
                  {VOICES.map(v => (
                    <button
                      key={v.id}
                      type="button"
                      className={`voice-card voice-card--hero ${settings.ttsVoice === v.id ? 'voice-card--active' : ''}`}
                      onClick={() => set('ttsVoice', v.id)}
                    >
                      <img className="voice-card-bg" src={voiceImageUrl(v.id)} alt={v.label} />
                      <div className="voice-card-overlay" aria-hidden />
                      <div className="voice-card-center">
                        <div className="voice-card-name">{v.label}</div>
                        <div className="voice-card-meta">{v.id} · {v.gender}</div>
                      </div>
                      <span
                        className={`voice-play-btn ${playingVoice === v.id ? 'playing' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); playingVoice === v.id ? stopVoicePreview() : playVoicePreview(v.id); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); playingVoice === v.id ? stopVoicePreview() : playVoicePreview(v.id); } }}
                      >
                        {playingVoice === v.id ? <StopIcon size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <button className={`button ${saved ? '' : 'button-primary'} save-btn`} onClick={handleSave} style={{ background: saved ? '#238636' : undefined, marginTop: '24px' }}>
                {saved ? <CheckCircle size={16} /> : <Save size={16} />}{saved ? 'Saved!' : 'Save Settings'}
              </button>
            </section>
          )}

          {/* ── About ── */}
          {activeTab === 'info' && (
            <section className="settings-section">
              <div className="settings-section-title"><Info size={18} /> About XAi</div>
              <div style={{ padding: '28px', background: 'var(--bg-tertiary)', borderRadius: '12px', border: '1px solid var(--border-color)', textAlign: 'center' }}>
                <div style={{ fontSize: '38px', fontWeight: 800, letterSpacing: '-1px', background: 'linear-gradient(135deg, #60a5fa, #a78bfa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '12px' }}>XAi</div>
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>Version 1.3.0</div>
                <div style={{ width: '60px', height: '2px', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)', margin: '16px auto' }} />
                <p style={{ fontSize: '14px', lineHeight: 1.75, color: 'var(--text-primary)', maxWidth: '520px', margin: '0 auto 16px', textAlign: 'left' }}>
                  <strong>XAi</strong> is a desktop AI workspace that runs <strong>entirely on your machine</strong> — no cloud account required for chat, voice, or models. Connect local <strong>.gguf</strong> text and vision models, talk with voice replies, use quick prompt modes, and keep your data private.
                </p>
                <ul style={{ fontSize: '13px', lineHeight: 1.65, color: 'var(--text-secondary)', maxWidth: '520px', margin: '0 auto 20px', paddingLeft: '20px', textAlign: 'left' }}>
                  <li>Offline chat with streaming responses and session history</li>
                  <li>Call mode with automatic voice (TTS) playback</li>
                  <li>Image input, diagrams, project planning, and skills</li>
                  <li>Customizable themes, backgrounds, and vocal styles</li>
                </ul>
                <div style={{ width: '60px', height: '2px', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)', margin: '16px auto' }} />
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Built with passion by</p>
                <a href="https://github.com/YASSER-27" target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 18px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#60a5fa', textDecoration: 'none', fontSize: '14px', fontWeight: 600, transition: 'all 0.2s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(96,165,250,0.1)'; e.currentTarget.style.borderColor = 'rgba(96,165,250,0.3)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
                  YASSER-27
                </a>
                <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '20px', opacity: 0.6 }}>© 2026 YASSER-27. All rights reserved.</p>
              </div>
            </section>
          )}
        </div>
      </div>

      {customDialog?.isOpen && (
        <div className="custom-dialog-overlay" onClick={() => {
          if (customDialog.type === 'alert') {
            customDialog.onConfirm();
            setCustomDialog(null);
          }
        }}>
          <div className="custom-dialog-box" onClick={e => e.stopPropagation()}>
            <div className="custom-dialog-title">{customDialog.title}</div>
            <div className="custom-dialog-message">{customDialog.message}</div>
            <div className="custom-dialog-buttons">
              {customDialog.type === 'confirm' && (
                <button className="button" onClick={() => {
                  customDialog.onCancel?.();
                  setCustomDialog(null);
                }}>Cancel</button>
              )}
              <button className="button button-primary" onClick={() => {
                customDialog.onConfirm();
                setCustomDialog(null);
              }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
