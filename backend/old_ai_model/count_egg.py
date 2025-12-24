import cv2
import supervision as sv
from PIL import Image
import numpy as np
from inference import get_model
import os

os.environ["CORE_MODEL_SAM_ENABLED"] = "False"
os.environ["CORE_MODEL_SAM2_ENABLED"] = "False"
os.environ["CORE_MODEL_SAM3_ENABLED"] = "False"
os.environ["CORE_MODEL_GAZE_ENABLED"] = "False"
os.environ["CORE_MODEL_YOLO_WORLD_ENABLED"] = "False"


# -----------------------
# Convert RGBA → RGB
# -----------------------
INPUT_IMAGE = "images/grocery2.png"
RGB_IMAGE = "images/grocery2_rgb.jpg"

img = Image.open(INPUT_IMAGE)
if img.mode == "RGBA":
    img = img.convert("RGB")
img.save(RGB_IMAGE, format="JPEG")

# -----------------------
# Load image
# -----------------------
image = cv2.imread(RGB_IMAGE)

# -----------------------
# Connect to LOCAL Docker inference
# -----------------------
model = get_model(
    model_id="yolov9-eggs/1",
    api_key="ZPaZtVScXqG1tnWDdOIx",
    api_url="http://192.168.1.116:9001"  # 🔥 local docker
)

# -----------------------
# Run inference (LOCAL, CACHED)
# -----------------------
results = model.infer(image)

# -----------------------
# Convert to Supervision
# -----------------------
detections = sv.Detections.from_inference(results[0])

labels = [
    p.class_name
    for p in results[0].predictions
]

# -----------------------
# Annotators
# -----------------------
mask_annotator = sv.MaskAnnotator(opacity=0.5)
label_annotator = sv.LabelAnnotator(text_scale=0.6, text_thickness=2)

# -----------------------
# Annotate
# -----------------------
annotated_image = mask_annotator.annotate(
    scene=image.copy(),
    detections=detections
)

annotated_image = label_annotator.annotate(
    scene=annotated_image,
    detections=detections,
    labels=labels
)

# -----------------------
# Count eggs
# -----------------------
egg_count = len(detections)
print(f"Egg count: {egg_count}")

# -----------------------
# Save & show
# -----------------------
cv2.imwrite("annotated_eggs.jpg", annotated_image)
sv.plot_image(image=annotated_image, size=(16, 16))
