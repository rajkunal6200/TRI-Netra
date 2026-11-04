import nodeUtil from 'node:util';
import { Buffer } from 'node:buffer';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Human, type FaceResult } from '@vladmandic/human';

export type FaceEmbeddingInput = string | Uint8Array;

export interface FaceEmbeddingDetection {
  embedding: number[];
  box: [number, number, number, number];
  confidence: number;
  occludedByHand?: boolean;
}

export interface FaceDetection {
  embedding?: number[];
  box: [number, number, number, number];
  identityBox?: [number, number, number, number];
  identityLandmarks?: [number, number][];
  confidence: number;
  occludedByHand?: boolean;
}

const runtimeUtil = nodeUtil as { isNullOrUndefined?: (value: unknown) => boolean };
runtimeUtil.isNullOrUndefined ??= (value) => value === null || value === undefined;

const FACE_EMBEDDING_DIMENSION = 1024;
const INFERENCE_CONFIG = {
  backend: 'tensorflow' as const,
  modelBasePath: pathToFileURL(`${resolve(process.env.HUMAN_MODEL_DIR || 'backend/models')}${sep}`).href,
  debug: false,
  // Let HandTrack run beside face/mesh analysis so a covered-face decision
  // does not wait for the biometric descriptor branch to finish first.
  async: true,
  filter: { enabled: false },
  gesture: { enabled: false },
  face: {
    enabled: true,
    detector: {
      enabled: true,
      modelPath: 'blazeface.json',
      maxDetected: 20,
      // Keep a moderate confidence floor to pick up smaller faces in groups;
      // identity decisions still use the stricter quality threshold below.
      minConfidence: 0.4,
      // BlazeFace defaults to 0.1, which suppresses adjacent people whenever
      // their face boxes overlap slightly. A higher IoU threshold preserves
      // nearby faces while still removing near-identical detector boxes.
      iouThreshold: 0.35,
      skipFrames: 0,
      skipTime: 0,
    },
    mesh: { enabled: true, modelPath: 'facemesh.json', skipFrames: 0, skipTime: 0 },
    attention: { enabled: false },
    iris: { enabled: false },
    description: {
      enabled: true,
      modelPath: 'faceres.json',
      skipFrames: 0,
      skipTime: 0,
    },
    emotion: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
    gear: { enabled: false },
  },
  body: { enabled: false },
  hand: {
    enabled: true,
    detector: { modelPath: 'handtrack.json' },
    skeleton: { modelPath: 'handlandmark-lite.json' },
    landmarks: true,
    minConfidence: 0.25,
    maxDetected: 4,
    skipFrames: 0,
    skipTime: 0,
  },
  object: { enabled: false },
  segmentation: { enabled: false },
};

let humanPromise: Promise<Human> | undefined;
let initializationFailed = false;
let inferenceQueue: Promise<void> = Promise.resolve();

function getHuman(): Promise<Human> {
  if (!humanPromise) {
    humanPromise = (async () => {
      await import('@tensorflow/tfjs-node');
      const human = new Human(INFERENCE_CONFIG);
      await human.tf.ready();
      await human.load();
      return human;
    })().catch((error: unknown) => {
      initializationFailed = true;
      console.warn('Face embedding model initialization failed:', error);
      throw error;
    });
  }

  return humanPromise;
}

function toImageBuffer(image: FaceEmbeddingInput): Buffer | undefined {
  if (typeof image !== 'string') {
    return image.byteLength > 0 ? Buffer.from(image) : undefined;
  }

  const base64 = image
    .trim()
    .replace(/^data:[^,]*;base64,/i, '')
    .replace(/\s/g, '');
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return undefined;

  const buffer = Buffer.from(base64, 'base64');
  return buffer.length > 0 ? buffer : undefined;
}

