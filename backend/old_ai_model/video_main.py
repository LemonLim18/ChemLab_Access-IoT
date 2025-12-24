import os
import cv2
import time
import numpy as np
from pathlib import Path
from PIL import Image
from inference_sdk import InferenceHTTPClient

# ----------------- CONFIG -----------------
PI_STREAM_URL = "http://192.168.1.20:8000/video"   # change to your Pi IP (MJPEG endpoint)
INFERENCE_API_URL = "http://192.168.1.116:9001"    # your local Roboflow server host:port
API_KEY = "ZPaZtVScXqG1tnWDdOIx"                   # your Roboflow API key
MODEL_ID = "smart-fridge-co7ul/5"                  # Roboflow project/version
CONF_THRESHOLD = 0.35   
IOU_THRESHOLD = 0.6                          # min confidence to keep detection
SAVE_OUTPUT = True
OUTPUT_DIR = Path("snapshots")
DISPLAY_WINDOW = "Pi Live Preview (Press A)"
# ------------------------------------------

OUTPUT_DIR.mkdir(exist_ok=True)

# Create local Roboflow client
client = InferenceHTTPClient(api_url=INFERENCE_API_URL, api_key=API_KEY)

def parse_prediction_to_box(pred, img_w, img_h):
    """
    Accept one prediction dict from Roboflow and return (xmin,ymin,xmax,ymax,label,score)
    Supports multiple output formats:
      - Roboflow detection format: {'x', 'y', 'width', 'height', 'class', 'confidence'}
      - bbox list: {'box': [xmin,ymin,xmax,ymax]} or {'bbox': [...]}
      - variant: {'xmin','ymin','xmax','ymax'}
    Returns None if format unrecognized.
    """
    # score / confidence
    score = pred.get("confidence") or pred.get("score") or pred.get("probability") or 0.0
    try:
        score = float(score)
    except Exception:
        score = 0.0

    # label/class
    label = pred.get("class") or pred.get("label") or pred.get("name") or pred.get("display_name") or "N/A"

    # 1) Roboflow center format (px or normalized)
    if ("x" in pred and "y" in pred and "width" in pred and "height" in pred):
        cx = float(pred["x"])
        cy = float(pred["y"])
        bw = float(pred["width"])
        bh = float(pred["height"])

        # Detect normalized coords (<=1.01) or absolute pixels
        if max(cx, cy, bw, bh) <= 1.01:
            cx = cx * img_w
            cy = cy * img_h
            bw = bw * img_w
            bh = bh * img_h

        xmin = int(round(cx - bw / 2.0))
        ymin = int(round(cy - bh / 2.0))
        xmax = int(round(cx + bw / 2.0))
        ymax = int(round(cy + bh / 2.0))

        return xmin, ymin, xmax, ymax, str(label), score

    # 2) 'box' / 'bbox' as list or tuple
    for key in ("box", "bbox", "bounding_box"):
        if key in pred:
            box = pred[key]
            if isinstance(box, dict):
                # maybe dict with xmin,ymin,xmax,ymax
                if {"xmin", "ymin", "xmax", "ymax"} <= set(box.keys()):
                    xmin = int(round(box["xmin"])); ymin = int(round(box["ymin"]))
                    xmax = int(round(box["xmax"])); ymax = int(round(box["ymax"]))
                    return xmin, ymin, xmax, ymax, str(label), score
                # maybe x_center etc.
            elif isinstance(box, (list, tuple, np.ndarray)):
                vals = list(box)
                if len(vals) >= 4:
                    # could be xmin,ymin,xmax,ymax OR xmin,ymin,width,height
                    a,b,c,d = vals[:4]
                    # Heuristic: if all <=1, treat normalized.
                    if max(a,b,c,d) <= 1.01:
                        # ambiguous: assume xmin,ymin,xmax,ymax normalized
                        xmin = int(round(a * img_w)); ymin = int(round(b * img_h))
                        xmax = int(round(c * img_w)); ymax = int(round(d * img_h))
                        return xmin, ymin, xmax, ymax, str(label), score
                    else:
                        # If c > a and d > b -> assume xmin,ymin,xmax,ymax
                        if c > a and d > b:
                            xmin = int(round(a)); ymin = int(round(b)); xmax = int(round(c)); ymax = int(round(d))
                            return xmin, ymin, xmax, ymax, str(label), score
                        else:
                            # treat as xmin,ymin,width,height
                            xmin = int(round(a)); ymin = int(round(b)); xmax = int(round(a + c)); ymax = int(round(b + d))
                            return xmin, ymin, xmax, ymax, str(label), score

    # 3) keys xmin,ymin,xmax,ymax present directly
    if {"xmin","ymin","xmax","ymax"} <= set(pred.keys()):
        xmin = int(round(pred["xmin"])); ymin = int(round(pred["ymin"]))
        xmax = int(round(pred["xmax"])); ymax = int(round(pred["ymax"]))
        # If values are normalized (<=1), scale
        if max(xmin, ymin, xmax, ymax) <= 1:
            xmin = int(round(xmin * img_w)); ymin = int(round(ymin * img_h))
            xmax = int(round(xmax * img_w)); ymax = int(round(ymax * img_h))
        return xmin, ymin, xmax, ymax, str(label), score

    # Unknown format
    return None

