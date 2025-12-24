import os
import cv2
import time
import numpy as np
from pathlib import Path
from PIL import Image
import matplotlib.pyplot as plt
# Roboflow HTTP client
from inference_sdk import InferenceHTTPClient
# Segmentation model helper (your existing helper)
from inference import get_model
# Supervision helpers for masks & labels
import supervision as sv
from google import genai

# ----------------- CONFIG -----------------
IMAGE_PATH = "images/grocery3.jpg"                    # input image
# FYPLAB WIFI
RF_API_URL = "http://192.168.1.116:9001"              # Roboflow local
# HOTSPOT
# RF_API_URL = "http://192.168.43.113:9001"              # Roboflow local
RF_API_KEY = "ZPaZtVScXqG1tnWDdOIx"
RF_MODEL_ID = "smart-fridge-co7ul/5"                  # rough object detection model
# RF_MODEL_ID = "fridge-0pnpx/1"                  # rough object detection model

# FYP LAB WIFI
SEG_API_URL = "http://192.168.1.116:9001"             # segmentation model host (same local docker)
# HOTSPOT
# SEG_API_URL = "http://192.168.43.113:9001"             # segmentation model host (same local docker)
SEG_API_KEY = "ZPaZtVScXqG1tnWDdOIx"
SEG_MODEL_ID = "yolov9-eggs/1"                        # instance segmentation model id used by get_model()

CONF_THRESHOLD = 0.35
IOU_THRESHOLD = 0.6
SAVE_OUTPUT = True
OUTPUT_DIR = Path("snapshots")
OUTPUT_DIR.mkdir(exist_ok=True)
# ------------------------------------------

client = genai.Client(api_key="YOUR_GOOGLE_GENAI_API_KEY")
response = client.models.generate_content(
    model = "gemini-2.5-flash",
    prompt = f"Analyze the image at {IMAGE_PATH} and provide a detailed list of categories of items present along with their respective counts.",
    # temperature = 0.7
)


# Create Roboflow client for rough detection
rf_client = InferenceHTTPClient(api_url=RF_API_URL, api_key=RF_API_KEY)

def parse_prediction_to_box(pred, img_w, img_h):
    """
    Same robust parser you provided — returns (xmin,ymin,xmax,ymax,label,score) or None.
    """
    score = pred.get("confidence") or pred.get("score") or pred.get("probability") or 0.0
    try:
        score = float(score)
    except Exception:
        score = 0.0

    label = pred.get("class") or pred.get("label") or pred.get("name") or pred.get("display_name") or "N/A"

    # Roboflow center format
    if ("x" in pred and "y" in pred and "width" in pred and "height" in pred):
        cx = float(pred["x"]); cy = float(pred["y"])
        bw = float(pred["width"]); bh = float(pred["height"])
        if max(cx, cy, bw, bh) <= 1.01:
            cx = cx * img_w; cy = cy * img_h
            bw = bw * img_w; bh = bh * img_h
        xmin = int(round(cx - bw / 2.0)); ymin = int(round(cy - bh / 2.0))
        xmax = int(round(cx + bw / 2.0)); ymax = int(round(cy + bh / 2.0))
        return xmin, ymin, xmax, ymax, str(label), score

    # box / bbox / bounding_box
    for key in ("box", "bbox", "bounding_box"):
        if key in pred:
            box = pred[key]
            if isinstance(box, dict):
                if {"xmin", "ymin", "xmax", "ymax"} <= set(box.keys()):
                    xmin = int(round(box["xmin"])); ymin = int(round(box["ymin"]))
                    xmax = int(round(box["xmax"])); ymax = int(round(box["ymax"]))
                    return xmin, ymin, xmax, ymax, str(label), score
            elif isinstance(box, (list, tuple, np.ndarray)):
                vals = list(box)
                if len(vals) >= 4:
                    a,b,c,d = vals[:4]
                    if max(a,b,c,d) <= 1.01:
                        xmin = int(round(a * img_w)); ymin = int(round(b * img_h))
                        xmax = int(round(c * img_w)); ymax = int(round(d * img_h))
                        return xmin, ymin, xmax, ymax, str(label), score
                    else:
                        if c > a and d > b:
                            xmin = int(round(a)); ymin = int(round(b)); xmax = int(round(c)); ymax = int(round(d))
                            return xmin, ymin, xmax, ymax, str(label), score
                        else:
                            xmin = int(round(a)); ymin = int(round(b)); xmax = int(round(a + c)); ymax = int(round(b + d))
                            return xmin, ymin, xmax, ymax, str(label), score

    # explicit keys
    if {"xmin","ymin","xmax","ymax"} <= set(pred.keys()):
        xmin = int(round(pred["xmin"])); ymin = int(round(pred["ymin"]))
        xmax = int(round(pred["xmax"])); ymax = int(round(pred["ymax"]))
        if max(xmin, ymin, xmax, ymax) <= 1:
            xmin = int(round(xmin * img_w)); ymin = int(round(ymin * img_h))
            xmax = int(round(xmax * img_w)); ymax = int(round(ymax * img_h))
        return xmin, ymin, xmax, ymax, str(label), score

    return None