function toFaceDetection(face: FaceResult): FaceDetection | undefined {
  const embedding = face.embedding;
  const box = face.box;
  if (
    !box ||
    box.length !== 4 ||
    !box.every(Number.isFinite) ||
    !Number.isFinite(face.boxScore)
  ) {
    return undefined;
  }

  // BlazeFace deliberately pads its crop for mesh inference, so `box` can
  // include hair, shoulders, or nearby objects. Use the actual facial mesh
  // extent for occlusion checks to avoid treating a hand near the torso as
  // covering the face.
  const meshPoints = Array.isArray(face.mesh)
    ? face.mesh.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    : [];
  let identityBox: [number, number, number, number] | undefined;
  if (meshPoints.length >= 32) {
    const left = Math.max(box[0], Math.min(...meshPoints.map((point) => point[0])));
    const top = Math.max(box[1], Math.min(...meshPoints.map((point) => point[1])));
    const right = Math.min(box[0] + box[2], Math.max(...meshPoints.map((point) => point[0])));
    const bottom = Math.min(box[1] + box[3], Math.max(...meshPoints.map((point) => point[1])));
    if (right - left >= box[2] * 0.3 && bottom - top >= box[3] * 0.3) {
      identityBox = [left, top, right - left, bottom - top];
    }
  }
  const featureAnnotationNames = [
    'rightEyeUpper0', 'rightEyeLower0', 'rightEyeUpper1', 'rightEyeLower1',
    'rightEyeUpper2', 'rightEyeLower2', 'rightEyeLower3',
    'leftEyeUpper0', 'leftEyeLower0', 'leftEyeUpper1', 'leftEyeLower1',
    'leftEyeUpper2', 'leftEyeLower2', 'leftEyeLower3',
    'noseTip', 'noseBottom', 'noseRightCorner', 'noseLeftCorner',
    'lipsUpperOuter', 'lipsLowerOuter', 'lipsUpperInner', 'lipsLowerInner',
  ];
  let identityLandmarks = featureAnnotationNames.flatMap((name) => face.annotations?.[name] || [])
    .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [point[0], point[1]] as [number, number]);
  if (identityLandmarks.length < 8) {
    identityLandmarks = ['leftEye', 'rightEye', 'nose', 'mouth']
      .flatMap((name) => face.annotations?.[name] || [])
      .filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .map((point) => [point[0], point[1]] as [number, number]);
  }

  return {
    ...(embedding &&
    embedding.length === FACE_EMBEDDING_DIMENSION &&
    embedding.every(Number.isFinite)
      ? { embedding: [...embedding] }
      : {}),
    box: identityBox || [box[0], box[1], box[2], box[3]],
    ...(identityBox ? { identityBox } : {}),
    ...(identityLandmarks.length > 0 ? { identityLandmarks } : {}),
    // boxScore says that some face-like region was found. faceScore is the
    // landmark/mesh quality used by Human to judge whether that crop is a
    // usable face; relying on boxScore alone let heavily occluded crops pass.
    confidence: Number.isFinite(face.faceScore) ? face.faceScore : face.boxScore,
  };
}

