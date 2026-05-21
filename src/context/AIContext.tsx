import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

export type Message = { 
  id: string;
  role: 'user' | 'assistant' | 'system'; 
  content: string; 
  reasoning?: string; 
  raw?: string;
  image?: string; // Base64 image data
  stats?: { time: number; tokens: number };
  audioUrl?: string;
};

export type AISession = {
  id: string;
  title: string;
  messages: Message[];
  timestamp: number;
};

interface AIContextType {
  sessions: AISession[];
  setSessions: React.Dispatch<React.SetStateAction<AISession[]>>;
  currentSessionId: string | null;
  setCurrentSessionId: (id: string | null) => void;
  input: string;
  setInput: (v: string) => void;
  isStreaming: boolean;
  error: string | null;
  sendMessage: (overrideInput?: string, overrideImage?: string | null) => Promise<void>;
  stopGeneration: () => void;
  clearChat: () => void;
  createNewSession: () => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, newTitle: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  messages: Message[];
  selectedImage: string | null;
  setSelectedImage: (v: string | null) => void;
  thinkingMode: 'none' | 'think';
  setThinkingMode: (v: 'none' | 'think') => void;
  soundsEnabled: boolean;
  setSoundsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  contextMemoryEnabled: boolean;
  setContextMemoryEnabled: (v: boolean) => void;
  zoom: number;
  setZoom: (v: number) => void;
}

const AIContext = createContext<AIContextType | undefined>(undefined);

const PLAN_SYSTEM = `You are a project scaffolding expert. When given a project description, respond ONLY with a JSON object (no markdown, no explanation) in this exact format:
{
  "name": "repo-name-kebab-case",
  "files": [
    { "path": "relative/path/to/file.ext", "content": "full file content here" }
  ]
}
Include all necessary files: source code, package.json, README.md, etc.
IMPORTANT: DO NOT USE EMOJIS IN YOUR RESPONSE.`;

const DIAGRAM_SYSTEM = `You are a technical diagram specialist. When asked to create a diagram, choose the BEST format:
- Use **Mermaid** (wrapped in \`\`\`mermaid) for: flowcharts, sequences, class diagrams, ER diagrams, state machines, Gantt charts.
- Use **ASCII Art** for: simple trees, small tables, text-based layouts.
- Use **Graphviz DOT** (wrapped in \`\`\`dot) for: complex graphs and networks.

RULES:
1. Always output ONLY the diagram code in a fenced code block — no prose before it.
2. Add a short one-line title comment at the top of the diagram.
3. After the diagram block, add a 2-sentence plain-text explanation.
4. For Mermaid, prefer LR or TD direction depending on content.
5. **IMPORTANT (Mermaid)**: 
   - Always use double quotes for ALL node labels: A["Label"]
   - Avoid colons (:), brackets ([]), or math symbols (+, *, /, =) inside labels if possible.
   - If you MUST use a colon or dash, ensure it is inside double quotes and the node ID is simple alphanumeric: Node1["Identify Numbers: 15 and 2"]
   - **Sequence Diagrams**: Only use \`activate\` if you have a corresponding \`deactivate\`. Avoid nested activation if it's too complex. Ensure every activated participant is deactivated exactly once.
6. Keep diagrams readable — max 15 nodes per diagram.`;

const THINKING_SYSTEM = `You are a high-accuracy reasoning assistant. 
When asked to think or solve complex problems:
1. Always start your response with a <think> block explaining your internal reasoning, edge cases, and plan.
2. Be extremely precise and thorough in your technical analysis.
3. After the </think> block, provide the final, high-quality answer.
Maintain a professional, expert tone. 
IMPORTANT: DO NOT USE EMOJIS IN YOUR RESPONSE.`;

const VISION_SYSTEM = `You are a professional vision assistant. Describe images precisely and fulfill image-related coding or analysis requests. DO NOT USE EMOJIS.`;

