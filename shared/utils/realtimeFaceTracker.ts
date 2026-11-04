import { DetectedFace } from '../types';
import { FaceEmbedding, FaceIdentityMatcher } from './faceIdentityMatcher';
import { DailyPresenceManager } from './dailyPresence';
import { PersonIdentityManager } from './personIdentity';
import { PersonPresenceManager } from './personPresence';

type LocallyTrackedFace = DetectedFace & { localTrackId: string };
type IdentityObservation = { personId: string; similarity: number };
type TrackIdentityState = { personId: string; candidateHistory: IdentityObservation[]; provisional: boolean };

export interface LiveTrackResult {
  faces: LocallyTrackedFace[];
  hasSignificantMotion: boolean;
  motionScore: number;
}

export class RealtimeFaceTracker {
  private static nextCameraId: number = 1;
  private static readonly personIdentityManager = new PersonIdentityManager();
  private static readonly faceIdentityMatcher = new FaceIdentityMatcher();
  private static readonly personPresenceManager = new PersonPresenceManager();
  private static readonly dailyPresenceManager = new DailyPresenceManager();
  private readonly fallbackCameraId: string = `camera-${RealtimeFaceTracker.nextCameraId++}`;
  private cameraId: string | null = null;
  private zoneId: string | undefined;
  private nextLocalTrackId: number = 1;
  private localTracks: { id: string; box: DetectedFace['box_2d']; lastSeen: number }[] = [];
  private trackIdentityStates = new Map<string, TrackIdentityState>();
  private detector: any = null;
  private hasDetector: boolean = false;
  private prevCanvas: HTMLCanvasElement | null = null;
  private prevCtx: CanvasRenderingContext2D | null = null;
  private prevPixels: Uint8ClampedArray | null = null;
  private opticalCanvas: HTMLCanvasElement | null = null;
  private opticalCtx: CanvasRenderingContext2D | null = null;
  private lastTrackTime: number = 0;
  private motionTriggerCooldown: number = 0;

  public static getCurrentTrackingPresence() {
    return this.personPresenceManager.getAllCurrentPresences();
  }

  public static getTrackingLocationHistory(personId: string) {
    return this.personPresenceManager.getLocationHistory(personId);
  }

  public static getDailyTrackingPresence(date: string) {
    return this.dailyPresenceManager.getAllForDate(date);
  }

  public static exportTrackingSnapshot() {
    return {
      personPresence: this.personPresenceManager.exportSnapshot(),
      dailyPresence: this.dailyPresenceManager.exportSnapshot(),
    };
  }

  public static restoreTrackingSnapshot(snapshot: unknown): void {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
    const state = snapshot as { personPresence?: unknown; dailyPresence?: unknown };
    this.personPresenceManager.restoreSnapshot(state.personPresence);
    this.dailyPresenceManager.restoreSnapshot(state.dailyPresence);
  }

  public static recordPresence(personId: string, cameraId: string, zoneId: string, timestamp: string): void {
    this.personPresenceManager.updatePresence(personId, cameraId, zoneId, timestamp);
    this.dailyPresenceManager.update(personId, cameraId, timestamp);
  }

  public static registerFaceEmbedding(personId: string, embedding: FaceEmbedding): boolean {
    return this.faceIdentityMatcher.registerEmbedding(personId, embedding);
  }

  public static registerFaceEmbeddings(personId: string, embeddings: FaceEmbedding[]): boolean {
    return this.faceIdentityMatcher.registerEmbeddings(personId, embeddings);
  }

  public static unregisterFaceEmbedding(personId: string): void {
    this.faceIdentityMatcher.unregisterEmbedding(personId);
  }

  public static matchFaceEmbedding(embedding: FaceEmbedding) {
    return this.faceIdentityMatcher.match(embedding);
  }

  public static findBestFaceEmbeddingMatch(embedding: FaceEmbedding) {
    return this.faceIdentityMatcher.findBestMatch(embedding);
  }

