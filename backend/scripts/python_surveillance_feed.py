"""
TRINETRA TACTICAL SURVEILLANCE & MULTI-FACE DETECTION ENGINE
Standalone Python RTSP & Camera Edge Transmitter

Features:
- Ultra-low latency multi-person face detection (OpenCV / Haar / DNN)
- Instant simultaneous bounding box generation for all faces entering range
- Automated high-speed snapshot relay to Trinetra AI Cloud Engine
- Multi-camera location trail and breadcrumb registration
- Works with RTSP CCTV streams, USB cameras, and IP security cams
"""

import cv2
import time
import requests
import base64
import sys
import argparse

def run_surveillance(
    server_url: str,
    camera_id: str,
    camera_zone: str,
    camera_source: str,
    scan_interval: float = 1.0,
    min_face_size: int = 24
):
    print("==================================================")
    print("  TRINETRA TACTICAL VISION - PYTHON EDGE CLIENT   ")
    print(f"  Target Server: {server_url}")
    print(f"  Camera ID:     {camera_id}")
    print(f"  Monitored Zone: {camera_zone}")
    print(f"  Source:        {camera_source}")
    print("==================================================")

    # Determine input source (Integer for webcam / USB, String for RTSP URL)
    source = int(camera_source) if camera_source.isdigit() else camera_source

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open camera stream: {camera_source}")
        sys.exit(1)

    # Optimize resolution for fast AI inference and optical frame processing
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    # Load high-speed multi-face cascade classifier
    cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
    face_cascade = cv2.CascadeClassifier(cascade_path)

    last_scan_time = 0.0
    frame_count = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("[WARNING] Frame capture dropped, attempting reconnection...")
                time.sleep(0.5)
                continue

            frame_count += 1
            h, w = frame.shape[:2]

            # Fast grayscale conversion for real-time edge face tracking
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.12,
                minNeighbors=4,
                minSize=(min_face_size, min_face_size)
            )

            current_time = time.time()
            num_faces = len(faces)

            # Draw HUD bounding boxes on all faces simultaneously in range
            for idx, (x, y, fw, fh) in enumerate(faces):
                cv2.rectangle(frame, (x, y), (x + fw, y + fh), (0, 0, 255), 2)
                cv2.putText(
                    frame,
                    f"TARGET P{idx+1} [RANGE ACTIVE]",
                    (x, max(20, y - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.45,
                    (0, 0, 255),
                    1
                )

            # Status Overlay Header
            cv2.putText(
                frame,
                f"TRINETRA TACTICAL HUD | ZONE: {camera_zone} | DETECTED: {num_faces} FACES",
                (15, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 0) if num_faces == 0 else (0, 0, 255),
                2
            )

            # Instantaneous dispatch to Trinetra AI when faces come into camera range
            if num_faces > 0 and (current_time - last_scan_time >= scan_interval):
                last_scan_time = current_time
                print(f"[TACTICAL TRIGGER] {num_faces} individual(s) entered range in {camera_zone}. Dispatching biometric scan...")

                # Encode frame to Base64
                _, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                b64_frame = base64.b64encode(buffer).decode('utf-8')

                try:
                    payload = {
                        "imageBase64": f"data:image/jpeg;base64,{b64_frame}",
                        "currentZone": camera_zone,
                        "feedMode": "ip_stream",
                        "securityLevel": "STANDARD"
                    }
                    resp = requests.post(
                        f"{server_url.rstrip('/')}/api/surveillance/analyze-frame",
                        json=payload,
                        timeout=3.5
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        verified = data.get("data", {}).get("detectedFaces", [])
                        threat = data.get("data", {}).get("overallThreatLevel", "NONE")
                        print(f"  --> MATCH RESULT: {len(verified)} Face(s) verified | Threat: {threat}")
                    else:
                        print(f"  [!] Server responded with status code: {resp.status_code}")
                except Exception as ex:
                    print(f"  [!] Dispatch failed: {ex}")

            # Display real-time security monitor window
            cv2.imshow("Trinetra Security Camera Monitor (Press Q to exit)", frame)
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("[TRINETRA] Camera stream terminated safely.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Trinetra High-Speed Security Camera Edge Streamer")
    parser.add_argument("--server", default="http://localhost:3000", help="Trinetra Server URL")
    parser.add_argument("--camera-id", default="cam-security-1", help="Camera Channel ID")
    parser.add_argument("--zone", default="Main Perimeter Gate", help="Security Zone Name")
    parser.add_argument("--source", default="0", help="Camera Source (0 for webcam, or RTSP URL)")
    parser.add_argument("--interval", type=float, default=1.0, help="Scan interval in seconds when targets in range")
    args = parser.parse_args()

    run_surveillance(
        server_url=args.server,
        camera_id=args.camera_id,
        camera_zone=args.zone,
        camera_source=args.source,
        scan_interval=args.interval
    )
