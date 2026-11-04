import { encodeFaceEmbeddingForStorage } from './faceIdentityMatcher';

/**
 * Safe LocalStorage utility that gracefully handles browser storage quotas
 * and prevents QuotaExceededError from crashing React components.
 */

export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error: any) {
    // If quota exceeded, attempt aggressive cleanup of large cached items
    if (
      error?.name === 'QuotaExceededError' ||
      error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error?.code === 22 ||
      error?.code === 1014
    ) {
      console.warn(`LocalStorage quota reached when saving "${key}". Running cleanup...`);
      try {
        // Preserve every incident row. If the incident key is over quota,
        // remove bulky evidence and embeddings before attempting the write;
        // never trim records by age or count.
        if (key === 'trinetra_incidents') {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              const compact = parsed.map((inc: any) => ({
                ...inc,
                identityEmbedding: undefined,
                identityEmbeddings: undefined,
                capturedFrameUrl: undefined,
                croppedFaceUrl: undefined,
                fullSceneFrameUrl: undefined,
                faces: Array.isArray(inc.faces)
                  ? inc.faces.map((face: any) => ({ ...face, embedding: undefined, croppedFaceUrl: undefined }))
                  : [],
                locationHistory: Array.isArray(inc.locationHistory)
                  ? inc.locationHistory.map((crumb: any) => ({ ...crumb, capturedFrameUrl: undefined }))
                  : [],
              }));
              localStorage.setItem(key, JSON.stringify(compact));
              return true;
            }
          } catch {
            // Fall through to the write error below; do not erase saved rows.
          }
        }

        localStorage.setItem(key, value);
        return true;
      } catch (retryError) {
        console.warn(`LocalStorage write for "${key}" skipped; no stored incident rows were deleted:`, retryError);
        return false;
      }
    }
    console.warn(`LocalStorage write error for "${key}":`, error);
    return false;
  }
}

export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`LocalStorage read error for "${key}":`, error);
    return null;
  }
}

/**
 * Sanitizes camera channel objects before storing them in LocalStorage.
 * Strips huge base64 image strings to avoid blowing up storage quota.
 */
export function sanitizeCamerasForStorage(cameras: any[]): string {
  try {
    const cleanCameras = cameras.map((cam) => {
      const copy = { ...cam };
      // If customImageSrc is a giant base64 string (>20KB), do not persist full raw blob
      if (copy.customImageSrc && copy.customImageSrc.length > 20000) {
        copy.customImageSrc = undefined;
      }
      if (copy.lastScanResult) {
        copy.lastScanResult = {
          ...copy.lastScanResult,
          capturedFrameUrl: sanitizeStoredImage(copy.lastScanResult.capturedFrameUrl),
          faces: Array.isArray(copy.lastScanResult.faces)
            ? copy.lastScanResult.faces.map((face: any) => ({ ...face, embedding: undefined, croppedFaceUrl: sanitizeStoredImage(face.croppedFaceUrl) }))
            : [],
        };
      }
      return copy;
    });
    return JSON.stringify(cleanCameras);
  } catch (e) {
    return '[]';
  }
}

/**
 * Sanitizes incidents before storing them in LocalStorage.
 * Keeps every incident row and removes heavy frame base64 images.
 */
export function sanitizeIncidentsForStorage(incidents: any[]): string {
  try {
    const clean = incidents.map((inc) => ({
      ...inc,
      identityEmbedding: encodeFaceEmbeddingForStorage(inc.identityEmbedding),
      identityEmbeddings: Array.isArray(inc.identityEmbeddings)
        ? inc.identityEmbeddings.slice(0, 2).map(encodeFaceEmbeddingForStorage).filter(Boolean)
        : undefined,
      capturedFrameUrl: sanitizeStoredImage(inc.capturedFrameUrl),
      croppedFaceUrl: sanitizeStoredImage(inc.croppedFaceUrl),
      // Full scene frames duplicate large base64 camera payloads in the incident log.
      fullSceneFrameUrl: undefined,
      faces: Array.isArray(inc.faces)
        ? inc.faces.map((face: any) => ({ ...face, embedding: undefined, croppedFaceUrl: sanitizeStoredImage(face.croppedFaceUrl) }))
        : [],
      locationHistory: Array.isArray(inc.locationHistory)
        ? inc.locationHistory.map((crumb: any) => ({ ...crumb, capturedFrameUrl: sanitizeStoredImage(crumb.capturedFrameUrl) }))
        : [],
    }));
    return JSON.stringify(clean);
  } catch (e) {
    return '[]';
  }
}

function sanitizeStoredImage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  if (/^data:image\/[^;]+;base64,/i.test(value) || value.length > 10000) return undefined;
  return value;
}

