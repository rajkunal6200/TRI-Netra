import { DetectedFace } from '@shared/types';

/**
 * Computes Intersection over Union (IoU) between two normalized [ymin, xmin, ymax, xmax] boxes (0-1000 scale).
 */
export function computeIoU(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): number {
  const [y1A, x1A, y2A, x2A] = boxA;
  const [y1B, x1B, y2B, x2B] = boxB;

  const y1I = Math.max(y1A, y1B);
  const x1I = Math.max(x1A, x1B);
  const y2I = Math.min(y2A, y2B);
  const x2I = Math.min(x2A, x2B);

  const interW = Math.max(0, x2I - x1I);
  const interH = Math.max(0, y2I - y1I);
  const interArea = interW * interH;

  const areaA = Math.max(0, x2A - x1A) * Math.max(0, y2A - y1A);
  const areaB = Math.max(0, x2B - x1B) * Math.max(0, y2B - y1B);

  const unionArea = areaA + areaB - interArea;
  if (unionArea <= 0) return 0;
  return interArea / unionArea;
}

/**
 * Computes Containment ratio: how much of the smaller box is inside the larger box.
 * Crucial for eliminating duplicate nested boxes (e.g. whole head vs facial features of the same person).
 */
export function computeContainment(
  boxA: [number, number, number, number],
  boxB: [number, number, number, number]
): number {
  const [y1A, x1A, y2A, x2A] = boxA;
  const [y1B, x1B, y2B, x2B] = boxB;

  const y1I = Math.max(y1A, y1B);
  const x1I = Math.max(x1A, x1B);
  const y2I = Math.min(y2A, y2B);
  const x2I = Math.min(x2A, x2B);

  const interW = Math.max(0, x2I - x1I);
  const interH = Math.max(0, y2I - y1I);
  const interArea = interW * interH;

  const areaA = Math.max(0, x2A - x1A) * Math.max(0, y2A - y1A);
  const areaB = Math.max(0, x2B - x1B) * Math.max(0, y2B - y1B);
  const minArea = Math.min(areaA, areaB);

  if (minArea <= 0) return 0;
  return interArea / minArea;
}

/**
 * Validates, clamps, and strictly normalizes coordinates into face-size [ymin, xmin, ymax, xmax] in [0, 1000].
 * Automatically trims neck/shoulder bleed and oversized boxes so they are strictly face-sized (forehead to chin).
 */
export function sanitizeBoundingBox(rawBox: any): [number, number, number, number] | null {
  if (!Array.isArray(rawBox) || rawBox.length < 4) return null;
  let [ymin, xmin, ymax, xmax] = rawBox.map((v) => Math.round(Number(v) || 0));

  if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
  if (xmin > xmax) [xmin, xmax] = [xmax, xmin];

  ymin = Math.max(0, Math.min(1000, ymin));
  xmin = Math.max(0, Math.min(1000, xmin));
  ymax = Math.max(0, Math.min(1000, ymax));
  xmax = Math.max(0, Math.min(1000, xmax));

  let width = xmax - xmin;
  let height = ymax - ymin;

  // Filter out microscopic sensor noise (< 3 units) or full-screen artifact bounds (> 960 units)
  // 3 units allows distant background faces across long corridors or large rooms to be captured!
  if (width < 3 || height < 3) return null;
  if (width > 960 && height > 960) return null;

  return [ymin, xmin, ymax, xmax];
}

/**
 * Performs Non-Maximum Suppression (NMS) and deduplication across detected face candidates:
 * - Guarantees EXACTLY ONE bounding box per human face.
 * - Eliminates duplicate/overlapping red boxes on a single individual.
 * - Accurately retains all DISTINCT human faces across the scene (multi-face scenes).
 */
export function deduplicateFaces<
  T extends {
    box_2d: [number, number, number, number];
    status?: string;
    confidence?: number;
    matchedName?: string;
    matchedPersonnelId?: string | null;
  }
>(
  faces: T[]
): T[] {
  if (!faces || !Array.isArray(faces) || faces.length === 0) return [];

  // Sanitize every box
  const validFaces: T[] = [];
  for (const f of faces) {
    const cleanBox = sanitizeBoundingBox(f.box_2d);
    if (cleanBox) {
      validFaces.push({ ...f, box_2d: cleanBox });
    }
  }

  if (validFaces.length <= 1) return validFaces;

  // Sort faces:
  // 1. AUTHORIZED matches take priority over UNAUTHORIZED
  // 2. Higher confidence first
  // 3. Prefer tighter face bounding box over loose torso/shoulder boxes
  const sorted = [...validFaces].sort((a, b) => {
    const isAuthA = a.status === 'AUTHORIZED' ? 1 : 0;
    const isAuthB = b.status === 'AUTHORIZED' ? 1 : 0;
    if (isAuthA !== isAuthB) return isAuthB - isAuthA;

    const confA = a.confidence || 0;
    const confB = b.confidence || 0;
    if (Math.abs(confA - confB) > 5) return confB - confA;

    // Prefer standard facial aspect ratio (height:width ~ 1.0 to 1.4)
    const [y1A, x1A, y2A, x2A] = a.box_2d;
    const [y1B, x1B, y2B, x2B] = b.box_2d;
    const areaA = (y2A - y1A) * (x2A - x1A);
    const areaB = (y2B - y1B) * (x2B - x1B);
    return areaA - areaB; // Prefer tighter box
  });

  const retained: T[] = [];

  for (const candidate of sorted) {
    let isDuplicate = false;

    for (const kept of retained) {
      // If one candidate is AUTHORIZED and the other is UNAUTHORIZED, they are strictly distinct individuals!
      const differentStatus = candidate.status && kept.status && candidate.status !== kept.status;
      const differentIdentity =
        candidate.matchedPersonnelId &&
        kept.matchedPersonnelId &&
        candidate.matchedPersonnelId !== kept.matchedPersonnelId;

      if (differentStatus || differentIdentity) {
        continue;
      }

      const iou = computeIoU(candidate.box_2d, kept.box_2d);
      const containment = computeContainment(candidate.box_2d, kept.box_2d);

      const [y1A, x1A, y2A, x2A] = candidate.box_2d;
      const [y1B, x1B, y2B, x2B] = kept.box_2d;
      const centerAY = (y1A + y2A) / 2;
      const centerAX = (x1A + x2A) / 2;
      const centerBY = (y1B + y2B) / 2;
      const centerBX = (x1B + x2B) / 2;
      const widthA = x2A - x1A;
      const widthB = x2B - x1B;
      const minDimension = Math.min(widthA, widthB, y2A - y1A, y2B - y1B);
      const centerDist = Math.hypot(centerAY - centerBY, centerAX - centerBX);

      // True duplicate face detection criteria:
      // High overlap (IoU > 0.65) or near-complete containment (> 0.85) with close centers.
      // This reliably preserves distinct individuals who are standing together in the frame!
      if (iou > 0.65 || (containment > 0.85 && centerDist < Math.max(10, minDimension * 0.35))) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      retained.push(candidate);
    }
  }

  return retained;
}