  constructor() {
    if (typeof window !== 'undefined' && 'FaceDetector' in window) {
      try {
        this.detector = new (window as any).FaceDetector({
          fastMode: true,
          maxDetectedFaces: 10,
        });
        this.hasDetector = true;
      } catch (err) {
        this.hasDetector = false;
      }
    }
  }

  public async track(
    source: HTMLVideoElement | HTMLImageElement,
    verifiedFaces: DetectedFace[],
    location?: { cameraId: string; zoneId?: string }
  ): Promise<LiveTrackResult> {
    if (location?.cameraId) this.cameraId = location.cameraId;
    if (location) this.zoneId = location.zoneId;
    const now = Date.now();
    if (!source) {
      return {
        faces: this.assignLocalTrackIds(verifiedFaces, source, now),
        hasSignificantMotion: false,
        motionScore: 0,
      };
    }

    const isVideo = typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement;
    if (isVideo) {
      if (source.readyState < 2 || source.videoWidth === 0 || source.videoHeight === 0) {
        return {
          faces: this.assignLocalTrackIds(verifiedFaces, source, now),
          hasSignificantMotion: false,
          motionScore: 0,
        };
      }
    } else {
      const img = source as HTMLImageElement;
      if (!img.naturalWidth || img.naturalWidth === 0 || !img.naturalHeight || img.naturalHeight === 0) {
        return {
          faces: this.assignLocalTrackIds(verifiedFaces, source, now),
          hasSignificantMotion: false,
          motionScore: 0,
        };
      }
    }

    const vW = isVideo ? (source as HTMLVideoElement).videoWidth : (source as HTMLImageElement).naturalWidth;
    const vH = isVideo ? (source as HTMLVideoElement).videoHeight : (source as HTMLImageElement).naturalHeight;
    const targetAspect = 16 / 9;
    const srcAspect = vW / vH;
    let sx = 0;
    let sy = 0;
    let sw = vW;
    let sh = vH;

    if (srcAspect > targetAspect) {
      sw = Math.round(vH * targetAspect);
      sx = Math.round((vW - sw) / 2);
    } else if (srcAspect < targetAspect) {
      sh = Math.round(vW / targetAspect);
      sy = Math.round((vH - sh) / 2);
    }

    // 1. Motion detection via downsampled offscreen canvas
    const motionResult = this.detectMotion(source, sx, sy, sw, sh);

    // 2. High-speed local face detection:
    // Priority A: Native Chromium FaceDetector if supported
    let liveBoxes: [number, number, number, number][] = [];
    if (this.hasDetector && this.detector) {
      try {
        const nativeFaces = await this.detector.detect(source);
        if (Array.isArray(nativeFaces) && nativeFaces.length > 0) {
          liveBoxes = nativeFaces.map((f: any) => {
            const b = f.boundingBox;
            const x1 = Math.max(0, b.x);
            const y1 = Math.max(0, b.y);
            const x2 = Math.min(vW, b.x + b.width);
            const y2 = Math.min(vH, b.y + b.height);

            let normXmin = Math.round(((x1 - sx) / sw) * 1000);
            let normXmax = Math.round(((x2 - sx) / sw) * 1000);
            let normYmin = Math.round(((y1 - sy) / sh) * 1000);
            let normYmax = Math.round(((y2 - sy) / sh) * 1000);

            normXmin = Math.max(0, Math.min(1000, normXmin));
            normXmax = Math.max(0, Math.min(1000, normXmax));
            normYmin = Math.max(0, Math.min(1000, normYmin));
            normYmax = Math.max(0, Math.min(1000, normYmax));

            return [normYmin, normXmin, normYmax, normXmax] as [number, number, number, number];
          });
        }
      } catch (err) {
        // Fallback to optical
      }
    }

    // If the browser has no native face detector, use only confirmed server scan
    // boxes below. Skin-color clusters are not face detections and caused false
    // boxes on hands, necks, furniture, and other warm-colored areas.

    // 3. Merge live detections with Gemini verified metadata
    const fusedFaces = this.assignLocalTrackIds(
      this.fuseFaces(liveBoxes, verifiedFaces, motionResult),
      source,
      now
    );

    // Rapid motion trigger with 2.5-second cooldown for near-instant biometric activation
    const hasSignificantMotion = (motionResult.score > 0.04 || liveBoxes.length > 0) && now > this.motionTriggerCooldown;
    if (hasSignificantMotion) {
      this.motionTriggerCooldown = now + 2500;
    }

    this.lastTrackTime = now;
    return {
      faces: fusedFaces,
      hasSignificantMotion,
      motionScore: motionResult.score,
    };
  }

