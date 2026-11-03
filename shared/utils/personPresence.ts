import { safeGetItem, safeSetItem } from './storage';

export interface PersonPresence {
  personId: string;
  cameraId: string;
  zoneId?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  previousCameraId?: string;
  previousZoneId?: string;
}

export interface PersonLocationChangeEvent {
  personId: string;
  previousCameraId: string;
  previousZoneId?: string;
  previousSeenAt?: string;
  cameraId: string;
  zoneId?: string;
  timestamp: string;
  concurrent?: boolean;
}

export interface PersonPresenceSnapshot {
  presences: PersonPresence[];
  locationHistory: Record<string, PersonLocationChangeEvent[]>;
}

const PERSON_PRESENCE_STORAGE_KEY = 'trinetra_person_presence';
const ACTIVE_PRESENCE_WINDOW_MS = 8_000;
const CONCURRENT_SIGHTING_WINDOW_MS = 2_500;

export class PersonPresenceManager {
  // Store one record per person and camera. A person can be visible in more
  // than one camera at the same time, so a person-only key loses valid feeds.
  private readonly presences = new Map<string, PersonPresence>();
  private readonly locationHistory = new Map<string, PersonLocationChangeEvent[]>();
  private lastPersistAt = 0;

  constructor() {
    if (typeof window === 'undefined') return;

    const saved = safeGetItem(PERSON_PRESENCE_STORAGE_KEY);
    if (!saved) return;

    try {
      this.restoreSnapshot(JSON.parse(saved));
    } catch {
      // Ignore invalid saved presence data and start with an empty history.
    }
  }

  public exportSnapshot(): PersonPresenceSnapshot {
    return {
      presences: Array.from(this.presences.values(), (presence) => ({ ...presence })),
      locationHistory: Object.fromEntries(Array.from(this.locationHistory.entries(), ([personId, events]) => [
        personId,
        events.map((event) => ({ ...event })),
      ])),
    };
  }

  public restoreSnapshot(snapshot: unknown): void {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return;
    const stored = snapshot as { presences?: unknown; locationHistory?: unknown };
    this.presences.clear();
    this.locationHistory.clear();

    if (Array.isArray(stored.presences)) {
      for (const presence of stored.presences.slice(-20_000)) {
        if (
          presence && typeof presence.personId === 'string' && presence.personId.length > 0 && presence.personId.length <= 128 &&
          typeof presence.cameraId === 'string' && presence.cameraId.length > 0 && presence.cameraId.length <= 128 &&
          typeof presence.firstSeenAt === 'string' && Number.isFinite(Date.parse(presence.firstSeenAt)) &&
          typeof presence.lastSeenAt === 'string' && Number.isFinite(Date.parse(presence.lastSeenAt))
        ) {
          const validPresence = presence as PersonPresence;
          this.presences.set(this.presenceKey(validPresence.personId, validPresence.cameraId), validPresence);
        }
      }
    }

    if (stored.locationHistory && typeof stored.locationHistory === 'object' && !Array.isArray(stored.locationHistory)) {
      for (const [personId, events] of Object.entries(stored.locationHistory).slice(-10_000)) {
        if (personId.length === 0 || personId.length > 128 || !Array.isArray(events)) continue;
        const validEvents = events.filter((event) =>
          event && typeof event.personId === 'string' && event.personId === personId &&
          typeof event.previousCameraId === 'string' && typeof event.cameraId === 'string' &&
          typeof event.timestamp === 'string' && Number.isFinite(Date.parse(event.timestamp))
        ).slice(-500) as PersonLocationChangeEvent[];
        if (validEvents.length > 0) this.locationHistory.set(personId, validEvents);
      }
    }
  }