function parsePlanJSON(text: string): { name: string; files: { path: string; content: string }[] } | null {
  let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return JSON.parse(cleaned);
  } catch {
    const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
    const name = nameMatch ? nameMatch[1] : `ai-project-${Date.now()}`;
    const files = [];
    const _parts = text.split(/"path"\s*:\s*"/).slice(1);
    for (const part of _parts) {
      const pMatch = part.match(/^([^"]+)"\s*,\s*"content"\s*:\s*"/);
      if (pMatch) {
        const pathName = pMatch[1];
        let contentPart = part.substring(pMatch[0].length);
        let endIdx = contentPart.lastIndexOf('"}');
        if (endIdx === -1) endIdx = contentPart.lastIndexOf('"');
        if (endIdx === -1) endIdx = contentPart.length;

        contentPart = contentPart.substring(0, endIdx);
        contentPart = contentPart.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        files.push({ path: pathName, content: contentPart });
      }
    }
    if (files.length > 0) return { name, files };
    return null;
  }
}

/**
 * Smart JSONL Streaming Parser (from Ollama reference)
 * Handles fragmented stream chunks and ensures robust JSON parsing.
 */
async function* parseJsonlFromStream<T>(stream: ReadableStream<Uint8Array>): AsyncGenerator<T, void, unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          try { yield JSON.parse(buffer.trim()); } catch (e) { console.error('Final buffer parse error:', e); }
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Handle llama.cpp 'data: ' prefix if present
        const cleanLine = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
        if (cleanLine === '[DONE]') continue;
        try { yield JSON.parse(cleanLine); } catch (e) { console.error('Line parse error:', e); }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* parseJsonlFromResponse<T>(response: Response): AsyncGenerator<T, void, unknown> {
  if (!response.body) throw new Error("Response body is null");
  yield* parseJsonlFromStream<T>(response.body);
}


export function AIProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<AISession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [thinkingMode, setThinkingMode] = useState<'none' | 'think'>('none');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [soundsEnabled, setSoundsEnabled] = useState(() => {
    const saved = localStorage.getItem('gitbot_sounds_enabled');
    return saved === null ? true : saved === 'true';
  });
  const [contextMemoryEnabled, setContextMemoryEnabled] = useState(() => {
    const saved = localStorage.getItem('gitbot_context_memory_enabled');
    return saved === null ? true : saved === 'true';
  });
  const [zoom, setZoom] = useState(() => {
    const saved = localStorage.getItem('gitbot_zoom');
    return saved ? parseInt(saved) : 50;
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('gitbot_sidebar_open');
    return saved === null ? true : saved === 'true';
  });
  const abortRef = useRef<AbortController | null>(null);
  // ── Settings cache — avoids blocking IPC on every send ──
  const settingsCacheRef = useRef<{ data: any; ts: number } | null>(null);
  const getCachedSettings = useCallback(async () => {
    const now = Date.now();
    if (settingsCacheRef.current && now - settingsCacheRef.current.ts < 30000) {
      return settingsCacheRef.current.data;
    }
    const s = await (window as any).api?.getSettings();
    settingsCacheRef.current = { data: s, ts: now };
    return s;
  }, []);

  useEffect(() => {
    localStorage.setItem('gitbot_sidebar_open', sidebarOpen.toString());
  }, [sidebarOpen]);

  useEffect(() => {
    localStorage.setItem('gitbot_sounds_enabled', soundsEnabled.toString());
  }, [soundsEnabled]);

  useEffect(() => {
    localStorage.setItem('gitbot_context_memory_enabled', contextMemoryEnabled.toString());
  }, [contextMemoryEnabled]);

  useEffect(() => {
    localStorage.setItem('gitbot_zoom', zoom.toString());
    document.documentElement.style.setProperty('--text-scale', (zoom / 50).toString());
  }, [zoom]);

  // Load from multiple session storage
  useEffect(() => {
    const saved = localStorage.getItem('gitbot_ai_sessions_v1');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Strip autoplay: prefix from loaded audioUrl
        const cleaned = parsed.map((s: any) => ({
          ...s,
          messages: s.messages.map((m: any) => {
            if (m.audioUrl?.startsWith('autoplay:')) {
              return { ...m, audioUrl: m.audioUrl.slice(9) };
            }
            return m;
          })
        }));
        setSessions(cleaned);
        if (cleaned.length > 0) setCurrentSessionId(cleaned[0].id);
      } catch (e) {
        // Fallback for old format
        const old = localStorage.getItem('gitbot_chat_v3');
        if (old) {
          try {
            const oldMsgs = JSON.parse(old);
            const cleanedOld = oldMsgs.map((m: any) => {
              if (m.audioUrl?.startsWith('autoplay:')) {
                return { ...m, audioUrl: m.audioUrl.slice(9) };
              }
              return m;
            });
            const initialSession: AISession = {
              id: 'legacy-session',
              title: 'Current Chat',
              messages: cleanedOld,
              timestamp: Date.now()
            };
            setSessions([initialSession]);
            setCurrentSessionId('legacy-session');
          } catch {}
        }
      }
    }
  }, []);

  // Save on change
  useEffect(() => {
    if (sessions.length > 0) {
      // Strip autoplay: prefix before saving to localStorage
      const cleaned = sessions.map(s => ({
        ...s,
        messages: s.messages.map(m => {
          if (m.audioUrl?.startsWith('autoplay:')) {
            return { ...m, audioUrl: m.audioUrl.slice(9) };
          }
          return m;
        })
      }));
      localStorage.setItem('gitbot_ai_sessions_v1', JSON.stringify(cleaned));
    }
  }, [sessions]);

  // Pre-warm settings cache on mount — zero IPC delay on first send
  useEffect(() => {
    getCachedSettings().catch(() => {});
  }, [getCachedSettings]);

  const stopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const createNewSession = useCallback(() => {
    stopGeneration(); // Stop any ongoing generation before switching
    const id = Date.now().toString();
    const newSession: AISession = {
      id,
      title: 'New Chat',
      messages: [],
      timestamp: Date.now()
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(id);
    setInput('');
  }, [stopGeneration]);

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== id);
      if (currentSessionId === id) {
        setCurrentSessionId(filtered.length > 0 ? filtered[0].id : null);
      }
      return filtered;
    });
  }, [currentSessionId]);

  const renameSession = useCallback((id: string, newTitle: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id === id) return { ...s, title: newTitle };
      return s;
    }));
  }, []);

  const clearChat = useCallback(() => {
    if (!currentSessionId) return;
    setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, messages: [] } : s));
    stopGeneration();
  }, [currentSessionId, stopGeneration]);

  const sendMessage = useCallback(async (overrideInput?: string, overrideImage?: string | null) => {
    const effectiveInput = (overrideInput ?? input).trim();
    const effectiveImage = overrideImage !== undefined ? overrideImage : selectedImage;
    if ((!effectiveInput && !effectiveImage) || isStreaming) return;

    // Ensure we have a session
    let sessionId = currentSessionId;
    if (!sessionId) {
      const newId = Date.now().toString();
      const newSession: AISession = {
        id: newId,
        title: 'New Chat',
        messages: [],
        timestamp: Date.now()
      };
      setSessions([newSession]);
      setCurrentSessionId(newId);
      sessionId = newId;
    }

    const isPlan = effectiveInput.trimStart().startsWith('/plan');
    const isThinkingCommand = effectiveInput.trimStart().startsWith('/thinking');
    // Keep reasoning strictly opt-in via /thinking for faster default responses.
    const isThinking = isThinkingCommand;
    const userContent = effectiveInput;
    const currentImage = effectiveImage;
    const userMsg: Message = { id: Date.now().toString() + '-u', role: 'user', content: userContent, image: currentImage || undefined };
    const assistantMsg: Message = { id: (Date.now() + 1).toString() + '-a', role: 'assistant', content: '' };

    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        // Auto-update title on first message
        const firstLine = userContent
          .replace(/^\/\w+\s*/i, '')
          .split('\n')[0]
          .trim();
        const autoTitle = firstLine || 'New Chat';
        const title = s.messages.length === 0 ? (autoTitle.length > 34 ? autoTitle.substring(0, 34) + '...' : autoTitle) : s.title;
        return { ...s, title, messages: [...s.messages, userMsg, assistantMsg], timestamp: Date.now() };
      }
      return s;
    }));

    const currentSession = sessions.find(s => s.id === sessionId);
    const historyMessages = currentSession ? currentSession.messages : [];

    setInput('');
    setSelectedImage(null);
    setIsStreaming(true);
    let sysPrompt = 'Professional coding assistant. Be concise and direct: short, precise answers unless the user asks for detail. No emojis. No filler or repetition.';
    // ── FAST: Use cached settings ──
    getCachedSettings().then((s: any) => {
      settingsCacheRef.current = { data: s, ts: Date.now() };
    }).catch(() => {});
    
    try {
      const s = settingsCacheRef.current?.data;
      if (s?.systemPrompt) sysPrompt = s.systemPrompt;
      if (s?.promptTemplates) {
        const enabledPrompts = s.promptTemplates
          .filter((t: any) => t.enabled === true)
          .map((t: any) => t.prompt)
          .join('\n\n');
        if (enabledPrompts) {
          sysPrompt = sysPrompt ? `${sysPrompt}\n\n${enabledPrompts}` : enabledPrompts;
        }
      }
    } catch {}

    if (isPlan) sysPrompt = PLAN_SYSTEM;
    else if (effectiveInput.trimStart().startsWith('/diagram')) sysPrompt = DIAGRAM_SYSTEM;
    else if (isThinking) sysPrompt = THINKING_SYSTEM;
    else if (currentImage) sysPrompt = VISION_SYSTEM;
    else if (!/concise|brief|short answer/i.test(sysPrompt)) {
      sysPrompt += '\n\nKeep answers concise unless the user asks for detail. Avoid repetition.';
    }

    abortRef.current = new AbortController();
    let fullResponse = '';

    try {
      setIsStreaming(true);
      setError(null);
      const startTime = performance.now();
      let tokenCounter = 0;

      // 🚀 HYBRID STRATEGY: Use /v1 for Vision (reliable), /completion for Text (fast)
      const useV1 = !!currentImage;
      const endpoint = useV1 ? 'http://127.0.0.1:8080/v1/chat/completions' : 'http://127.0.0.1:8080/completion';
      
      let body: any = {};
      if (useV1) {
        // Robust V1 body for Vision — Merge sysPrompt into user message to avoid Jinja errors
        const combinedPrompt = `${sysPrompt}\n\n${userContent}`;
        const apiHistory = [
          {
            role: 'user',
            content: [
              { type: 'text', text: combinedPrompt },
              { type: 'image_url', image_url: { url: currentImage as string } }
            ]
          }
        ];
        body = {
          messages: apiHistory,
          stream: true,
          temperature: 0.2,
          max_tokens: 1536,
          cache_prompt: false 
        };
      } else {
        // Ultra-fast Direct prompt for Text
        const historyWindow = contextMemoryEnabled ? 4 : 0;
        const history = historyMessages.slice(-historyWindow);
        let finalPrompt = `### System:\n${sysPrompt}\n\n`;
        for (const m of history) {
          const role = m.role === 'user' ? 'User' : 'Assistant';
          finalPrompt += `### ${role}:\n${m.content}\n\n`;
        }
        finalPrompt += `### User:\n${userContent}\n\n### Assistant:\n`;
        body = {
          prompt: finalPrompt,
          stream: true,
          temperature: (isPlan || isThinking) ? 0.2 : 0.45,
          n_predict: (isPlan || isThinking) ? 2048 : 1200,
          repeat_penalty: 1.18,
          stop: ['### User:', '### Assistant:', '</s>', '<|eot_id|>', 'User:', 'Assistant:', '### System:', 'System:']
        };
      }

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortRef.current.signal,
        body: JSON.stringify(body),
      });

      if (!resp.ok) throw new Error(`Server error: ${resp.status}`);

      let lastUpdateTime = 0;
      const UPDATE_INTERVAL = 80; 
      let isFirstToken = true;
      let pendingToken = '';

      const finalizeState = (force = false) => {
        const now = Date.now();
        if (!force && !isFirstToken && now - lastUpdateTime < UPDATE_INTERVAL) return;
        lastUpdateTime = now;
        isFirstToken = false;
        const snapToken = pendingToken;
        pendingToken = '';

        setSessions(prev => prev.map(s => {
          if (s.id === sessionId) {
            const arr = [...s.messages];
            const last = arr[arr.length - 1];
            if (last?.role === 'assistant') {
              const raw = (last.raw || '') + snapToken;
              let reasoning = last.reasoning || '';
              let answer = last.content || '';
              
              const lowerRaw = raw.toLowerCase();
              if (lowerRaw.includes('<think>')) {
                const startIdx = lowerRaw.indexOf('<think>');
                const endIdx = lowerRaw.indexOf('</think>');
                if (endIdx !== -1) {
                  reasoning = raw.substring(startIdx + 7, endIdx).trim();
                  answer = (raw.substring(0, startIdx) + raw.substring(endIdx + 8)).trim();
                } else {
                  reasoning = raw.substring(startIdx + 7);
                  answer = raw.substring(0, startIdx).trim();
                }
              } else {
                answer += snapToken;
              }

              arr[arr.length - 1] = {
                ...last,
                content: answer,
                reasoning,
                raw,
                stats: { 
                  time: parseFloat(((performance.now() - startTime) / 1000).toFixed(2)), 
                  tokens: tokenCounter 
                }
              };
            }
            return { ...s, messages: arr };
          }
          return s;
        }));
      };

      for await (const json of parseJsonlFromResponse<any>(resp)) {
        // Robust token extraction for both V1 and Direct formats
        let token = '';
        if (useV1) {
          token = json.choices?.[0]?.delta?.content || json.choices?.[0]?.text || '';
        } else {
          token = json.content || '';
        }
        
        if (!token) continue;
        tokenCounter++;
        fullResponse += token;
        pendingToken += token;
        finalizeState();
      }
      finalizeState(true);

      if (isPlan && fullResponse) {
        const plan = parsePlanJSON(fullResponse);
        if (plan) {
          const result = await (window as any).api?.createRepoFromPlan(plan.name, plan.files);
          const statusMsg = result?.success
            ? `\n\n---\n**Repository created:** \`${result.name}\` with ${plan.files.length} files.\nNavigate to Repositories to view it.`
            : `\n\n---\n**Failed to create repository:** ${result?.message}`;
          setSessions(prev => prev.map(s => {
            if (s.id === sessionId) {
              const arr = [...s.messages];
              const last = arr[arr.length - 1];
              if (last) arr[arr.length - 1] = { ...last, content: last.content + statusMsg };
              return { ...s, messages: arr };
            }
            return s;
          }));
        }
      }

      const endTime = performance.now();
      const finalTime = parseFloat(((endTime - startTime) / 1000).toFixed(2));
      const finalTokens = tokenCounter;

      setSessions(prev => prev.map(s => {
        if (s.id === sessionId) {
          const arr = [...s.messages];
          const last = arr[arr.length - 1];
          if (last?.role === 'assistant') {
            arr[arr.length - 1] = { ...last, stats: { time: finalTime, tokens: finalTokens } };
          }
          return { ...s, messages: arr };
        }
        return s;
      }));

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(`Connection failed: ${err.message}`);
        console.error('AI Request Error:', err);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, currentSessionId, sessions, thinkingMode, selectedImage, stopGeneration]);

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const messages = currentSession ? currentSession.messages : [];

  return (
    <AIContext.Provider value={{ 
      sessions, setSessions, currentSessionId, setCurrentSessionId, 
      input, setInput, isStreaming, error, sendMessage, 
      stopGeneration, clearChat, createNewSession, deleteSession, renameSession,
      sidebarOpen, setSidebarOpen, messages, selectedImage, setSelectedImage,
      thinkingMode, setThinkingMode, soundsEnabled, setSoundsEnabled,
      contextMemoryEnabled, setContextMemoryEnabled,
      zoom, setZoom
    }}>
      {children}
    </AIContext.Provider>
  );
}

export const useAI = () => {
  const ctx = useContext(AIContext);
  if (!ctx) throw new Error('useAI must be used within AIProvider');
  return ctx;
};
