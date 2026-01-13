import subprocess
import os

def speak(text):
    """
    MAX Volume & CLARITY Optimization.
    """
    # 1. Double Hardware Boost (Headphone + PCM)
    subprocess.run(['amixer', '-c', '1', 'sset', 'Headphone', '100%'], capture_output=True)
    subprocess.run(['amixer', '-c', '1', 'sset', 'PCM', '100%'], capture_output=True)

    temp_file = "/tmp/voice_boost.wav"
    try:
        # --- Option 1: Festival (Natural & Strong) ---
        p = subprocess.Popen(['text2wave', '-o', temp_file], stdin=subprocess.PIPE)
        p.communicate(input=text.encode())
        if os.path.exists(temp_file):
            subprocess.run(['aplay', '-q', '-D', 'hw:1,0', temp_file], check=True)

    except Exception:
        # --- Option 2: 'Power Male' espeak-ng (Fallback) ---
        # -v en-us+m7 : Strong, high-resonance male voice
        # -a 200      : Max amplitude
        # -p 48       : Clear resonance for cutting through noise
        # -k 20       : Sharpen phonemes (Capital emphasis)
        # -g 5        : Professional word spacing
        p1 = subprocess.Popen([
            'espeak-ng', 
            '-v', 'en-us+m7', 
            '-a', '200', 
            '-s', '130', 
            '-p', '48', 
            '-k', '20', 
            '-g', '10', 
            '--stdout', 
            text
        ], stdout=subprocess.PIPE)
        subprocess.run(['aplay', '-q', '-D', 'hw:1,0', '-B', '500000'], stdin=p1.stdout)
            
    finally:
        if os.path.exists(temp_file):
            os.remove(temp_file)

if __name__ == "__main__":
    msg = "Access Denied. Please try again later"
    print("Speaking with STRONG and CLEAR voice...")
    speak(msg)
