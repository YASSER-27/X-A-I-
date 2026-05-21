export type AutocompleteSuggestion = {
  value: string;
  label: string;
  kind: 'command' | 'word' | 'history';
};
