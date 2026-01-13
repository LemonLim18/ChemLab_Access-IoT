# FEMALE
from gtts import gTTS
import os
import subprocess

def speak_cute(text):
    # 1. Create the audio object
    # lang='en' with tld='com' (US) or 'com.au' (Australian) for different vibes
    tts = gTTS(text=text, lang='en', tld='com.au', slow=False)
    
    # 2. Save to a temporary file
    filename = "alert.mp3"
    tts.save(filename)
    
    # 3. Play it at max volume
    # -g 100 sets the player gain to 100%
    subprocess.run(['mpg123', '-q', '-g', '60', filename])
    
    # 4. Clean up
    os.remove(filename)

if __name__ == "__main__":
    # Phrases like "Oh no" or "Sorry" make it sound more like a real person
    msg = "Access Denied. Sorry, please try again later."
    print("Playing real girl voice...")
    speak_cute(msg)
