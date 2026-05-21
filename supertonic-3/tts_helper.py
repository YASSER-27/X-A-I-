"""
Supertonic-3 TTS Helper for XAi
Usage: python tts_helper.py --voice M1 --text "Hello world" --output output.wav --model-dir ./supertonic-3
       python tts_helper.py --voice F1 --text "مرحبا" --output output.wav --model-dir ./supertonic-3
"""
import sys
import json
import argparse
import os
import re

# Language detection patterns (Unicode ranges)
LANG_PATTERNS = {
    'ar': re.compile(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]'),
    'ja': re.compile(r'[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]'),
    'ko': re.compile(r'[\uAC00-\uD7AF\u1100-\u11FF]'),
    'hi': re.compile(r'[\u0900-\u097F]'),
    'el': re.compile(r'[\u0370-\u03FF]'),
    'ru': re.compile(r'[\u0400-\u04FF]'),
    'uk': re.compile(r'[\u0400-\u04FF]'),
    'bg': re.compile(r'[\u0400-\u04FF]'),
    'vi': re.compile(r'[\u00C0-\u024F\u1E00-\u1EFF]'),
}

SUPPORTED_LANGS = [
    'en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi',
    'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro',
    'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi'
]

def detect_language(text: str) -> str:
    """Auto-detect language from text using Unicode analysis."""
    for lang, pattern in LANG_PATTERNS.items():
        matches = pattern.findall(text)
        if len(matches) > len(text) * 0.15:
            return lang
    # Default to English for Latin scripts
    return 'en'

def main():
    parser = argparse.ArgumentParser(description='Supertonic-3 TTS')
    parser.add_argument('--voice', required=True, help='Voice ID (F1-F5, M1-M5)')
    parser.add_argument('--text', required=True, help='Text to synthesize')
    parser.add_argument('--output', required=True, help='Output WAV file path')
    parser.add_argument('--model-dir', required=True, help='Path to supertonic-3 model dir')
    parser.add_argument('--lang', default='auto', help='Language code or "auto"')
    args = parser.parse_args()

    try:
        from supertonic import TTS

        # Initialize TTS with local model
        tts = TTS(model_dir=args.model_dir, auto_download=False)

        # Get voice style
        style = tts.get_voice_style(voice_name=args.voice)

        # Auto-detect or use specified language
        lang = args.lang if args.lang != 'auto' else detect_language(args.text)
        if lang not in SUPPORTED_LANGS:
            lang = 'en'

        # Synthesize
        wav, duration = tts.synthesize(args.text, voice_style=style, lang=lang)

        # Save
        tts.save_audio(wav, args.output)

        # Output result as JSON
        dur_val = duration.item() if hasattr(duration, 'item') else float(duration)
        result = {
            "success": True,
            "duration": round(dur_val, 2),
            "lang": lang,
            "voice": args.voice,
            "output": args.output
        }
        print(json.dumps(result))

    except Exception as e:
        result = {"success": False, "error": str(e)}
        print(json.dumps(result))
        sys.exit(1)

if __name__ == '__main__':
    main()