def run_local_rbf_inference(frame_bgr, model_id, conf_thresh=0.35):
    """
    Send a single OpenCV BGR frame to the local Roboflow inference server
    and return (detections_list, annotated_image).
    detections_list = list of dicts: {'label','score','box':(xmin,ymin,xmax,ymax)}
    """
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(rgb)

    try:
        response = rf_client.infer(pil_img, model_id=model_id)
    except Exception as e:
        print("Local inference call failed:", e)
        return [], frame_bgr.copy()

    annotated = frame_bgr.copy()
    detections = []
    preds = response.get("predictions", []) if isinstance(response, dict) else []

    h, w = frame_bgr.shape[:2]
    if not preds:
        return [], annotated

    for p in preds:
        parsed = parse_prediction_to_box(p, w, h)
        if parsed is None:
            continue
        xmin, ymin, xmax, ymax, label, score = parsed
        if score < conf_thresh:
            continue

        xmin = max(0, min(xmin, w-1))
        ymin = max(0, min(ymin, h-1))
        xmax = max(0, min(xmax, w-1))
        ymax = max(0, min(ymax, h-1))

        detections.append({"label": label, "score": score, "box": (xmin, ymin, xmax, ymax)})

        # draw rough detection box + label on annotated image
        color = (0, 255, 0)
        cv2.rectangle(annotated, (xmin, ymin), (xmax, ymax), color, 2)
        txt = f"{label} {score:.2f}"
        (tx, ty), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
        y0 = max(ymin, ty + 8)
        cv2.rectangle(annotated, (xmin, ymin - ty - 8), (xmin + tx + 6, ymin), color, -1)
        cv2.putText(annotated, txt, (xmin + 3, ymin - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,0,0), 1, cv2.LINE_AA)

    return detections, annotated

def paste_annotated_crop_fullsize(base_img, crop_annotated, bbox):
    """
    Paste annotated crop (BGR) back into base_img at bbox position.
    bbox = (xmin,ymin,xmax,ymax)
    Handles size mismatches by resizing annotated crop to bbox size.
    """
    xmin,ymin,xmax,ymax = bbox
    h = ymax - ymin
    w = xmax - xmin
    if h <= 0 or w <= 0:
        return base_img
    # Resize annotated crop to fit bbox if sizes differ
    if crop_annotated.shape[0] != h or crop_annotated.shape[1] != w:
        crop_annotated = cv2.resize(crop_annotated, (w, h), interpolation=cv2.INTER_LINEAR)
    base_img[ymin:ymax, xmin:xmax] = crop_annotated
    return base_img

