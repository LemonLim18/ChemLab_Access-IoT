import os
import cv2
import time
from pathlib import Path
from PIL import Image
from transformers import (
    pipeline,
    AutoModelForObjectDetection,
    AutoImageProcessor,
)
import numpy as np

# ----------------- CONFIG -----------------
PI_STREAM_URL = "http://192.168.1.20:8000/video"   # change to your Pi IP
LOCAL_MODEL_DIR = Path(__file__).parent.resolve() / "fridge_model"
USE_LOCAL_ONLY = False   # set True to fail if local model not found (no fallback)
DEVICE = -1              # -1 = CPU, 0 = first CUDA GPU (if available)
CONF_THRESHOLD = 0.35    # minimum confidence to draw a box
SAVE_OUTPUT = True
OUTPUT_DIR = Path("snapshots")
# ------------------------------------------

OUTPUT_DIR.mkdir(exist_ok=True)

def load_detector(local_model_dir: Path):
    """
    Try to load an object-detection model and processor from a local folder.
    If that fails and USE_LOCAL_ONLY=False, fall back to a public DETR model.
    Returns: transformers pipeline object
    """
    # Try local first
    if local_model_dir.exists():
        try:
            print("Trying to load local object-detection model from:", local_model_dir)
            model = AutoModelForObjectDetection.from_pretrained(str(local_model_dir), local_files_only=True)
            processor = AutoImageProcessor.from_pretrained(str(local_model_dir), local_files_only=True)
            detector = pipeline("object-detection", model=model, feature_extractor=processor, device=DEVICE)
            print("Loaded local object-detection model successfully.")
            return detector
        except Exception as e:
            print("Local model load failed:", e)
            if USE_LOCAL_ONLY:
                raise RuntimeError("Local model load failed and USE_LOCAL_ONLY=True") from e
            print("Falling back to remote model because local load failed.")
    # Fallback to public model (internet required)
    print("Loading fallback model 'facebook/detr-resnet-50' from Hugging Face (internet required)...")
    detector = pipeline("object-detection", model="facebook/detr-resnet-50", device=DEVICE)
    print("Fallback model loaded.")
    return detector

def convert_box(box, img_w, img_h):
    """
    Convert detection 'box' from pipeline output to absolute pixel coords (xmin,ymin,xmax,ymax).
    The pipeline may return normalized boxes (0-1) or absolute pixel values depending on model.
    We detect which and convert accordingly.
    """
    # box can be dict or list/tuple
    if isinstance(box, dict):
        # some pipelines returns {'xmin':..., 'ymin':...}
        if {"xmin","ymin","xmax","ymax"} <= set(box.keys()):
            xmin = box["xmin"]; ymin = box["ymin"]; xmax = box["xmax"]; ymax = box["ymax"]
        elif {"x_center","y_center","width","height"} <= set(box.keys()):
            cx = box["x_center"]; cy = box["y_center"]; w = box["width"]; h = box["height"]
            xmin = cx - w/2; ymin = cy - h/2; xmax = cx + w/2; ymax = cy + h/2
        else:
            # unknown format, convert to flattened list below if possible
            vals = [v for v in box.values()]
            if len(vals) >= 4:
                xmin, ymin, w, h = vals[:4]
                xmax = xmin + w; ymax = ymin + h
            else:
                return None
    elif isinstance(box, (list, tuple, np.ndarray)):
        xmin, ymin, w, h = box[:4]
        xmax = xmin + w; ymax = ymin + h
    else:
        return None

    # If coords look normalized (<=1.0), scale by image size
    if max(xmin, ymin, xmax, ymax) <= 1.01:
        xmin = int(round(xmin * img_w))
        ymin = int(round(ymin * img_h))
        xmax = int(round(xmax * img_w))
        ymax = int(round(ymax * img_h))
    else:
        xmin = int(round(xmin))
        ymin = int(round(ymin))
        xmax = int(round(xmax))
        ymax = int(round(ymax))

    # clamp
    xmin = max(0, min(xmin, img_w-1))
    ymin = max(0, min(ymin, img_h-1))
    xmax = max(0, min(xmax, img_w-1))
    ymax = max(0, min(ymax, img_h-1))

    return xmin, ymin, xmax, ymax

