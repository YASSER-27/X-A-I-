import { AUTOCOMPLETE_WORDS } from '../data/autocompleteWords';
import type { AutocompleteSuggestion } from '../components/InputAutocomplete';

let lastKey = '';
let lastResult: AutocompleteSuggestion[] = [];

export async function searchAutocomplete(
  word: string,
  commands: { cmd: string; desc: string }[],
  recentPhrases: string[],
  limit = 4
): Promise<AutocompleteSuggestion[]> {
  const q = word.trim();
  if (!q) return [];

  const cacheKey = `${q}\0${limit}`;
  if (cacheKey === lastKey) return lastResult;

  const out: AutocompleteSuggestion[] = [];
  const seen = new Set<string>();
  const push = (s: AutocompleteSuggestion) => {
    const k = s.value.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };

  if (q.startsWith('/')) {
    const lower = q.toLowerCase();
    for (const c of commands) {
      if (c.cmd.toLowerCase().startsWith(lower)) {
        push({ value: c.cmd, label: c.desc, kind: 'command' });
      }
    }
    lastKey = cacheKey;
    lastResult = out.slice(0, limit);
    return lastResult;
  }

  if (q.length < 2) {
    lastKey = cacheKey;
    lastResult = [];
    return lastResult;
  }

  const lower = q.toLowerCase();
  for (const w of AUTOCOMPLETE_WORDS) {
    if (out.length >= limit) break;
    if (w.toLowerCase().startsWith(lower)) {
      push({ value: w, label: w, kind: 'word' });
    }
  }

  for (const phrase of recentPhrases) {
    if (out.length >= limit) break;
    const parts = phrase.split(/\s+/);
    const last = parts[parts.length - 1];
    if (last && last.toLowerCase().startsWith(lower)) {
      push({ value: last, label: 'history', kind: 'history' });
    }
  }

  lastKey = cacheKey;
  lastResult = out.slice(0, limit);
  return lastResult;
}
