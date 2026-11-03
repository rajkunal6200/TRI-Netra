export class PersonIdentityManager {
  private readonly personIdsByCamera = new Map<string, Map<string, string>>();
  private readonly knownPersonIds = new Set<string>();
  private nextPersonNumber = 1;

  public assignPersonId(cameraId: string, localTrackId: string): string {
    const existingPersonId = this.getPersonId(cameraId, localTrackId);
    if (existingPersonId) return existingPersonId;

    let personId: string;
    do {
      personId = `PERSON-${String(this.nextPersonNumber++).padStart(3, '0')}`;
    } while (this.knownPersonIds.has(personId));

    this.linkLocalTrack(cameraId, localTrackId, personId);
    return personId;
  }

  public getPersonId(cameraId: string, localTrackId: string): string | undefined {
    return this.personIdsByCamera.get(cameraId)?.get(localTrackId);
  }

  public linkLocalTrack(cameraId: string, localTrackId: string, personId: string): void {
    let cameraTracks = this.personIdsByCamera.get(cameraId);
    if (!cameraTracks) {
      cameraTracks = new Map<string, string>();
      this.personIdsByCamera.set(cameraId, cameraTracks);
    }

    cameraTracks.set(localTrackId, personId);
    this.knownPersonIds.add(personId);
  }

  public removeLocalTrack(cameraId: string, localTrackId: string): void {
    const cameraTracks = this.personIdsByCamera.get(cameraId);
    if (!cameraTracks) return;

    cameraTracks.delete(localTrackId);
    if (cameraTracks.size === 0) this.personIdsByCamera.delete(cameraId);
  }
}