def run_snapshot_and_detect(detector, frame_bgr, conf_thresh=0.35):
    """
    Accept an OpenCV BGR frame, run detector (transformers pipeline),
    return annotated BGR image and list of detections.
    """
    # Convert to PIL RGB for the pipeline
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    pil = Image.fromarray(rgb)

    # Run detection
    results = detector(pil)

    h, w = frame_bgr.shape[:2]
    annotated = frame_bgr.copy()
    detections = []

    # results is a list of dicts with keys: 'score','label','box' typically
    for r in results:
        score = float(r.get("score", 0.0))
        if score < conf_thresh:
            continue
        label = r.get("label", "N/A")
        box = r.get("box", None) or r.get("bbox", None) or r.get("boxes", None) or r.get("rect", None)
        if box is None:
            # sometimes pipeline returns plain list
            # try interpreting r as {'score':..., 'label':..., 'xmin':...}
            box = {k: r[k] for k in ("xmin","ymin","xmax","ymax") if k in r}
            if not box:
                continue

        coords = convert_box(box, w, h)
        if coords is None:
            continue
        xmin,ymin,xmax,ymax = coords
        detections.append({"label": label, "score": score, "box": coords})

        # Draw rectangle and label
        color = (0, 255, 0)  # green
        cv2.rectangle(annotated, (xmin, ymin), (xmax, ymax), color, 2)

        txt = f"{label} {score:.2f}"
        # put text background
        (tx, ty), baseline = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
        tx2 = xmin + tx + 6
        ty2 = ymin - 6 if ymin - 6 > tx else ymin + ty + 6
        # clamp ty2
        if ty2 < 0:
            ty2 = ymin + ty + 6
        cv2.rectangle(annotated, (xmin, ymin - ty - 8), (xmin + tx + 6, ymin), (0, 255, 0), -1)
        cv2.putText(annotated, txt, (xmin + 3, ymin - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 1, cv2.LINE_AA)

    return annotated, detections

def main_loop():
    # Load detector (local or fallback)
    try:
        detector = load_detector(LOCAL_MODEL_DIR)
    except Exception as e:
        print("Failed to prepare object detector:", e)
        return

    # Open stream
    cap = cv2.VideoCapture(PI_STREAM_URL)
    if not cap.isOpened():
        print("Failed to open video stream:", PI_STREAM_URL)
        return
    print("Stream opened. Press 'A' to take snapshot and run detection. Press 'Q' to quit.")

    frame = None
    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to read frame from stream. Retrying in 0.5s...")
            time.sleep(0.5)
            continue

        # show live preview (no boxes yet)
        preview = frame.copy()
        h,w = preview.shape[:2]
        cv2.putText(preview, "Press 'A' to snapshot & detect, 'Q' to quit", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255,255,255), 2, cv2.LINE_AA)
        cv2.imshow("Pi Live Preview (Press A)", preview)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q') or key == ord('Q'):
            break
        if key == ord('a') or key == ord('A'):
            # take snapshot (current frame), run detector
            ts = int(time.time())
            out_name = OUTPUT_DIR / f"snapshot_{ts}.jpg"
            print("Snapshot taken, running detection...")
            annotated, detections = run_snapshot_and_detect(detector, frame, CONF_THRESHOLD)

            # save annotated image
            if SAVE_OUTPUT:
                cv2.imwrite(str(out_name), annotated)
                print(f"Annotated snapshot saved to: {out_name}")

            # show annotated result until a key is pressed
            txt_top = f"Detections: {len(detections)} (thr={CONF_THRESHOLD})"
            cv2.putText(annotated, txt_top, (10,30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0,255,0), 2, cv2.LINE_AA)
            cv2.imshow("Snapshot - Detections", annotated)
            print("Detections:")
            for det in detections:
                print(f" - {det['label']} score={det['score']:.3f} box={det['box']}")
            print("Press any key in the image window to continue preview.")
            cv2.waitKey(0)
            cv2.destroyWindow("Snapshot - Detections")

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main_loop()
