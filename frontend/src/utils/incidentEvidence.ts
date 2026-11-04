import type { SecurityIncident } from '@shared/types';

const DATABASE_NAME = 'trinetra-evidence';
const DATABASE_VERSION = 1;
const STORE_NAME = 'incident-images';
const MIN_IMAGE_REFRESH_MS = 10_000;

export interface IncidentEvidenceImages {
  incidentId: string;
  capturedFrameUrl?: string;
  croppedFaceUrl?: string;
  fullSceneFrameUrl?: string;
  savedAt: number;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Browser image storage is unavailable.'));
  }
  if (databasePromise) return databasePromise;

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'incidentId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open incident image storage.'));
    request.onblocked = () => reject(new Error('Incident image storage is blocked by another browser tab.'));
  }).catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });

  return databasePromise;
}

export async function loadIncidentEvidence(incidentIds: string[]): Promise<Map<string, IncidentEvidenceImages>> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const wantedIds = new Set(incidentIds);
      const evidence = new Map<string, IncidentEvidenceImages>();
      for (const entry of request.result as IncidentEvidenceImages[]) {
        if (entry && wantedIds.has(entry.incidentId)) evidence.set(entry.incidentId, entry);
      }
      resolve(evidence);
    };
    request.onerror = () => reject(request.error || new Error('Could not load saved incident images.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not load saved incident images.'));
  });
}

/** Keep image evidence in IndexedDB; localStorage is intentionally kept text-only. */
export async function syncIncidentEvidence(incidents: SecurityIncident[]): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const existingEntries = request.result as IncidentEvidenceImages[];
      const existingById = new Map(existingEntries.map((entry) => [entry.incidentId, entry]));
      const retainedIds = new Set(incidents.map((incident) => incident.id));
      const now = Date.now();

      for (const incident of incidents) {
        const face = incident.faces?.[0];
        const images: IncidentEvidenceImages = {
          incidentId: incident.id,
          ...(incident.capturedFrameUrl || face?.croppedFaceUrl
            ? { capturedFrameUrl: incident.capturedFrameUrl || face?.croppedFaceUrl }
            : {}),
          ...(incident.croppedFaceUrl || face?.croppedFaceUrl
            ? { croppedFaceUrl: incident.croppedFaceUrl || face?.croppedFaceUrl }
            : {}),
          ...(incident.fullSceneFrameUrl ? { fullSceneFrameUrl: incident.fullSceneFrameUrl } : {}),
          savedAt: now,
        };
        if (!images.capturedFrameUrl && !images.croppedFaceUrl && !images.fullSceneFrameUrl) continue;

        const previous = existingById.get(incident.id);
        const imageChanged = !previous ||
          previous.capturedFrameUrl !== images.capturedFrameUrl ||
          previous.croppedFaceUrl !== images.croppedFaceUrl ||
          previous.fullSceneFrameUrl !== images.fullSceneFrameUrl;
        if (!previous || (imageChanged && now - previous.savedAt >= MIN_IMAGE_REFRESH_MS)) {
          store.put(images);
        }
      }

      for (const entry of existingEntries) {
        if (!retainedIds.has(entry.incidentId)) store.delete(entry.incidentId);
      }
    };

    request.onerror = () => reject(request.error || new Error('Could not save incident images.'));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Could not save incident images.'));
    transaction.onabort = () => reject(transaction.error || new Error('Could not save incident images.'));
  });
}
