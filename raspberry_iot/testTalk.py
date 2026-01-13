import subprocess

def speak(text):
    # -a 200 sets volumn, -s 150 sets speed
    # We use subprocess to ensure it hits the right audio card
    subprocess.run(['espeak-ng', '-a', '200', '-s', '150', text])

if __name__ == "__main__":
    my_text = "Emergency alert! Please evacuate the building immediately."
    print("Speaking...")
    speak(my_text)