  /**
   * Ultra-fast client-side optical skin chrominance and facial proportion cluster detector.
   * Runs in ~3-4ms on any browser without any external model download or network requests.
   */
  private detectFacesOptical(
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number
  ): [number, number, number, number][] {
    if (!this.opticalCanvas) {
      this.opticalCanvas = document.createElement('canvas');
      this.opticalCanvas.width = 160;
      this.opticalCanvas.height = 90;
      this.opticalCtx = this.opticalCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (!this.opticalCtx) return [];

    const cW = 160;
    const cH = 90;
    this.opticalCtx.drawImage(source, sx, sy, sw, sh, 0, 0, cW, cH);
    const imgData = this.opticalCtx.getImageData(0, 0, cW, cH);
    const data = imgData.data;

    // 32 x 18 grid of 5x5 pixel blocks
    const gridW = 32;
    const gridH = 18;
    const blockHits = new Uint8Array(gridW * gridH);

    for (let gy = 0; gy < gridH; gy++) {
      const yOffset = gy * 5;
      for (let gx = 0; gx < gridW; gx++) {
        const xOffset = gx * 5;
        let skinCount = 0;

        for (let py = 0; py < 5; py++) {
          const rowIdx = (yOffset + py) * cW;
          for (let px = 0; px < 5; px++) {
            const i = (rowIdx + (xOffset + px)) * 4;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            // YCbCr skin chrominance model (universal across all human ethnicities)
            const y = 0.299 * r + 0.587 * g + 0.114 * b;
            const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
            const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;

            if (cb >= 77 && cb <= 130 && cr >= 130 && cr <= 175 && y >= 32 && y <= 245) {
              skinCount++;
            }
          }
        }
        blockHits[gy * gridW + gx] = skinCount;
      }
    }

    // Connected component clustering on the grid
    const visited = new Uint8Array(gridW * gridH);
    const boxes: [number, number, number, number][] = [];

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const idx = gy * gridW + gx;
        if (visited[idx] || blockHits[idx] < 6) continue;

        let minGx = gx;
        let maxGx = gx;
        let minGy = gy;
        let maxGy = gy;
        let clusterSkinScore = 0;

        const queue: [number, number][] = [[gx, gy]];
        visited[idx] = 1;

        while (queue.length > 0) {
          const [cx, cy] = queue.shift()!;
          const cidx = cy * gridW + cx;
          clusterSkinScore += blockHits[cidx];

          if (cx < minGx) minGx = cx;
          if (cx > maxGx) maxGx = cx;
          if (cy < minGy) minGy = cy;
          if (cy > maxGy) maxGy = cy;

          const neighbors: [number, number][] = [
            [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
            [cx + 1, cy + 1], [cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1],
          ];

          for (const [nx, ny] of neighbors) {
            if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
              const nidx = ny * gridW + nx;
              if (!visited[nidx] && blockHits[nidx] >= 6) {
                visited[nidx] = 1;
                queue.push([nx, ny]);
              }
            }
          }
        }

        const bw = maxGx - minGx + 1;
        const bh = maxGy - minGy + 1;

        // Face proportion filtering:
        // A human face cluster is between 2 and 22 blocks wide/tall with aspect ratio ~0.8 to 2.2
        const aspect = bh / Math.max(1, bw);
        if (bw >= 2 && bh >= 2 && bw <= 24 && bh <= 24 && aspect >= 0.75 && aspect <= 2.4 && clusterSkinScore >= 45) {
          // Add slight padding to capture full forehead to chin and cheek to cheek
          const padX = Math.round(bw * 0.12);
          const padY = Math.round(bh * 0.15);

          const finalMinGx = Math.max(0, minGx - padX);
          const finalMaxGx = Math.min(gridW - 1, maxGx + padX);
          const finalMinGy = Math.max(0, minGy - padY);
          const finalMaxGy = Math.min(gridH - 1, maxGy + padY);

          const xmin = Math.max(0, Math.min(1000, Math.round((finalMinGx / gridW) * 1000)));
          const xmax = Math.max(0, Math.min(1000, Math.round(((finalMaxGx + 1) / gridW) * 1000)));
          const ymin = Math.max(0, Math.min(1000, Math.round((finalMinGy / gridH) * 1000)));
          const ymax = Math.max(0, Math.min(1000, Math.round(((finalMaxGy + 1) / gridH) * 1000)));

          boxes.push([ymin, xmin, ymax, xmax]);
        }
      }
    }