type HandOcclusionCandidate = {
  box: [number, number, number, number];
  score: number;
  keypoints?: [number, number][];
  landmarkScore?: number;
};

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = (yi > point[1]) !== (yj > point[1]) &&
      point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function handLandmarkCoversFace(
  faceWidth: number,
  faceLandmarks: [number, number][],
  hand: HandOcclusionCandidate,
): boolean {
  const handPoints = hand.keypoints;
  if (!handPoints || handPoints.length < 8 || (hand.landmarkScore || 0) < 0.35) return false;

  const palmIndices = [0, 1, 5, 9, 13, 17];
  const palm = palmIndices.map((index) => handPoints[index]).filter((point): point is [number, number] => Boolean(point));
  const fingerChains = [
    [0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [0, 9, 10, 11, 12],
    [0, 13, 14, 15, 16], [0, 17, 18, 19, 20],
  ];
  const radius = Math.max(4, Math.min(14, faceWidth * 0.04));
  let coveredLandmarks = 0;

  for (const facialPoint of faceLandmarks) {
    const coveredByPalm = palm.length >= 4 && pointInPolygon(facialPoint, palm);
    const coveredByFinger = !coveredByPalm && fingerChains.some((chain) => {
      for (let index = 0; index < chain.length - 1; index++) {
        const start = handPoints[chain[index]];
        const end = handPoints[chain[index + 1]];
        if (start && end && distanceToSegment(facialPoint, start, end) <= radius) return true;
      }
      return false;
    });
    if (coveredByPalm || coveredByFinger) coveredLandmarks++;
  }

  return coveredLandmarks >= Math.max(2, Math.ceil(faceLandmarks.length * 0.015));
}

function handCoversFaceIdentityRegion(
  faceBox: [number, number, number, number],
  faceLandmarks: [number, number][] = [],
  handBoxes: HandOcclusionCandidate[],
): boolean {
  const [faceX, faceY, faceWidth, faceHeight] = faceBox;
  if (faceWidth <= 0 || faceHeight <= 0) return false;

  if (faceLandmarks.length >= 4 && handBoxes.some((hand) =>
    hand.score >= 0.25 && handLandmarkCoversFace(faceWidth, faceLandmarks, hand)
  )) return true;

  // Fallback when the hand model has no usable landmarks. Require a strong
  // hand score and substantial face-core overlap to reject edge-only boxes.
  const coreLeft = faceX + faceWidth * 0.18;
  const coreRight = faceX + faceWidth * 0.82;
  const coreTop = faceY + faceHeight * 0.20;
  const coreBottom = faceY + faceHeight * 0.94;
  const coreArea = (coreRight - coreLeft) * (coreBottom - coreTop);
  if (coreArea <= 0) return false;

  return handBoxes.some(({ box, score }) => {
    if (score < 0.5) return false;
    const [handX, handY, handWidth, handHeight] = box;
    const overlapWidth = Math.max(0, Math.min(coreRight, handX + handWidth) - Math.max(coreLeft, handX));
    const overlapHeight = Math.max(0, Math.min(coreBottom, handY + handHeight) - Math.max(coreTop, handY));
    return (overlapWidth * overlapHeight) / coreArea >= 0.2;
  });
}

async function inferFaceEmbeddings(imageBuffer: Buffer): Promise<{
  detectedFaceCount: number;
  detections: FaceDetection[];
}> {
  const inference = inferenceQueue.then(async () => {
    const human = await getHuman();
    const inputTensor = human.tf.tidy(() => {
      const decoded = human.tf.node.decodeImage(imageBuffer, 3);
      return human.tf.cast(human.tf.expandDims(decoded, 0), 'float32');
    });

    try {
      const result = await human.detect(inputTensor);
      const frameWidth = inputTensor.shape[2] || 0;
      const frameHeight = inputTensor.shape[1] || 0;
      const handBoxes = result.hand.flatMap((hand) => {
        const score = Number.isFinite(hand.score) ? hand.score : hand.boxScore;
        const hasPixelBox = Array.isArray(hand.box) && hand.box.length === 4 && hand.box.every(Number.isFinite) && hand.box[2] > 0 && hand.box[3] > 0;
        const hasRawBox = Array.isArray(hand.boxRaw) && hand.boxRaw.length === 4 && hand.boxRaw.every(Number.isFinite) && hand.boxRaw[2] > 0 && hand.boxRaw[3] > 0 && frameWidth > 0 && frameHeight > 0;
        // Landmark extents follow the fingers/palm and exclude the broad
        // detector padding around the arm. Prefer them when available.
        const handPoints = Array.isArray(hand.keypoints)
          ? hand.keypoints.filter((point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]))
          : [];
        if (handPoints.length >= 8) {
          const pointLeft = Math.min(...handPoints.map((point) => point[0]));
          const pointTop = Math.min(...handPoints.map((point) => point[1]));
          const pointRight = Math.max(...handPoints.map((point) => point[0]));
          const pointBottom = Math.max(...handPoints.map((point) => point[1]));
          const padX = Math.max(6, (pointRight - pointLeft) * 0.08);
          const padY = Math.max(6, (pointBottom - pointTop) * 0.08);
          const left = Math.max(0, pointLeft - padX);
          const top = Math.max(0, pointTop - padY);
          const right = Math.min(frameWidth, pointRight + padX);
          const bottom = Math.min(frameHeight, pointBottom + padY);
          if (right > left && bottom > top) {
            return [{
              box: [left, top, right - left, bottom - top] as [number, number, number, number],
              score,
              keypoints: handPoints.map((point) => [point[0], point[1]] as [number, number]),
              landmarkScore: hand.fingerScore,
            }];
          }
        }
        if (hasPixelBox) return [{ box: hand.box as [number, number, number, number], score }];
        // HandTrack may fail to refine landmarks on a partly hidden hand. Its
        // normalized raw detector box is still enough to block face matching.
        if (hasRawBox) {
          return [{ box: [hand.boxRaw[0] * frameWidth, hand.boxRaw[1] * frameHeight, hand.boxRaw[2] * frameWidth, hand.boxRaw[3] * frameHeight] as [number, number, number, number], score }];
        }
        return [];
      });
      return {
        detectedFaceCount: result.face.length,
        detections: result.face
          .map(toFaceDetection)
          .filter((face): face is FaceDetection => face !== undefined)
          .map((face) => ({
            ...face,
            occludedByHand: handCoversFaceIdentityRegion(face.identityBox || face.box, face.identityLandmarks, handBoxes),
          })),
      };
    } finally {
      human.tf.dispose(inputTensor);
    }
  });

  inferenceQueue = inference.then(() => undefined, () => undefined);
  return inference;
}

