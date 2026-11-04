export type FaceEmbedding = ArrayLike<number>;

export interface FaceIdentityMatch {
  personId: string;
  similarity: number;
}

export const FACE_IDENTITY_AUTHORIZATION_THRESHOLD = 0.7;
// Anything close to a registered profile remains a manual review case rather
// than being treated as an unauthorized person on a single imperfect frame.
export const FACE_IDENTITY_REVIEW_THRESHOLD = 0.4;

/** Compare two Human FaceRes descriptors on the same scale used for directory matches. */
export function faceEmbeddingSimilarity(left: FaceEmbedding | null | undefined, right: FaceEmbedding | null | undefined): number | null {
  if (!left || !right || left.length === 0 || left.length !== right.length) return null;

  let squaredDistance = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return null;
    const difference = leftValue - rightValue;
    squaredDistance += difference * difference;
    leftMagnitude = Math.hypot(leftMagnitude, leftValue);
    rightMagnitude = Math.hypot(rightMagnitude, rightValue);
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return null;

  // Matches Human's FaceRes defaults: Euclidean distance, multiplier 25,
  // similarity normalized from [0.2, 0.8] into [0, 1].
  const distance = Math.round(100 * 25 * squaredDistance) / 100;
  const normalized = (1 - Math.sqrt(distance) / 100 - 0.2) / (0.8 - 0.2);
  return Math.round(100 * Math.max(0, Math.min(1, normalized))) / 100;
}

export function encodeFaceEmbeddingForStorage(embedding: FaceEmbedding | null | undefined): string | undefined {
  if (!embedding || embedding.length === 0) return undefined;
  const floats = new Float32Array(embedding.length);
  for (let index = 0; index < embedding.length; index++) {
    if (!Number.isFinite(embedding[index])) return undefined;
    floats[index] = embedding[index];
  }
  const bytes = new Uint8Array(floats.buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  try {
    return `f32:${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

export function decodeFaceEmbedding(value: unknown): number[] | undefined {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(Number.isFinite) ? [...value] : undefined;
  }
  if (typeof value !== 'string' || !value.startsWith('f32:')) return undefined;

  try {
    const binary = atob(value.slice(4));
    if (!binary || binary.length % Float32Array.BYTES_PER_ELEMENT !== 0) return undefined;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const floats = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
    const embedding = Array.from(floats);
    return embedding.every(Number.isFinite) ? embedding : undefined;
  } catch {
    return undefined;
  }
}

export class FaceIdentityMatcher {
  private readonly referenceEmbeddings = new Map<string, number[][]>();

  // FaceRes similarities use Human's Euclidean-distance scale. Use a stricter
  // threshold for access decisions to reduce false acceptance of lookalikes.
  constructor(private readonly similarityThreshold: number = FACE_IDENTITY_AUTHORIZATION_THRESHOLD) {
    if (!Number.isFinite(similarityThreshold) || similarityThreshold < -1 || similarityThreshold > 1) {
      throw new RangeError('Similarity threshold must be between -1 and 1.');
    }
  }

  public registerEmbedding(personId: string, embedding: FaceEmbedding | null | undefined): boolean {
    const descriptor = this.validate(embedding);
    if (!personId || !descriptor) return false;

    this.referenceEmbeddings.set(personId, [descriptor]);
    return true;
  }

  public registerEmbeddings(personId: string, embeddings: FaceEmbedding[] | null | undefined): boolean {
    if (!personId || !Array.isArray(embeddings) || embeddings.length < 1 || embeddings.length > 5) return false;
    const descriptors = embeddings.map((embedding) => this.validate(embedding));
    if (descriptors.some((descriptor) => !descriptor)) return false;
    const validDescriptors = descriptors as number[][];
    if (validDescriptors.some((descriptor) => descriptor.length !== validDescriptors[0].length)) return false;
    this.referenceEmbeddings.set(personId, validDescriptors);
    return true;
  }

  /** Add provisional identities without replacing a registered multi-photo gallery. */
  public registerAdaptiveEmbedding(personId: string, embedding: FaceEmbedding | null | undefined): boolean {
    if (this.referenceEmbeddings.has(personId)) return true;
    return this.registerEmbedding(personId, embedding);
  }

  public unregisterEmbedding(personId: string): void {
    this.referenceEmbeddings.delete(personId);
  }

  public match(embedding: FaceEmbedding | null | undefined): FaceIdentityMatch | null {
    const bestMatch = this.findBestMatch(embedding);
    return bestMatch && bestMatch.similarity >= this.similarityThreshold ? bestMatch : null;
  }

  /** Return the nearest enrolled identity even when it is below the auth threshold. */
  public findBestMatch(embedding: FaceEmbedding | null | undefined): FaceIdentityMatch | null {
    const descriptor = this.validate(embedding);
    if (!descriptor) return null;

    let bestMatch: FaceIdentityMatch | null = null;
    for (const [personId, references] of this.referenceEmbeddings) {
      for (const reference of references) {
        if (reference.length !== descriptor.length) continue;

        const similarity = faceEmbeddingSimilarity(descriptor, reference);
        if (similarity !== null && (!bestMatch || similarity > bestMatch.similarity)) {
          bestMatch = { personId, similarity };
        }
      }
    }

    return bestMatch;
  }

  private validate(embedding: FaceEmbedding | null | undefined): number[] | null {
    if (!embedding || !Number.isSafeInteger(embedding.length) || embedding.length === 0) return null;

    const values: number[] = [];
    let magnitude = 0;
    for (let index = 0; index < embedding.length; index++) {
      const value = embedding[index];
      if (!Number.isFinite(value)) return null;
      values.push(value);
      magnitude = Math.hypot(magnitude, value);
    }

    return Number.isFinite(magnitude) && magnitude > 0 ? values : null;
  }
}