  public updatePresence(
    personId: string,
    cameraId: string,
    zoneId?: string,
    timestamp: string = new Date().toISOString()
  ): PersonPresence {
    const observedAt = Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : new Date().toISOString();
    const observedMs = Date.parse(observedAt);
    const key = this.presenceKey(personId, cameraId);
    const current = this.presences.get(key);

    if (current && current.zoneId === zoneId) {
      current.lastSeenAt = observedAt;
      this.persistAtMostOncePerSecond(observedMs);
      return { ...current };
    }

    const previous = Array.from(this.presences.values())
      .filter((presence) => presence.personId === personId && presence.cameraId !== cameraId)
      .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))[0];
    const history = this.locationHistory.get(personId) ?? [];

    if (previous) {
      const concurrent = Math.abs(observedMs - Date.parse(previous.lastSeenAt)) <= CONCURRENT_SIGHTING_WINDOW_MS;
      const duplicateConcurrentObservation = concurrent && history.some((event) =>
        event.concurrent &&
        event.previousCameraId === previous.cameraId &&
        event.cameraId === cameraId &&
        Math.abs(observedMs - Date.parse(event.timestamp)) <= ACTIVE_PRESENCE_WINDOW_MS
      );
      if (!duplicateConcurrentObservation) {
        history.push({
          personId,
          previousCameraId: previous.cameraId,
          previousZoneId: previous.zoneId,
          previousSeenAt: previous.lastSeenAt,
          cameraId,
          zoneId,
          timestamp: observedAt,
          concurrent,
        });
        this.locationHistory.set(personId, history.slice(-500));
      }
    }

    const presence: PersonPresence = {
      personId,
      cameraId,
      zoneId,
      firstSeenAt: current?.firstSeenAt || observedAt,
      lastSeenAt: observedAt,
      previousCameraId: previous?.cameraId,
      previousZoneId: previous?.zoneId,
    };
    this.presences.set(key, presence);
    this.persist();
    this.lastPersistAt = observedMs;
    return { ...presence };
  }

  public getCurrentPresence(personId: string): PersonPresence | undefined {
    const presence = Array.from(this.presences.values())
      .filter((entry) => entry.personId === personId)
      .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))[0];
    return presence ? { ...presence } : undefined;
  }

  public getAllCurrentPresences(): PersonPresence[] {
    const cutoff = Date.now() - ACTIVE_PRESENCE_WINDOW_MS;
    return Array.from(this.presences.values())
      .filter((presence) => Date.parse(presence.lastSeenAt) >= cutoff)
      .sort((left, right) => Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt))
      .map((presence) => ({ ...presence }));
  }

  public getLocationHistory(personId: string): PersonLocationChangeEvent[] {
    return (this.locationHistory.get(personId) ?? []).map((event) => ({ ...event }));
  }

  public mergePerson(provisionalPersonId: string, confirmedPersonId: string): void {
    if (!provisionalPersonId || !confirmedPersonId || provisionalPersonId === confirmedPersonId) return;

    const provisionalPresences = Array.from(this.presences.values())
      .filter((presence) => presence.personId === provisionalPersonId);
    const events = [
      ...(this.locationHistory.get(confirmedPersonId) ?? []),
      ...(this.locationHistory.get(provisionalPersonId) ?? []),
    ].map((event) => ({ ...event, personId: confirmedPersonId }));

    const uniqueEvents = new Map<string, PersonLocationChangeEvent>();
    for (const event of events) {
      const key = JSON.stringify([
        event.timestamp,
        event.previousCameraId,
        event.previousZoneId,
        event.previousSeenAt,
        event.cameraId,
        event.zoneId,
        event.concurrent,
      ]);
      uniqueEvents.set(key, event);
    }
    const mergedHistory = Array.from(uniqueEvents.values())
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

    for (const presence of provisionalPresences) {
      this.presences.delete(this.presenceKey(provisionalPersonId, presence.cameraId));
      const key = this.presenceKey(confirmedPersonId, presence.cameraId);
      const existing = this.presences.get(key);
      const latest = !existing || Date.parse(presence.lastSeenAt) > Date.parse(existing.lastSeenAt)
        ? presence
        : existing;
      this.presences.set(key, {
        ...latest,
        personId: confirmedPersonId,
        firstSeenAt: !existing || Date.parse(presence.firstSeenAt) < Date.parse(existing.firstSeenAt)
          ? presence.firstSeenAt
          : existing.firstSeenAt,
      });
    }

    if (mergedHistory.length > 0) this.locationHistory.set(confirmedPersonId, mergedHistory);
    else this.locationHistory.delete(confirmedPersonId);
    this.removePerson(provisionalPersonId);
  }

  public removePerson(personId: string): void {
    for (const [key, presence] of this.presences) {
      if (presence.personId === personId) this.presences.delete(key);
    }
    this.locationHistory.delete(personId);
    this.persist();
  }

  private presenceKey(personId: string, cameraId: string): string {
    return JSON.stringify([personId, cameraId]);
  }

  private persistAtMostOncePerSecond(timestampMs: number): void {
    if (timestampMs - this.lastPersistAt < 1_000) return;
    this.persist();
    this.lastPersistAt = timestampMs;
  }

  private persist(): void {
    if (typeof window === 'undefined') return;
    safeSetItem(PERSON_PRESENCE_STORAGE_KEY, JSON.stringify({
      presences: Array.from(this.presences.values()),
      locationHistory: Object.fromEntries(this.locationHistory),
    }));
  }
}
