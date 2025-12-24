import argparse
import time
import cv2
import math
import numpy as np
from pathlib import Path

import backend.old_ai_model.video_main as video_main


def soft_nms(boxes, scores, iou_thresh=0.3, sigma=0.5, score_thresh=0.001, method='gaussian'):
    """
    boxes: list of (xmin,ymin,xmax,ymax)
    scores: list of floats
    Returns: list of kept indices (original indices)
    method: 'linear', 'gaussian', or 'hard' (classic NMS)
    """
    if len(boxes) == 0:
        return []

    boxes = np.array(boxes, dtype=float)
    scores = np.array(scores, dtype=float)
    idxs = list(range(len(scores)))
    keep = []

    while idxs:
        # pick index with highest score among remaining
        max_idx = max(idxs, key=lambda i: float(scores[i]))
        idxs.remove(max_idx)
        keep.append(max_idx)

        rem = []
        for j in idxs:
            # compute IoU between max_idx and j
            xx1 = max(boxes[max_idx, 0], boxes[j, 0])
            yy1 = max(boxes[max_idx, 1], boxes[j, 1])
            xx2 = min(boxes[max_idx, 2], boxes[j, 2])
            yy2 = min(boxes[max_idx, 3], boxes[j, 3])
            w = max(0., xx2 - xx1)
            h = max(0., yy2 - yy1)
            inter = w * h
            area1 = max(0., boxes[max_idx, 2] - boxes[max_idx, 0]) * max(0., boxes[max_idx, 3] - boxes[max_idx, 1])
            area2 = max(0., boxes[j, 2] - boxes[j, 0]) * max(0., boxes[j, 3] - boxes[j, 1])
            union = area1 + area2 - inter
            iou_val = inter / union if union > 0 else 0.0

            if method == 'linear':
                if iou_val > iou_thresh:
                    scores[j] = scores[j] * (1 - iou_val)
            elif method == 'gaussian':
                scores[j] = scores[j] * np.exp(- (iou_val * iou_val) / sigma)
            else:  # 'hard' (classic)
                if iou_val > iou_thresh:
                    scores[j] = 0.0

            if scores[j] > score_thresh:
                rem.append(j)
        idxs = rem

    return keep


def iou(boxA, boxB):
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[2], boxB[2])
    yB = min(boxA[3], boxB[3])
    interW = max(0, xB - xA)
    interH = max(0, yB - yA)
    inter = interW * interH
    areaA = max(0, boxA[2] - boxA[0]) * max(0, boxA[3] - boxA[1])
    areaB = max(0, boxB[2] - boxB[0]) * max(0, boxB[3] - boxB[1])
    union = areaA + areaB - inter
    return inter / union if union > 0 else 0.0


def watershed_split_eggs(crop, min_area=100):
    """
    crop: BGR numpy image of the carton region.
    returns: list of boxes in crop coords: (x1,y1,x2,y2)
    """
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, thresh = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    opening = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=2)
    sure_bg = cv2.dilate(opening, kernel, iterations=3)

    dist_transform = cv2.distanceTransform(opening, cv2.DIST_L2, 5)
    _, sure_fg = cv2.threshold(dist_transform, 0.4 * dist_transform.max(), 255, 0)
    sure_fg = np.uint8(sure_fg)
    unknown = cv2.subtract(sure_bg, sure_fg)

    _, markers = cv2.connectedComponents(sure_fg)
    markers = markers + 1
    markers[unknown == 255] = 0

    # Watershed expects 3-channel image
    markers = cv2.watershed(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB), markers)
    boxes = []
    for m in np.unique(markers):
        if m <= 1:
            continue
        mask = np.uint8(markers == m)
        cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        c = max(cnts, key=cv2.contourArea)
        area = cv2.contourArea(c)
        if area < min_area:
            continue
        x, y, w, h = cv2.boundingRect(c)
        boxes.append((x, y, x + w, y + h))
    return boxes


def estimate_eggs_from_carton(frame, carton_box, debug=False):
    """
    Given the full frame and a carton bounding box (xmin, ymin, xmax, ymax),
    attempt to find individual eggs inside via contour/circularity filtering + watershed fallback.
    Returns list of boxes in full-frame coords: [(xmin,ymin,xmax,ymax), ...]
    """
    xmin, ymin, xmax, ymax = carton_box
    xmin, ymin = max(0, int(xmin)), max(0, int(ymin))
    xmax, ymax = min(frame.shape[1], int(xmax)), min(frame.shape[0], int(ymax))
    crop = frame[ymin:ymax, xmin:xmax].copy()
    if crop.size == 0:
        return []

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (7, 7), 0)
    th = cv2.adaptiveThreshold(blur, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                               cv2.THRESH_BINARY_INV, 11, 2)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    closed = cv2.morphologyEx(th, cv2.MORPH_CLOSE, kernel, iterations=2)

    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    boxes = []
    area_total = max(1, crop.shape[0] * crop.shape[1])
    for c in contours:
        area = cv2.contourArea(c)
        if area < 0.0008 * area_total:
            continue
        perimeter = cv2.arcLength(c, True)
        if perimeter == 0:
            continue
        circularity = 4 * math.pi * (area / (perimeter * perimeter))
        if circularity < 0.4 or area > 0.2 * area_total:
            continue
        x, y, w, h = cv2.boundingRect(c)
        pad_w = int(w * 0.12)
        pad_h = int(h * 0.12)
        bx1 = max(0, x - pad_w)
        by1 = max(0, y - pad_h)
        bx2 = min(crop.shape[1], x + w + pad_w)
        by2 = min(crop.shape[0], y + h + pad_h)
        boxes.append((xmin + bx1, ymin + by1, xmin + bx2, ymin + by2))

    # If contour method found nothing, try watershed splitting
    if not boxes:
        ws_boxes = watershed_split_eggs(crop, min_area=80)
        for (x1, y1, x2, y2) in ws_boxes:
            boxes.append((xmin + x1, ymin + y1, xmin + x2, ymin + y2))

    if debug and boxes:
        dbg = crop.copy()
        for b in boxes:
            x1, y1, x2, y2 = int(b[0] - xmin), int(b[1] - ymin), int(b[2] - xmin), int(b[3] - ymin)
            cv2.rectangle(dbg, (x1, y1), (x2, y2), (255, 0, 0), 2)
        cv2.imshow("carton_debug", dbg)
        cv2.waitKey(0)
        cv2.destroyWindow("carton_debug")

    return boxes


