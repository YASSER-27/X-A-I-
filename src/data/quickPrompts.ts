export type QuickPrompt = {
  id: string;
  label: string;
  instruction: string;
};

/** Preset modes applied to the next message (offline, no network). */
export const QUICK_PROMPTS: QuickPrompt[] = [
  { id: 'none', label: 'Normal', instruction: '' },
  { id: 'en', label: 'To English', instruction: 'Translate the following to English. Reply with the translation only.' },
  { id: 'ar', label: 'To Arabic', instruction: 'Translate the following to Arabic. Reply with the translation only.' },
  { id: 'fix', label: 'Fix text', instruction: 'Fix spelling, grammar, and clarity. Reply with the corrected text only.' },
  { id: 'summarize', label: 'Summarize', instruction: 'Summarize the following briefly and clearly.' },
  { id: 'coder', label: 'Pro coder', instruction: 'You are an expert programmer. Analyze and improve the following code or technical request. Be precise and practical.' },
  { id: 'spell', label: 'Spell check', instruction: 'Correct spelling and typos only. Reply with the corrected text only.' },
  { id: 'formal', label: 'Formal tone', instruction: 'Rewrite the following in a professional, formal tone.' },
  { id: 'simple', label: 'Simplify', instruction: 'Explain or rewrite the following in simple, easy language.' },
];

export function wrapWithQuickPrompt(text: string, promptId: string): string {
  if (!text.trim() || promptId === 'none') return text;
  const preset = QUICK_PROMPTS.find((p) => p.id === promptId);
  if (!preset?.instruction) return text;
  return `${preset.instruction}\n\n---\n${text}`;
}
