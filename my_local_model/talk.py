import sys
import json
import argparse
import os
import io

# Force UTF-8 for Windows pipes
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding='utf-8')
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', write_through=True)

# 1. تخطي مشكلة الشبح والتعارض محلياً لضمان قراءة المكتبة الصحيحة
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir in sys.path: 
    sys.path.remove(current_dir)
sys.path.append(current_dir)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model-dir', required=True)
    args = parser.parse_args()

    # Preload the STT model
    try:
        from faster_whisper import WhisperModel
        model_path = args.model_dir
        
        # If the passed model_dir is the directory containing this script, use it directly
        # Otherwise, if it doesn't contain config.json but has my_local_model inside, use that
        if not os.path.exists(os.path.join(model_path, "config.json")):
            if os.path.exists(os.path.join(model_path, "my_local_model", "config.json")):
                model_path = os.path.join(model_path, "my_local_model")
            else:
                # Assume the script is running from inside my_local_model
                # Try to use the directory where the script is located
                script_dir = os.path.dirname(os.path.abspath(__file__))
                if os.path.exists(os.path.join(script_dir, "config.json")):
                    model_path = script_dir
            
        model = WhisperModel(model_path, device="cpu", compute_type="int8")
        print(json.dumps({"status": "ready"}))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.stdout.flush()
        sys.exit(1)

    while True:
        line = sys.stdin.readline()
        if not line: break
        line = line.strip()
        if not line: continue
        
        try:
            req = json.loads(line)
            if req.get("action") == "stop":
                break
                
            audio_path = req.get("audio", "")
            req_id = req.get("id", "0")
            
            if not audio_path or not os.path.exists(audio_path):
                print(json.dumps({"id": req_id, "success": False, "error": "Audio file not found"}))
                sys.stdout.flush()
                continue
            
            # Run transcription
            segments, info = model.transcribe(audio_path, beam_size=5)
            
            text_segments = []
            for segment in segments:
                text = segment.text.strip()
                if text:
                    text_segments.append(text)
            
            full_text = " ".join(text_segments)
            
            print(json.dumps({
                "id": req_id,
                "success": True,
                "text": full_text
            }))
            sys.stdout.flush()
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
            sys.stdout.flush()

if __name__ == '__main__':
    main()