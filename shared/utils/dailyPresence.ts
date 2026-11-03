export interface DailyCameraTransition {
  fromCameraId: string;
  toCameraId: string;
  timestamp: string;
}

export interface DailyPresenceRecord {
  personId: string;
  date: string;
  firstSeenAt: string;
  lastSeenAt: string;
  currentCameraId: string;
  cameraHistory: DailyCameraTransition[];
  transitionCount: number;
}

export class DailyPresenceManager {
  private readonly recordsByDate = new Map<string, Map<string, DailyPresenceRecord>>();

  public exportSnapshot(): DailyPresenceRecord[] {
    return Array.from(this.recordsByDate.values()).flatMap((records) =>
      Array.from(records.values(), (record) => this.copyRecord(record))
    );
  }

  public restoreSnapshot(snapshot: unknown): void {
    if (!Array.isArray(snapshot)) return;
    this.recordsByDate.clear();

    for (const record of snapshot.slice(-50_000)) {
      if (
        !record || typeof record.personId !== 'string' || record.personId.length === 0 || record.personId.length > 128 ||
        typeof record.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
        typeof record.firstSeenAt !== 'string' || !Number.isFinite(Date.parse(record.firstSeenAt)) ||
        typeof record.lastSeenAt !== 'string' || !Number.isFinite(Date.parse(record.lastSeenAt)) ||
        typeof record.currentCameraId !== 'string' || record.currentCameraId.length === 0 || record.currentCameraId.length > 128 ||
        !Array.isArray(record.cameraHistory)
      ) continue;

      const cameraHistory = record.cameraHistory.filter((transition: unknown) =>
        transition && typeof transition === 'object' &&
        typeof (transition as DailyCameraTransition).fromCameraId === 'string' &&
        typeof (transition as DailyCameraTransition).toCameraId === 'string' &&
        typeof (transition as DailyCameraTransition).timestamp === 'string' &&
        Number.isFinite(Date.parse((transition as DailyCameraTransition).timestamp))
      ).slice(-500) as DailyCameraTransition[];
      let records = this.recordsByDate.get(record.date);
      if (!records) {
        records = new Map<string, DailyPresenceRecord>();
        this.recordsByDate.set(record.date, records);
      }
      records.set(record.personId, {
        personId: record.personId,
        date: record.date,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        currentCameraId: record.currentCameraId,
        cameraHistory: cameraHistory.map((transition) => ({ ...transition })),
        transitionCount: cameraHistory.length,
      });
    }
  }

  public update(
    personId: string,
    cameraId: string,
    timestamp?: string | Date
  ): DailyPresenceRecord | undefined {
    if (!personId || !cameraId) return undefined;

    const observationDate = this.parseTimestamp(timestamp);
    if (!observationDate) return undefined;

    const date = this.formatLocalDate(observationDate);
    const observedAt = observationDate.toISOString();
    let dailyRecords = this.recordsByDate.get(date);
    if (!dailyRecords) {
      dailyRecords = new Map<string, DailyPresenceRecord>();
      this.recordsByDate.set(date, dailyRecords);
    }

    const current = dailyRecords.get(personId);
    if (!current) {
      const record: DailyPresenceRecord = {
        personId,
        date,
        firstSeenAt: observedAt,
        lastSeenAt: observedAt,
        currentCameraId: cameraId,
        cameraHistory: [],
        transitionCount: 0,
      };
      dailyRecords.set(personId, record);
      return this.copyRecord(record);
    }

    current.lastSeenAt = observedAt;
    if (current.currentCameraId !== cameraId) {
      current.cameraHistory.push({
        fromCameraId: current.currentCameraId,
        toCameraId: cameraId,
        timestamp: observedAt,
      });
      current.currentCameraId = cameraId;
      current.transitionCount++;
    }

    return this.copyRecord(current);
  }

  public get(personId: string, date?: string | Date): DailyPresenceRecord | undefined {
    const dateKey = this.resolveDateKey(date);
    if (!dateKey) return undefined;

    const record = this.recordsByDate.get(dateKey)?.get(personId);
    return record ? this.copyRecord(record) : undefined;
  }

  public getToday(personId: string): DailyPresenceRecord | undefined {
    return this.get(personId);
  }

  public getAllForDate(date: string | Date): DailyPresenceRecord[] {
    const dateKey = this.resolveDateKey(date);
    if (!dateKey) return [];

    const records = this.recordsByDate.get(dateKey);
    return records ? Array.from(records.values(), (record) => this.copyRecord(record)) : [];
  }