def classify_and_count(image_path, model_id=None, conf_thresh=None, show=False, save=False):
    img_path = Path(image_path)
    if not img_path.exists():
        raise FileNotFoundError(f"Image not found: {img_path}")

    frame = cv2.imread(str(img_path))
    if frame is None:
        raise RuntimeError(f"Failed to load image: {img_path}")

    model_id = model_id or getattr(video_main, "MODEL_ID", None)
    conf_thresh = conf_thresh if conf_thresh is not None else getattr(video_main, "CONF_THRESHOLD", 0.5)

    detections, annotated = video_main.run_local_rbf_inference(frame, model_id, conf_thresh)
    if annotated is None:
        annotated = frame.copy()

    print("Raw detections:")
    for d in detections:
        print(d)

    # Try Roboflow helper if available
    try:
        extras = video_main.postprocess_carton_detections(frame, detections, annotated=annotated)
        if extras:
            detections.extend(extras)
    except Exception:
        pass

    egg_like = [det for det in detections if 'egg' in det.get('label', '').lower() and 'carton' not in det.get('label', '').lower()]
    carton_like = [det for det in detections if 'carton' in det.get('label', '').lower() or 'box' in det.get('label', '').lower()]

    if (len(egg_like) <= 1) and carton_like:
        print("No/too-few egg detections but carton found — running carton-based estimation...")
        for cdet in carton_like:
            cbox = cdet.get('box')
            if cbox is None:
                continue
            extra_boxes = estimate_eggs_from_carton(frame, cbox, debug=False)
            for b in extra_boxes:
                detections.append({'label': 'egg (est)', 'score': 0.5, 'box': b})

    # Group by label then apply Soft-NMS per class
    by_label = {}
    for det in detections:
        lbl = det.get('label', 'N/A')
        box = det.get('box')
        score = float(det.get('score', 0.0))
        if box is None:
            continue
        by_label.setdefault(lbl, []).append((box, score))

    counts = {}
    final_detections = []
    for lbl, items in by_label.items():
        boxes = [tuple(map(float, b)) for b, s in items]
        scores = [s for b, s in items]
        keep_idx = soft_nms(boxes, scores, iou_thresh=0.3, sigma=0.5, score_thresh=0.01, method='gaussian')
        counts[lbl] = len(keep_idx)
        for i in keep_idx:
            final_detections.append({'label': lbl, 'score': scores[i], 'box': boxes[i]})

    # Draw final detections
    colors = {'egg (seg)': (255, 128, 0), 'egg (est)': (0, 128, 255)}
    default_color = (0, 255, 0)
    for det in final_detections:
        xmin, ymin, xmax, ymax = map(int, det['box'])
        color = colors.get(det['label'], default_color)
        cv2.rectangle(annotated, (xmin, ymin), (xmax, ymax), color, 2)
        txt = f"{det['label']} {det.get('score', 0):.2f}"
        (tx, ty), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(annotated, (xmin, ymin - ty - 6), (xmin + tx + 6, ymin), color, -1)
        cv2.putText(annotated, txt, (xmin + 3, ymin - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)

    print("Counts:")
    for lbl, cnt in counts.items():
        print(f" - {lbl}: {cnt}")

    ts = int(time.time())
    out_name = Path("outputs")
    out_name.mkdir(exist_ok=True)
    out_file = out_name / f"annotated_{ts}.jpg"
    if save:
        cv2.imwrite(str(out_file), annotated)
        print(f"Saved annotated image to {out_file}")

    if show:
        cv2.imshow("Annotated", annotated)
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    return counts, final_detections, annotated


def video_main():
    p = argparse.ArgumentParser(description="Classify and count objects in an image (uses local Roboflow client)")
    p.add_argument("image", help="Path to input image")
    p.add_argument("--model", help="Roboflow model id (optional)")
    p.add_argument("--conf", type=float, help="Confidence threshold")
    p.add_argument("--show", action="store_true", help="Show annotated image")
    p.add_argument("--save", action="store_true", help="Save annotated image to outputs/")
    args = p.parse_args()

    classify_and_count(args.image, model_id=args.model, conf_thresh=args.conf, show=args.show, save=args.save)


if __name__ == "__main__":
    video_main()
