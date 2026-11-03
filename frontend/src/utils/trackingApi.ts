import type { DailyPresenceRecord } from './dailyPresence';
import type { PersonLocationChangeEvent, PersonPresence } from './personPresence';

export class TrackingApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'TrackingApiError';
  }
}

async function getJson(path: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new TrackingApiError('Unable to reach the tracking API.');
  }

  if (!response.ok) {
    let message = `Tracking API request failed (${response.status}).`;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
        message = body.error;
      }
    } catch {
      // Keep the status-based error when the server response is not JSON.
    }
    throw new TrackingApiError(message, response.status);
  }

  try {
    return await response.json();
  } catch {
    throw new TrackingApiError('Tracking API returned an invalid JSON response.', response.status);
  }
}

function expectArray<T>(value: unknown, endpoint: string): T[] {
  if (!Array.isArray(value)) {
    throw new TrackingApiError(`Tracking API returned an invalid response for ${endpoint}.`);
  }
  return value as T[];
}

function encodePersonId(personId: string): string {
  if (
    typeof personId !== 'string' ||
    personId.length === 0 ||
    personId.length > 128 ||
    personId.trim() !== personId ||
    /[\u0000-\u001f\u007f]/.test(personId)
  ) {
    throw new TypeError('personId must be a non-empty valid identifier.');
  }

  try {
    return encodeURIComponent(personId);
  } catch {
    throw new TypeError('personId must be a valid URL identifier.');
  }
}

function validateDate(date: string): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError('date must use YYYY-MM-DD format.');
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError('date must be a valid calendar date.');
  }

  return date;
}

export async function fetchCurrentPresence(): Promise<PersonPresence[]> {
  return expectArray<PersonPresence>(await getJson('/api/tracking/presence'), '/api/tracking/presence');
}

export async function fetchPersonPresenceHistory(personId: string): Promise<PersonLocationChangeEvent[]> {
  const encodedPersonId = encodePersonId(personId);
  const endpoint = `/api/tracking/presence/${encodedPersonId}`;
  return expectArray<PersonLocationChangeEvent>(await getJson(endpoint), endpoint);
}

export async function fetchDailyPresence(date: string): Promise<DailyPresenceRecord[]> {
  const validDate = validateDate(date);
  const endpoint = `/api/tracking/daily/${validDate}`;
  return expectArray<DailyPresenceRecord>(await getJson(endpoint), endpoint);
}