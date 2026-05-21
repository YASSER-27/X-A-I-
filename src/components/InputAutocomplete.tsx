import type { AutocompleteSuggestion } from './InputAutocomplete.types';

export type { AutocompleteSuggestion } from './InputAutocomplete.types';

/** Extract the word being typed at cursor (supports Latin + Arabic). */
export function getWordAtCursor(text: string, cursor: number): { word: string; start: number; end: number } {
  const before = text.slice(0, cursor);
  const after = text.slice(cursor);
  const beforeMatch = before.match(/[/\w\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF-]*$/u);
  const afterMatch = after.match(/^[/\w\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF-]*/u);
  const start = beforeMatch ? cursor - beforeMatch[0].length : cursor;
  const end = cursor + (afterMatch ? afterMatch[0].length : 0);
  const word = text.slice(start, end);
  return { word, start, end };
}

type InputAutocompleteMenuProps = {
  items: AutocompleteSuggestion[];
  activeIndex: number;
  onSelect: (value: string) => void;
  onHoverIndex: (index: number) => void;
};

const MAX_CHIPS = 4;

export function InputAutocompleteMenu({
  items,
  activeIndex,
  onSelect,
  onHoverIndex,
}: InputAutocompleteMenuProps) {
  const chips = items.slice(0, MAX_CHIPS);
  if (chips.length === 0) return null;

  return (
    <div className="input-autocomplete-float" role="listbox" aria-label="Suggestions">
      <div className="input-autocomplete-row">
        {chips.map((item, idx) => (
          <button
            key={`${item.kind}-${item.value}`}
            type="button"
            role="option"
            aria-selected={idx === activeIndex}
            className={`input-autocomplete-word ${idx === activeIndex ? 'active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item.value);
            }}
            onMouseEnter={() => onHoverIndex(idx)}
          >
            {item.value}
          </button>
        ))}
      </div>
    </div>
  );
}