def run_local_rbf_inference(frame_bgr, model_id, conf_thresh=0.35, iou_thresh=0.6):
    """
    Send a single OpenCV BGR frame to the local Roboflow inference server
    and return (detections_list, annotated_image).
    detections_list = list of dicts: {'label','score','box':(xmin,ymin,xmax,ymax)}
    """
    # Convert BGR → PIL RGB
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(rgb)

    try:
        response = client.infer(pil_img, model_id=model_id)
    except Exception as e:
        print("Local inference call failed:", e)
        return [], frame_bgr

    annotated = frame_bgr.copy()
    detections = []
    preds = response.get("predictions", []) if isinstance(response, dict) else []

    h, w = frame_bgr.shape[:2]
    if not preds:
        # Debug: show response when empty
        # print("No predictions returned; full response:", response)
        return [], annotated

    for p in preds:
        parsed = parse_prediction_to_box(p, w, h)
        if parsed is None:
            # unknown format — skip
            continue
        xmin, ymin, xmax, ymax, label, score = parsed
        if score < conf_thresh:
            continue

        # clamp
        xmin = max(0, min(xmin, w-1))
        ymin = max(0, min(ymin, h-1))
        xmax = max(0, min(xmax, w-1))
        ymax = max(0, min(ymax, h-1))

        detections.append({"label": label, "score": score, "box": (xmin, ymin, xmax, ymax)})

        # Draw rectangle and label background
        color = (0, 255, 0)
        cv2.rectangle(annotated, (xmin, ymin), (xmax, ymax), color, 2)
        txt = f"{label} {score:.2f}"
        (tx, ty), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
        y0 = max(ymin, ty + 8)
        cv2.rectangle(annotated, (xmin, ymin - ty - 8), (xmin + tx + 6, ymin), color, -1)
        cv2.putText(annotated, txt, (xmin + 3, ymin - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0,0,0), 1, cv2.LINE_AA)

    return detections, annotated

def main_loop():
    # Open video stream
    cap = cv2.VideoCapture(PI_STREAM_URL)
    if not cap.isOpened():
        print("Failed to open video stream:", PI_STREAM_URL)
        return

    print("Stream opened. Press 'A' to take snapshot and run detection. Press 'Q' to quit.")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Stream frame failed — retrying...")
            time.sleep(0.5)
            continue

        preview = frame.copy()
        cv2.putText(preview, "Press 'A' to snapshot & detect, 'Q' to quit",
                    (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255,255,255), 2)
        cv2.imshow(DISPLAY_WINDOW, preview)

        key = cv2.waitKey(1) & 0xFF
        if key in (ord('q'), ord('Q')):
            break

        if key in (ord('a'), ord('A')):
            ts = int(time.time())
            out_name = OUTPUT_DIR / f"snapshot_{ts}.jpg"
            print("Snapshot taken — running local Roboflow inference...")

            detections, annotated = run_local_rbf_inference(frame, MODEL_ID, CONF_THRESHOLD, IOU_THRESHOLD)

            if SAVE_OUTPUT:
                cv2.imwrite(str(out_name), annotated)
                print(f"Saved annotated snapshot to {out_name}")

            print(f"Detections ({len(detections)}):")
            for det in detections:
                print(f" - {det['label']} {det['score']:.3f} box={det['box']}")

            cv2.imshow("Snapshot - Local Detections", annotated)
            cv2.waitKey(0)
            cv2.destroyWindow("Snapshot - Local Detections")

    cap.release()
    cv2.destroyAllWindows()

if __name__ == "__main__":
    main_loop()