  public remove(personId: string, date?: string | Date): void {
    if (date !== undefined) {
      const dateKey = this.resolveDateKey(date);
      if (!dateKey) return;

      const records = this.recordsByDate.get(dateKey);
      if (!records) return;
      records.delete(personId);
      if (records.size === 0) this.recordsByDate.delete(dateKey);
      return;
    }

    for (const [dateKey, records] of this.recordsByDate) {
      records.delete(personId);
      if (records.size === 0) this.recordsByDate.delete(dateKey);
    }
  }

  public mergePerson(provisionalPersonId: string, confirmedPersonId: string): void {
    if (!provisionalPersonId || !confirmedPersonId || provisionalPersonId === confirmedPersonId) return;

    for (const [date, records] of this.recordsByDate) {
      const provisional = records.get(provisionalPersonId);
      if (!provisional) continue;

      const confirmed = records.get(confirmedPersonId);
      if (!confirmed) {
        records.set(confirmedPersonId, {
          ...provisional,
          personId: confirmedPersonId,
          cameraHistory: provisional.cameraHistory.map((transition) => ({ ...transition })),
        });
        records.delete(provisionalPersonId);
        continue;
      }

      const transitions = new Map<string, DailyCameraTransition>();
      for (const transition of [...confirmed.cameraHistory, ...provisional.cameraHistory]) {
        const key = JSON.stringify([transition.timestamp, transition.fromCameraId, transition.toCameraId]);
        transitions.set(key, { ...transition });
      }
      const cameraHistory = Array.from(transitions.values())
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      const provisionalIsLatest = Date.parse(provisional.lastSeenAt) > Date.parse(confirmed.lastSeenAt);
      const latest = provisionalIsLatest ? provisional : confirmed;
      const earliest = Date.parse(provisional.firstSeenAt) < Date.parse(confirmed.firstSeenAt)
        ? provisional.firstSeenAt
        : confirmed.firstSeenAt;
      const latestSeen = provisionalIsLatest ? provisional.lastSeenAt : confirmed.lastSeenAt;

      if (
        provisional.currentCameraId !== confirmed.currentCameraId &&
        !Array.from(transitions.values()).some((transition) =>
          transition.fromCameraId === (provisionalIsLatest ? confirmed.currentCameraId : provisional.currentCameraId) &&
          transition.toCameraId === latest.currentCameraId
        ) &&
        Date.parse(latest.firstSeenAt) > Date.parse(provisionalIsLatest ? confirmed.lastSeenAt : provisional.lastSeenAt)
      ) {
        const previous = provisionalIsLatest ? confirmed : provisional;
        const transition: DailyCameraTransition = {
          fromCameraId: previous.currentCameraId,
          toCameraId: latest.currentCameraId,
          timestamp: latest.firstSeenAt,
        };
        const key = JSON.stringify([transition.timestamp, transition.fromCameraId, transition.toCameraId]);
        transitions.set(key, transition);
      }

      const mergedHistory = Array.from(transitions.values())
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
      records.set(confirmedPersonId, {
        personId: confirmedPersonId,
        date,
        firstSeenAt: earliest,
        lastSeenAt: latestSeen,
        currentCameraId: latest.currentCameraId,
        cameraHistory: mergedHistory,
        transitionCount: mergedHistory.length,
      });
      records.delete(provisionalPersonId);
    }
  }

  private parseTimestamp(timestamp?: string | Date): Date | undefined {
    const parsed = timestamp === undefined
      ? new Date()
      : timestamp instanceof Date
        ? new Date(timestamp.getTime())
        : new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private resolveDateKey(date?: string | Date): string | undefined {
    if (date === undefined) return this.formatLocalDate(new Date());

    if (date instanceof Date) {
      return Number.isNaN(date.getTime()) ? undefined : this.formatLocalDate(date);
    }

    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (dateOnlyMatch) {
      const parsed = new Date(`${date}T00:00:00`);
      return !Number.isNaN(parsed.getTime()) && this.formatLocalDate(parsed) === date
        ? date
        : undefined;
    }

    const parsed = new Date(date);
    return Number.isNaN(parsed.getTime()) ? undefined : this.formatLocalDate(parsed);
  }

  private formatLocalDate(date: Date): string {
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private copyRecord(record: DailyPresenceRecord): DailyPresenceRecord {
    return {
      ...record,
      cameraHistory: record.cameraHistory.map((transition) => ({ ...transition })),
    };
  }
}
