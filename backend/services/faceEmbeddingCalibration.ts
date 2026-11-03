import { readdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import * as tf from '@tensorflow/tfjs-node';
import { generateFaceEmbeddings } from './faceEmbeddingService';

export const FACE_IDENTITY_CALIBRATION_THRESHOLDS = [0.55, 0.6, 0.65, 0.7, 0.75, 0.8] as const;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const DUPLICATE_HASH_DISTANCE = 4;
const MIN_IDENTITIES_FOR_ADEQUACY = 10;
const MIN_IMAGES_PER_IDENTITY_FOR_ADEQUACY = 5;
const MIN_PAIRS_PER_CLASS_FOR_ADEQUACY = 100;

export interface CalibrationFaceImage {
  personId: string;
  filePath: string;
  embedding: number[];
  differenceHash: bigint;
}

export interface SkippedCalibrationImage {
  personId: string;
  filePath: string;
  reason: 'no-face-embedding' | 'multiple-faces' | 'decode-error' | 'duplicate-capture';
  duplicateOf?: string;
}

export interface CalibrationPair {
  firstFile: string;
  secondFile: string;
  label: 'same-person' | 'different-person';
  similarity: number;
}

export interface CalibrationThresholdResult {
  threshold: number;
  samePersonPairCount: number;
  differentPersonPairCount: number;
  trueMatches: number;
  missedSamePersonMatches: number;
  falseDifferentPersonMatches: number;
  trueRejections: number;
  samePersonMatchRate: number | null;
  differentPersonFalseMatchRate: number | null;
}

export interface SimilarityDistribution {
  count: number;
  minimum: number | null;
  maximum: number | null;
  median: number | null;
}

export interface FaceIdentityCalibrationReport {
  datasetDirectory: string;
  usableImageCount: number;
  identityCount: number;
  skippedImages: SkippedCalibrationImage[];
  pairs: CalibrationPair[];
  samePersonSimilarity: SimilarityDistribution;
  differentPersonSimilarity: SimilarityDistribution;
  thresholds: CalibrationThresholdResult[];
  sufficientForReliableCalibration: boolean;
  adequacyRequirements: {
    minimumIdentities: number;
    minimumImagesPerIdentity: number;
    minimumPairsPerClass: number;
  };
}

interface PendingImage {
  personId: string;
  filePath: string;
  embedding: number[];
  differenceHash: bigint;
}

function cosineSimilarity(first: ArrayLike<number>, second: ArrayLike<number>): number {
  if (first.length !== second.length || first.length === 0) return Number.NaN;

  let dot = 0;
  let firstMagnitude = 0;
  let secondMagnitude = 0;
  for (let index = 0; index < first.length; index++) {
    const firstValue = first[index];
    const secondValue = second[index];
    dot += firstValue * secondValue;
    firstMagnitude = Math.hypot(firstMagnitude, firstValue);
    secondMagnitude = Math.hypot(secondMagnitude, secondValue);
  }

  if (firstMagnitude === 0 || secondMagnitude === 0) return Number.NaN;
  return dot / (firstMagnitude * secondMagnitude);
}

function getDifferenceHash(imageBytes: Uint8Array): bigint {
  const decoded = tf.node.decodeImage(imageBytes, 3);
  const gray = decoded.mean(2);
  const resized = tf.image.resizeBilinear(tf.expandDims(gray, 0) as tf.Tensor3D, [8, 9], false);

  try {
    const values = resized.dataSync();
    let hash = 0n;
    for (let row = 0; row < 8; row++) {
      for (let column = 0; column < 8; column++) {
        const left = values[row * 9 + column];
        const right = values[row * 9 + column + 1];
        if (left > right) hash |= 1n << BigInt(row * 8 + column);
      }
    }
    return hash;
  } finally {
    tf.dispose([decoded, gray, resized]);
  }
}

function hashDistance(first: bigint, second: bigint): number {
  let bits = first ^ second;
  let distance = 0;
  while (bits !== 0n) {
    distance++;
    bits &= bits - 1n;
  }
  return distance;
}

function getDistribution(values: number[]): SimilarityDistribution {
  if (values.length === 0) return { count: 0, minimum: null, maximum: null, median: null };

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    count: sorted.length,
    minimum: sorted[0],
    maximum: sorted[sorted.length - 1],
    median,
  };
}

function evaluateThreshold(pairs: CalibrationPair[], threshold: number): CalibrationThresholdResult {
  const samePersonPairs = pairs.filter((pair) => pair.label === 'same-person');
  const differentPersonPairs = pairs.filter((pair) => pair.label === 'different-person');
  const trueMatches = samePersonPairs.filter((pair) => pair.similarity >= threshold).length;
  const falseDifferentPersonMatches = differentPersonPairs.filter((pair) => pair.similarity >= threshold).length;

  return {
    threshold,
    samePersonPairCount: samePersonPairs.length,
    differentPersonPairCount: differentPersonPairs.length,
    trueMatches,
    missedSamePersonMatches: samePersonPairs.length - trueMatches,
    falseDifferentPersonMatches,
    trueRejections: differentPersonPairs.length - falseDifferentPersonMatches,
    samePersonMatchRate: samePersonPairs.length ? trueMatches / samePersonPairs.length : null,
    differentPersonFalseMatchRate: differentPersonPairs.length
      ? falseDifferentPersonMatches / differentPersonPairs.length
      : null,
  };
}