def main():
    # Load full image
    img_bgr = cv2.imread(IMAGE_PATH)
    if img_bgr is None:
        print("Failed to read image:", IMAGE_PATH)
        return

    h_full, w_full = img_bgr.shape[:2]

    # Dictionary to store counts per category
    category_counts = {}

    # 1) Run rough object detection (Roboflow)
    print("Running rough object detector (Roboflow)...")
    detections, rough_annotated = run_local_rbf_inference(img_bgr, RF_MODEL_ID, CONF_THRESHOLD)
    print(f"Rough detections: {len(detections)}")

    # Count rough detections per label
    for det in detections:
        label = det["label"].lower()
        category_counts[label] = category_counts.get(label, 0) + 1

    # 2) Load segmentation model (yolov9-eggs)
    print("Loading segmentation model (yolov9-eggs)...")
    seg_model = get_model(
        model_id=SEG_MODEL_ID,
        api_key=SEG_API_KEY,
        api_url=SEG_API_URL
    )

    # Supervision annotators (will be applied to crops)
    mask_annotator = sv.MaskAnnotator(opacity=0.5)
    label_annotator = sv.LabelAnnotator(text_scale=0.6, text_thickness=2)

    # copy of full image to paste results onto
    combined = rough_annotated.copy()

    # Process egg crops for instance segmentation
    egg_bbox_index = 0
    for det in detections:
        label = det["label"].lower()
        if "egg" not in label:
            continue

        egg_bbox_index += 1
        xmin, ymin, xmax, ymax = det["box"]

        # Crop ROI safely
        xmin_c = max(0, xmin); ymin_c = max(0, ymin)
        xmax_c = min(w_full, xmax); ymax_c = min(h_full, ymax)
        crop = img_bgr[ymin_c:ymax_c, xmin_c:xmax_c]
        if crop.size == 0:
            continue

        # Run segmentation on crop
        try:
            results_crop = seg_model.infer(crop)
        except Exception as e:
            print("Segmentation failed for crop:", e)
            continue

        if not results_crop or len(results_crop) == 0:
            continue

        res0 = results_crop[0]

        try:
            detections_crop = sv.Detections.from_inference(res0)
        except Exception as e:
            detections_crop = None
            preds = getattr(res0, "predictions", None) or res0.get("predictions", None) or []
            # Count all instances as 'egg' if conversion fails
            category_counts["egg"] = category_counts.get("egg", 0) + len(preds)
            continue

        # Count each segmented instance as 'egg'
        count_here = len(detections_crop)
        category_counts["egg"] = category_counts.get("egg", 0) + count_here

        # Annotate crop with masks + labels
        annotated_crop = mask_annotator.annotate(scene=crop.copy(), detections=detections_crop)

        labels = []
        preds = getattr(res0, "predictions", None) or res0.get("predictions", None) or []
        try:
            for p in preds:
                name = getattr(p, "class_name", None) or getattr(p, "label", None) or p.get("class_name", None) or p.get("label", None) or "egg"
                labels.append(str(name))
        except Exception:
            labels = ["egg"] * count_here

        try:
            annotated_crop = label_annotator.annotate(scene=annotated_crop, detections=detections_crop, labels=labels)
        except Exception:
            pass

        # Paste back into combined image
        combined = paste_annotated_crop_fullsize(combined, annotated_crop, (xmin_c, ymin_c, xmax_c, ymax_c))

    # Display counts per category
    print("\nItem counts per category:")
    for cat, count in category_counts.items():
        print(f" - {cat}: {count}")

    # Save combined output
    ts = int(time.time())
    out_path = OUTPUT_DIR / f"combined_annotated_{ts}.jpg"
    if SAVE_OUTPUT:
        cv2.imwrite(str(out_path), combined)
        print(f"Saved combined annotated image to: {out_path}")

    # Display with matplotlib
    rgb = cv2.cvtColor(combined, cv2.COLOR_BGR2RGB)
    plt.figure(figsize=(12, 8))
    plt.imshow(rgb)
    plt.axis("off")
    plt.title(f"Item counts: {category_counts}")
    plt.show()

if __name__ == "__main__":
    main()