    return boxes;
  }

  private detectMotion(
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number
  ): { score: number; motionBoxes: [number, number, number, number][] } {
    if (!this.prevCanvas) {
      this.prevCanvas = document.createElement('canvas');
      this.prevCanvas.width = 120;
      this.prevCanvas.height = 68;
      this.prevCtx = this.prevCanvas.getContext('2d', { willReadFrequently: true });
    }

    if (!this.prevCtx) {
      return { score: 0, motionBoxes: [] };
    }

    const cW = 120;
    const cH = 68;
    this.prevCtx.drawImage(source, sx, sy, sw, sh, 0, 0, cW, cH);
    const imgData = this.prevCtx.getImageData(0, 0, cW, cH);
    const data = imgData.data;

    if (!this.prevPixels || this.prevPixels.length !== data.length) {
      this.prevPixels = new Uint8ClampedArray(data);
      return { score: 0, motionBoxes: [] };
    }

    let diffPixels = 0;
    let minX = cW;
    let maxX = 0;
    let minY = cH;
    let maxY = 0;

    for (let i = 0; i < data.length; i += 4) {
      const rDiff = Math.abs(data[i] - this.prevPixels[i]);
      const gDiff = Math.abs(data[i + 1] - this.prevPixels[i + 1]);
      const bDiff = Math.abs(data[i + 2] - this.prevPixels[i + 2]);
      const totalDiff = (rDiff + gDiff + bDiff) / 3;

      if (totalDiff > 25) {
        diffPixels++;
        const pixelIdx = i / 4;
        const px = pixelIdx % cW;
        const py = Math.floor(pixelIdx / cW);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      this.prevPixels[i] = data[i];
      this.prevPixels[i + 1] = data[i + 1];
      this.prevPixels[i + 2] = data[i + 2];
    }

    const totalPixels = cW * cH;
    const score = diffPixels / totalPixels;

    const motionBoxes: [number, number, number, number][] = [];
    if (diffPixels > 25 && minX < maxX && minY < maxY) {
      const ymin = Math.max(0, Math.min(1000, Math.round((minY / cH) * 1000)));
      const xmin = Math.max(0, Math.min(1000, Math.round((minX / cW) * 1000)));
      const ymax = Math.max(0, Math.min(1000, Math.round((maxY / cH) * 1000)));
      const xmax = Math.max(0, Math.min(1000, Math.round((maxX / cW) * 1000)));
      const w = xmax - xmin;
      const h = Math.min(ymax - ymin, Math.round(w * 1.35));
      motionBoxes.push([ymin, xmin, Math.min(1000, ymin + h), xmax]);
    }

    return { score, motionBoxes };
  }

  private fuseFaces(
    liveBoxes: [number, number, number, number][],
    verifiedFaces: DetectedFace[],
    _motionResult: { score: number; motionBoxes: [number, number, number, number][] }
  ): DetectedFace[] {
    // If live optical boxes are detected at 60 FPS:
    if (liveBoxes.length > 0) {
      const usedVerified = new Set<number>();

      const liveFaces = liveBoxes.map((liveBox, i) => {
        const [ly1, lx1, ly2, lx2] = liveBox;
        const liveCenterX = (lx1 + lx2) / 2;
        const liveCenterY = (ly1 + ly2) / 2;

        // Try to match with nearest unclaimed verified face from Gemini
        let closestVerified: DetectedFace | null = null;
        let bestVIdx = -1;
        let minDist = 180; // keep native detections close to the verified subject box

        for (let vIdx = 0; vIdx < verifiedFaces.length; vIdx++) {
          if (usedVerified.has(vIdx)) continue;
          const v = verifiedFaces[vIdx];
          if (!v.box_2d) continue;
          const [vy1, vx1, vy2, vx2] = v.box_2d;
          const vCenterX = (vx1 + vx2) / 2;
          const vCenterY = (vy1 + vy2) / 2;
          const dist = Math.hypot(liveCenterX - vCenterX, liveCenterY - vCenterY);
          if (dist < minDist) {
            minDist = dist;
            closestVerified = v;
            bestVIdx = vIdx;
          }
        }

        if (closestVerified && bestVIdx !== -1) {
          usedVerified.add(bestVIdx);
          // Smooth real-time tracking: follow live face while preserving Gemini's identity and verification
          return {
            ...closestVerified,
            id: `${closestVerified.id}-live-${i}`,
            box_2d: liveBox,
          };
        }

        // Live face detected instantly (< 30ms) before biometric verification
        // returns. Keep this as identity-pending so a transient optical box is
        // never announced or displayed as an unauthorized threat.
        return {
          id: `live-target-${i}-${Math.round(liveCenterX / 50)}`,
          box_2d: liveBox,
          confidence: 90,
          status: 'UNKNOWN',
          matchedName: 'VERIFYING IDENTITY...',
          threatLevel: 'LOW',
          threatReason: 'A face was detected. Biometric verification is in progress.',
        };
      });

      // The browser detector is optimized for fast foreground tracking and
      // may miss smaller/background people found by the server scan. Keep all
      // server-confirmed faces that were not paired with a live box.
      const additionalVerifiedFaces = verifiedFaces.filter((_, index) => !usedVerified.has(index));
      return [...liveFaces, ...additionalVerifiedFaces];
    }

    // Fallback to verified faces if optical detector didn't catch the live frame
    if (verifiedFaces.length > 0) {
      return verifiedFaces;
    }

    return [];
  }

  private assignLocalTrackIds(
    faces: DetectedFace[],
    source: HTMLVideoElement | HTMLImageElement | null,
    now: number
  ): LocallyTrackedFace[] {
    if (!this.cameraId) {
      this.cameraId = `${source?.id || 'camera'}-${this.fallbackCameraId}`;
    }
    const localTrackPrefix = `${encodeURIComponent(this.cameraId)}-track-`;

    const expiredTracks = this.localTracks.filter((track) => now - track.lastSeen > 1500);
    this.localTracks = this.localTracks.filter((track) => now - track.lastSeen <= 1500);
    for (const track of expiredTracks) {
      this.trackIdentityStates.delete(this.getTrackIdentityKey(track.id));
    }
    const candidates: { faceIndex: number; trackIndex: number; distance: number }[] = [];

    faces.forEach((face, faceIndex) => {
      const [ymin, xmin, ymax, xmax] = face.box_2d;
      const centerX = (xmin + xmax) / 2;
      const centerY = (ymin + ymax) / 2;

      this.localTracks.forEach((track, trackIndex) => {
        const [trackYmin, trackXmin, trackYmax, trackXmax] = track.box;
        const trackCenterX = (trackXmin + trackXmax) / 2;
        const trackCenterY = (trackYmin + trackYmax) / 2;
        const distance = Math.hypot(centerX - trackCenterX, centerY - trackCenterY);
        if (distance <= 250) candidates.push({ faceIndex, trackIndex, distance });
      });
    });

    candidates.sort((a, b) => a.distance - b.distance);
    const faceTrackIds = new Map<number, string>();
    const matchedFaces = new Set<number>();
    const matchedTracks = new Set<number>();

    for (const candidate of candidates) {
      if (matchedFaces.has(candidate.faceIndex) || matchedTracks.has(candidate.trackIndex)) continue;
      const track = this.localTracks[candidate.trackIndex];
      const existingLocalTrackId = faces[candidate.faceIndex].localTrackId;
      const localTrackId = existingLocalTrackId?.startsWith(localTrackPrefix) ? existingLocalTrackId : track.id;
      faceTrackIds.set(candidate.faceIndex, localTrackId);
      track.id = localTrackId;
      track.lastSeen = now;
      track.box = faces[candidate.faceIndex].box_2d;
      matchedFaces.add(candidate.faceIndex);
      matchedTracks.add(candidate.trackIndex);
    }

    return faces.map((face, faceIndex) => {
      let localTrackId = face.localTrackId?.startsWith(localTrackPrefix)
        ? face.localTrackId
        : faceTrackIds.get(faceIndex);
      if (!localTrackId) {
        localTrackId = `${localTrackPrefix}${this.nextLocalTrackId++}`;
        this.localTracks.push({ id: localTrackId, box: face.box_2d, lastSeen: now });
      }
      const assignedPersonId = RealtimeFaceTracker.personIdentityManager.assignPersonId(this.cameraId!, localTrackId);
      const embedding = face.embedding;
      const identity = face.personId || assignedPersonId;
      const trackKey = this.getTrackIdentityKey(localTrackId);
      let identityState = this.trackIdentityStates.get(trackKey);
      if (!identityState) {
        identityState = { personId: identity, candidateHistory: [], provisional: !face.personId };
        this.trackIdentityStates.set(trackKey, identityState);
      } else if (face.personId && face.personId !== identityState.personId) {
        identityState.personId = face.personId;
        identityState.candidateHistory = [];
        identityState.provisional = false;
      }

      const validEmbedding = this.isValidEmbedding(embedding);
      const identityMatch = validEmbedding
        ? RealtimeFaceTracker.faceIdentityMatcher.match(embedding)
        : null;

      if (identityMatch?.personId === identityState.personId) {
        identityState.candidateHistory = [];
      } else if (identityMatch) {
        const previousCandidate = identityState.candidateHistory[identityState.candidateHistory.length - 1];
        if (previousCandidate?.personId !== identityMatch.personId) {
          identityState.candidateHistory = [];
        }
        identityState.candidateHistory.push(identityMatch);
        if (identityState.candidateHistory.length > 3) identityState.candidateHistory.shift();

        if (identityState.candidateHistory.length === 3) {
          if (identityState.provisional && identityState.personId !== identityMatch.personId) {
            RealtimeFaceTracker.personPresenceManager.mergePerson(identityState.personId, identityMatch.personId);
            RealtimeFaceTracker.dailyPresenceManager.mergePerson(identityState.personId, identityMatch.personId);
          }
          identityState.personId = identityMatch.personId;
          identityState.candidateHistory = [];
          identityState.provisional = false;
        }
      } else if (validEmbedding) {
        identityState.candidateHistory = [];
      }

      const personId = identityState.personId;

      if (personId !== assignedPersonId) {
        RealtimeFaceTracker.personIdentityManager.linkLocalTrack(this.cameraId!, localTrackId, personId);
      }
      if (validEmbedding && (!identityMatch || identityMatch.personId === personId)) {
        RealtimeFaceTracker.faceIdentityMatcher.registerAdaptiveEmbedding(personId, embedding);
      }

      return { ...face, localTrackId, personId };
    });
  }

  private getTrackIdentityKey(localTrackId: string): string {
    return JSON.stringify([this.cameraId, localTrackId]);
  }

  private isValidEmbedding(embedding: FaceEmbedding | undefined): boolean {
    if (!embedding || !Number.isSafeInteger(embedding.length) || embedding.length === 0) return false;

    let magnitude = 0;
    for (let index = 0; index < embedding.length; index++) {
      const value = embedding[index];
      if (!Number.isFinite(value)) return false;
      magnitude = Math.hypot(magnitude, value);
    }

    return Number.isFinite(magnitude) && magnitude > 0;
  }
}

export const realtimeFaceTracker = new RealtimeFaceTracker();