export async function generateFaceEmbeddings(
  image: FaceEmbeddingInput
): Promise<FaceEmbeddingDetection[]> {
  const detections = await generateFaceDetections(image);
  return detections
    .filter((face): face is FaceDetection & { embedding: number[] } => Boolean(face.embedding))
    .map(({ embedding, box, confidence }) => ({ embedding, box, confidence }));
}

export async function generateFaceDetections(
  image: FaceEmbeddingInput
): Promise<FaceDetection[]> {
  const imageBuffer = toImageBuffer(image);
  if (!imageBuffer) return [];

  try {
    return (await inferFaceEmbeddings(imageBuffer)).detections;
  } catch (error) {
    if (!initializationFailed) {
      console.warn('Face embedding inference failed:', error);
    }
    return [];
  }
}

export async function generateSingleFaceEmbedding(
  image: FaceEmbeddingInput
): Promise<FaceEmbeddingDetection> {
  const imageBuffer = toImageBuffer(image);
  if (!imageBuffer) throw new Error('The uploaded image is not a valid supported image.');

  const { detectedFaceCount, detections } = await inferFaceEmbeddings(imageBuffer);
  if (detectedFaceCount === 0) {
    throw new Error('No face was detected. Choose a clear photo with one visible face.');
  }
  if (detectedFaceCount > 1) {
    throw new Error(`Multiple faces detected (${detectedFaceCount}). Upload a photo containing exactly one face.`);
  }
  if (detections.length !== 1 || !detections[0].embedding) {
    throw new Error('A face was detected, but Human could not produce a usable 1024-value embedding.');
  }
  if (detections[0].occludedByHand) {
    throw new Error('The face is partly covered by a hand. Register a photo with the nose and mouth visible.');
  }

  return {
    embedding: detections[0].embedding,
    box: detections[0].box,
    confidence: detections[0].confidence,
    occludedByHand: detections[0].occludedByHand,
  };
}