export async function calibrateFaceIdentity(
  datasetDirectory: string
): Promise<FaceIdentityCalibrationReport> {
  const root = resolve(datasetDirectory);
  const personDirectories = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const skippedImages: SkippedCalibrationImage[] = [];
  const pendingImages: PendingImage[] = [];

  for (const personDirectory of personDirectories) {
    const personId = personDirectory.name;
    const directoryPath = join(root, personId);
    const imageFiles = (await readdir(directoryPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(directoryPath, entry.name))
      .sort((a, b) => a.localeCompare(b));

    for (const filePath of imageFiles) {
      let imageBytes: Buffer;
      let differenceHash: bigint;
      try {
        imageBytes = await readFile(filePath);
        differenceHash = getDifferenceHash(imageBytes);
      } catch {
        skippedImages.push({ personId, filePath, reason: 'decode-error' });
        continue;
      }

      let detections;
      try {
        detections = await generateFaceEmbeddings(imageBytes);
      } catch {
        detections = [];
      }

      if (detections.length === 0) {
        skippedImages.push({ personId, filePath, reason: 'no-face-embedding' });
      } else if (detections.length > 1) {
        skippedImages.push({ personId, filePath, reason: 'multiple-faces' });
      } else {
        pendingImages.push({ personId, filePath, embedding: detections[0].embedding, differenceHash });
      }
    }
  }

  const duplicateIndices = new Map<number, string>();
  for (let firstIndex = 0; firstIndex < pendingImages.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < pendingImages.length; secondIndex++) {
      const first = pendingImages[firstIndex];
      const second = pendingImages[secondIndex];
      if (hashDistance(first.differenceHash, second.differenceHash) > DUPLICATE_HASH_DISTANCE) continue;

      if (first.personId === second.personId) {
        duplicateIndices.set(secondIndex, first.filePath);
      } else {
        duplicateIndices.set(firstIndex, second.filePath);
        duplicateIndices.set(secondIndex, first.filePath);
      }
    }
  }

  const usableImages = pendingImages.filter((image, index) => {
    const duplicateOf = duplicateIndices.get(index);
    if (!duplicateOf) return true;
    skippedImages.push({
      personId: image.personId,
      filePath: image.filePath,
      reason: 'duplicate-capture',
      duplicateOf,
    });
    return false;
  });

  const pairs: CalibrationPair[] = [];
  for (let firstIndex = 0; firstIndex < usableImages.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < usableImages.length; secondIndex++) {
      const first = usableImages[firstIndex];
      const second = usableImages[secondIndex];
      pairs.push({
        firstFile: first.filePath,
        secondFile: second.filePath,
        label: first.personId === second.personId ? 'same-person' : 'different-person',
        similarity: cosineSimilarity(first.embedding, second.embedding),
      });
    }
  }

  const samePersonSimilarities = pairs
    .filter((pair) => pair.label === 'same-person')
    .map((pair) => pair.similarity);
  const differentPersonSimilarities = pairs
    .filter((pair) => pair.label === 'different-person')
    .map((pair) => pair.similarity);
  const imageCounts = new Map<string, number>();
  for (const image of usableImages) {
    imageCounts.set(image.personId, (imageCounts.get(image.personId) ?? 0) + 1);
  }
  const identityCount = imageCounts.size;
  const allIdentitiesHaveEnoughImages = [...imageCounts.values()]
    .every((count) => count >= MIN_IMAGES_PER_IDENTITY_FOR_ADEQUACY);

  return {
    datasetDirectory: root,
    usableImageCount: usableImages.length,
    identityCount,
    skippedImages,
    pairs,
    samePersonSimilarity: getDistribution(samePersonSimilarities),
    differentPersonSimilarity: getDistribution(differentPersonSimilarities),
    thresholds: FACE_IDENTITY_CALIBRATION_THRESHOLDS.map((threshold) => evaluateThreshold(pairs, threshold)),
    sufficientForReliableCalibration:
      identityCount >= MIN_IDENTITIES_FOR_ADEQUACY &&
      allIdentitiesHaveEnoughImages &&
      samePersonSimilarities.length >= MIN_PAIRS_PER_CLASS_FOR_ADEQUACY &&
      differentPersonSimilarities.length >= MIN_PAIRS_PER_CLASS_FOR_ADEQUACY,
    adequacyRequirements: {
      minimumIdentities: MIN_IDENTITIES_FOR_ADEQUACY,
      minimumImagesPerIdentity: MIN_IMAGES_PER_IDENTITY_FOR_ADEQUACY,
      minimumPairsPerClass: MIN_PAIRS_PER_CLASS_FOR_ADEQUACY,
    },
  };
}

export function formatFaceIdentityCalibrationReport(report: FaceIdentityCalibrationReport): string {
  return JSON.stringify({
    ...report,
    pairs: undefined,
  }, null, 2);
}