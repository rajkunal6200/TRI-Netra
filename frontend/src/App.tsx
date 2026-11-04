import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { AlertBanner } from './components/AlertBanner';
import { IncidentNotificationToast } from './components/IncidentNotificationToast';
import { SurveillanceHUD } from './components/SurveillanceHUD';
import { IncidentFeed } from './components/IncidentFeed';
import { PersonnelDirectory } from './components/PersonnelDirectory';
import { StatsOverview } from './components/StatsOverview';
import { IncidentDetailsModal } from './components/IncidentDetailsModal';
import { SettingsModal } from './components/SettingsModal';
import { LockdownOverlay } from './components/LockdownOverlay';
import { MobileCameraTransmitter } from './components/MobileCameraTransmitter';
import { AdminLoginModal } from './components/AdminLoginModal';
import { 
  AuthorizedPerson, 
  SecurityIncident, 
  SurveillanceSettings, 
  ScanResult, 
  ThreatLevel, 
  SampleScenario,
  AdminUser,
  CameraChannel,
  LocationBreadcrumb
} from '@shared/types';
import { DEFAULT_PERSONNEL } from './data/defaultPersonnel';
import { SAMPLE_SCENARIOS } from './data/sampleScenarios';
import { soundEngine } from './utils/audioAlert';
import { safeSetItem, safeGetItem, sanitizeIncidentsForStorage } from '@shared/utils/storage';
import { getCachedAdminSessionUser, verifyAdminSession } from './utils/adminAuth';
import { attachIsolatedPortraitsToFaces } from './utils/faceCrop';
import { decodeFaceEmbedding, encodeFaceEmbeddingForStorage, faceEmbeddingSimilarity } from '@shared/utils/faceIdentityMatcher';
import { RealtimeFaceTracker } from '@shared/utils/realtimeFaceTracker';
import type { PersonPresence } from '@shared/utils/personPresence';
import { fetchCurrentPresence, fetchDailyPresence } from './utils/trackingApi';
import { traceRuntimeEvent } from './utils/runtimeDiagnostics';
import { loadIncidentEvidence, syncIncidentEvidence } from './utils/incidentEvidence';
import type { DailyPresenceRecord } from '@shared/utils/dailyPresence';

const INITIAL_SETTINGS: SurveillanceSettings = {
  autoScan: true,
  scanIntervalSeconds: 1,
  minConfidenceThreshold: 70,
  audioAlerts: true,
  alertVolume: 0.8,
  nightVisionMode: false,
  activeZone: 'Main Entrance',
  showBoundingBoxes: true,
  showHudOverlay: true,
  autoLockdownOnCritical: false,
  securityMode: 'STANDARD',
};

const THREAT_PRIORITY: Record<ThreatLevel, number> = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function highestActiveThreat(incidents: SecurityIncident[]): ThreatLevel {
  return incidents.reduce<ThreatLevel>(
    (highest, incident) => THREAT_PRIORITY[incident.threatLevel] > THREAT_PRIORITY[highest]
      ? incident.threatLevel
      : highest,
    'NONE'
  );
}

function isUnauthorizedIncident(incident: SecurityIncident): boolean {
  return incident.category === 'BIOMETRIC_BREACH' || incident.category === 'IDENTITY_REVIEW' ||
    incident.faces?.some((face) =>
      face.status === 'UNAUTHORIZED' || face.status === 'SUSPICIOUS' || face.status === 'UNKNOWN'
    ) === true;
}

function getUnauthorizedIncidentMetadata(incident: SecurityIncident): SecurityIncident {
  return {
    ...incident,
    capturedFrameUrl: '',
    croppedFaceUrl: undefined,
    fullSceneFrameUrl: undefined,
    faces: incident.faces.map((face) => ({ ...face, croppedFaceUrl: undefined })),
    locationHistory: incident.locationHistory?.map(({ capturedFrameUrl: _capturedFrameUrl, ...crumb }) => crumb),
  };
}

function isDataImage(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(value);
}

function getIncidentEvidenceUpload(incident: SecurityIncident): boolean {
  return isDataImage(incident.capturedFrameUrl) || isDataImage(incident.croppedFaceUrl) ||
    isDataImage(incident.fullSceneFrameUrl) || incident.faces.some((face) => isDataImage(face.croppedFaceUrl));
}

function mergeStoredIncidents(
  storedIncidents: SecurityIncident[],
  currentIncidents: SecurityIncident[]
): SecurityIncident[] {
  const byId = new Map(storedIncidents.map((incident) => [incident.id, incident]));
  for (const localIncident of currentIncidents) {
    const stored = byId.get(localIncident.id);
    if (!stored) {
      byId.set(localIncident.id, localIncident);
      continue;
    }
    const localTime = Date.parse(localIncident.lastSeenTimestamp || localIncident.timestamp);
    const storedTime = Date.parse(stored.lastSeenTimestamp || stored.timestamp);
    const preferred = !Number.isFinite(storedTime) || (Number.isFinite(localTime) && localTime >= storedTime)
      ? localIncident
      : stored;
    const other = preferred === localIncident ? stored : localIncident;
    byId.set(localIncident.id, {
      ...other,
      ...preferred,
      capturedFrameUrl: preferred.capturedFrameUrl || other.capturedFrameUrl,
      croppedFaceUrl: preferred.croppedFaceUrl || other.croppedFaceUrl,
      fullSceneFrameUrl: preferred.fullSceneFrameUrl || other.fullSceneFrameUrl,
      faces: preferred.faces.map((face, index) => ({
        ...face,
        croppedFaceUrl: face.croppedFaceUrl || other.faces[index]?.croppedFaceUrl,
      })),
    });
  }
  return Array.from(byId.values());
}

const INCIDENT_IDENTITY_MATCH_THRESHOLD = 0.5;
const MAX_INCIDENT_IDENTITY_REFERENCES = 3;

function getIncidentIdentityEmbeddings(incident: SecurityIncident): number[][] {
  const candidates = [
    incident.identityEmbedding,
    ...(incident.identityEmbeddings || []),
    incident.faces?.[0]?.embedding,
  ];
  const references: number[][] = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0 || !candidate.every(Number.isFinite)) continue;
    const isDuplicate = references.some((reference) =>
      (faceEmbeddingSimilarity(candidate, reference) ?? 0) >= 0.98
    );
    if (!isDuplicate) references.push(candidate);
    if (references.length >= MAX_INCIDENT_IDENTITY_REFERENCES) break;
  }

  return references;
}

function getIncidentIdentitySimilarity(faceEmbedding: number[] | undefined, incident: SecurityIncident): number | null {
  if (!faceEmbedding) return null;
  const similarities = getIncidentIdentityEmbeddings(incident)
    .map((reference) => faceEmbeddingSimilarity(faceEmbedding, reference))
    .filter((similarity): similarity is number => similarity !== null);
  return similarities.length > 0 ? Math.max(...similarities) : null;
}

function rememberIncidentIdentityEmbedding(
  incident: SecurityIncident,
  candidate: number[] | undefined
): Pick<SecurityIncident, 'identityEmbedding' | 'identityEmbeddings'> {
  const references = getIncidentIdentityEmbeddings(incident);
  if (
    candidate && candidate.length > 0 && candidate.every(Number.isFinite) &&
    references.length < MAX_INCIDENT_IDENTITY_REFERENCES &&
    !references.some((reference) => (faceEmbeddingSimilarity(candidate, reference) ?? 0) >= 0.82)
  ) {
    references.push([...candidate]);
  }

  const [identityEmbedding, ...identityEmbeddings] = references;
  return {
    ...(identityEmbedding ? { identityEmbedding } : {}),
    ...(identityEmbeddings.length > 0 ? { identityEmbeddings } : {}),
  };
}

export default function App() {
  // Check if device opened with phone camera transmitter query parameters
  const [isPhoneTransmitterMode, setIsPhoneTransmitterMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.has('phoneCam');
    }
    return false;
  });

  const phonePairParams = typeof window !== 'undefined'
    ? {
        channelId: new URLSearchParams(window.location.search).get('phoneCam') || 'cam-2',
        pairCode: new URLSearchParams(window.location.search).get('code') || 'PHONE-1',
      }
    : { channelId: 'cam-2', pairCode: 'PHONE-1' };

  // Navigation & View Tabs
  const [activeTab, setActiveTab] = useState<'live' | 'directory' | 'incidents'>('live');

  // Authorized Personnel Directory
  const [authorizedPersonnel, setAuthorizedPersonnel] = useState<AuthorizedPerson[]>(() => {
    const saved = safeGetItem('trinetra_personnel') || safeGetItem('sentinel_personnel');
    if (saved) {
      try {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((person: any) =>
            person &&
            typeof person.id === 'string' &&
            typeof person.name === 'string' &&
            typeof person.role === 'string' &&
            typeof person.department === 'string' &&
            typeof person.clearanceLevel === 'string' &&
            Array.isArray(person.accessZones)
          ).map((person: any) => {
            const restoredEmbeddings = Array.isArray(person.faceEmbeddings)
              ? person.faceEmbeddings.map(decodeFaceEmbedding).filter((embedding: number[] | undefined): embedding is number[] => Boolean(embedding)).slice(0, 5)
              : [];
            const legacyEmbedding = decodeFaceEmbedding(person.faceEmbedding);
            const faceEmbeddings = restoredEmbeddings.length > 0
              ? restoredEmbeddings
              : legacyEmbedding ? [legacyEmbedding] : [];
            return {
              ...person,
              photoUrl: typeof person.photoUrl === 'string' ? person.photoUrl : '',
              description: typeof person.description === 'string' ? person.description : '',
              accessZones: person.accessZones.filter((zone: unknown) => typeof zone === 'string'),
              faceEmbedding: legacyEmbedding || faceEmbeddings[0],
              faceEmbeddings: faceEmbeddings.length > 0 ? faceEmbeddings : undefined,
            };
          });
          return valid.length > 0 || parsed.length === 0 ? valid : DEFAULT_PERSONNEL;
        }
      } catch (e) {
        console.warn('Failed to parse saved personnel:', e);
      }
    }
    return DEFAULT_PERSONNEL;
  });
  const [isPersonnelStoreReady, setIsPersonnelStoreReady] = useState<boolean>(false);
  const [isIdentityDirectoryReady, setIsIdentityDirectoryReady] = useState<boolean>(false);
  const personnelSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Security Incidents with guaranteed unique IDs and strict 1-incident-per-person isolation
  const [incidents, setIncidents] = useState<SecurityIncident[]>(() => {
    const saved = safeGetItem('trinetra_incidents') || safeGetItem('sentinel_incidents');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const restoredIncidents: SecurityIncident[] = [];
          for (let index = 0; index < parsed.length; index++) {
            const rawItem = parsed[index];
            if (
              !rawItem || typeof rawItem !== 'object' ||
              typeof rawItem.title !== 'string' || typeof rawItem.timestamp !== 'string' ||
              typeof rawItem.zone !== 'string' || typeof rawItem.description !== 'string'
            ) continue;
            const item = {
              ...rawItem,
              id: typeof rawItem.id === 'string' && rawItem.id ? rawItem.id : `INC-${Date.now()}-${index}`,
              faces: Array.isArray(rawItem.faces) ? rawItem.faces.filter((face: any) => face && typeof face === 'object') : [],
              identityEmbedding: decodeFaceEmbedding(rawItem.identityEmbedding),
              identityEmbeddings: Array.isArray(rawItem.identityEmbeddings)
                ? rawItem.identityEmbeddings.map(decodeFaceEmbedding)
                  .filter((embedding: number[] | undefined): embedding is number[] => Boolean(embedding))
                  .slice(0, MAX_INCIDENT_IDENTITY_REFERENCES - 1)
                : [],
              locationHistory: Array.isArray(rawItem.locationHistory)
                ? rawItem.locationHistory.filter((crumb: any) => crumb && typeof crumb === 'object' && typeof crumb.timestamp === 'string')
                : [],
            };
            if (!['ACTIVE', 'ACKNOWLEDGED', 'DISPATCHED', 'RESOLVED', 'DISMISSED', 'FORENSIC_REVIEWED'].includes(item.status)) continue;
            if (!['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(item.threatLevel)) continue;

            // If an older incident bundled multiple faces together, split them into separate individual logs
            if (item.faces && item.faces.length > 1) {
              item.faces.forEach((f: any, fIdx: number) => {
                const subNum = fIdx + 1;
                restoredIncidents.push({
                  ...item,
                  category: f.status === 'UNAUTHORIZED'
                    ? 'BIOMETRIC_BREACH'
                    : item.category === 'BIOMETRIC_BREACH' && f.status !== 'SUSPICIOUS' && f.status !== 'UNKNOWN'
                    ? 'BIOMETRIC_BREACH'
                    : item.category === 'IDENTITY_REVIEW' || f.status === 'SUSPICIOUS' || f.status === 'UNKNOWN'
                    ? 'IDENTITY_REVIEW'
                    : item.category,
                  threatLevel: item.category === 'IDENTITY_REVIEW' || f.status === 'UNKNOWN' ? 'LOW' : item.threatLevel,
                  id: `${item.id}-P${subNum}`,
                  subjectIndex: subNum,
                  totalSubjectsInScene: item.faces.length,
                  title: `${item.title.replace(/\(Person #\d+\)/, '')} (Person #${subNum})`,
                  croppedFaceUrl: f.croppedFaceUrl || item.croppedFaceUrl || item.capturedFrameUrl,
                  capturedFrameUrl: f.croppedFaceUrl || item.capturedFrameUrl,
                  faces: [f],
                });
              });
              continue;
            }

            // One face record owns its complete breadcrumb trail. Do not split
            // a long history into fake people when restoring from local storage.
            restoredIncidents.push({
              ...item,
              category: item.faces[0]?.status === 'UNAUTHORIZED'
                ? 'BIOMETRIC_BREACH'
                : item.category === 'BIOMETRIC_BREACH' && item.faces[0]?.status !== 'SUSPICIOUS' && item.faces[0]?.status !== 'UNKNOWN'
                ? 'BIOMETRIC_BREACH'
                : item.category === 'IDENTITY_REVIEW' || item.faces[0]?.status === 'SUSPICIOUS' || item.faces[0]?.status === 'UNKNOWN'
                ? 'IDENTITY_REVIEW'
                : item.category,
              threatLevel: item.category === 'IDENTITY_REVIEW' || item.faces[0]?.status === 'UNKNOWN'
                ? 'LOW'
                : item.threatLevel,
              id: item.id,
              subjectIndex: item.subjectIndex || 1,
              totalSubjectsInScene: item.totalSubjectsInScene || 1,
              faces: item.faces.slice(0, 1),
            });
          }
          return restoredIncidents;
        }
      } catch (e) {
        console.warn('Failed to parse saved incidents:', e);
      }
    }
    return [];
  });
  const [incidentEvidenceReady, setIncidentEvidenceReady] = useState(false);
  const [isUnauthorizedIncidentStoreReady, setIsUnauthorizedIncidentStoreReady] = useState(false);
  const unauthorizedIncidentSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const unauthorizedIncidentSnapshotRef = useRef<Map<string, string>>(new Map());
  const unauthorizedIncidentEvidenceSavedAtRef = useRef<Map<string, number>>(new Map());
  const pendingUnauthorizedIncidentDeletesRef = useRef<Set<string>>(new Set());
  const pendingUnauthorizedIncidentClearRef = useRef(false);

  // Settings
  const [settings, setSettings] = useState<SurveillanceSettings>(() => {
    const saved = safeGetItem('trinetra_settings') || safeGetItem('sentinel_settings');
    if (saved) {
      try {
        const parsed: unknown = JSON.parse(saved);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const value = parsed as Record<string, unknown>;
          const boundedNumber = (input: unknown, fallback: number, min: number, max: number) =>
            typeof input === 'number' && Number.isFinite(input)
              ? Math.max(min, Math.min(max, input))
              : fallback;
          return {
            ...INITIAL_SETTINGS,
            autoScan: typeof value.autoScan === 'boolean' ? value.autoScan : INITIAL_SETTINGS.autoScan,
            // The previous default was 2s. Upgrade that default to the requested
            // 1s response while preserving deliberately slower custom intervals.
            scanIntervalSeconds: Math.round(
              boundedNumber(value.scanIntervalSeconds, INITIAL_SETTINGS.scanIntervalSeconds, 1, 60) === 2
                ? 1
                : boundedNumber(value.scanIntervalSeconds, INITIAL_SETTINGS.scanIntervalSeconds, 1, 60)
            ),
            minConfidenceThreshold: boundedNumber(value.minConfidenceThreshold, INITIAL_SETTINGS.minConfidenceThreshold, 0, 100),
            audioAlerts: typeof value.audioAlerts === 'boolean' ? value.audioAlerts : INITIAL_SETTINGS.audioAlerts,
            alertVolume: boundedNumber(value.alertVolume, INITIAL_SETTINGS.alertVolume, 0, 1),
            nightVisionMode: typeof value.nightVisionMode === 'boolean' ? value.nightVisionMode : INITIAL_SETTINGS.nightVisionMode,
            activeZone: typeof value.activeZone === 'string' && value.activeZone.trim() ? value.activeZone : INITIAL_SETTINGS.activeZone,
            showBoundingBoxes: typeof value.showBoundingBoxes === 'boolean' ? value.showBoundingBoxes : INITIAL_SETTINGS.showBoundingBoxes,
            showHudOverlay: typeof value.showHudOverlay === 'boolean' ? value.showHudOverlay : INITIAL_SETTINGS.showHudOverlay,
            autoLockdownOnCritical: typeof value.autoLockdownOnCritical === 'boolean' ? value.autoLockdownOnCritical : INITIAL_SETTINGS.autoLockdownOnCritical,
            securityMode: ['STANDARD', 'HIGH_SECURITY', 'MAXIMUM_RESTRICTION'].includes(String(value.securityMode))
              ? value.securityMode as SurveillanceSettings['securityMode']
              : INITIAL_SETTINGS.securityMode,
            autoScanMode: value.autoScanMode === 'sequential' || value.autoScanMode === 'all' ? value.autoScanMode : undefined,
            speedPreset: ['ULTRA_FAST', 'BALANCED', 'DEEP_SCAN'].includes(String(value.speedPreset))
              ? value.speedPreset as SurveillanceSettings['speedPreset']
              : undefined,
          };
        }
      } catch (e) {
        console.warn('Failed to parse saved settings:', e);
      }
    }
    return INITIAL_SETTINGS;
  });

  // Surveillance Runtime States
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [selectedScenario, setSelectedScenario] = useState<SampleScenario | null>(SAMPLE_SCENARIOS[0]);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isLockdownActive, setIsLockdownActive] = useState<boolean>(false);
  const [currentPresence, setCurrentPresence] = useState<PersonPresence[]>([]);
  const [todayPresenceRecords, setTodayPresenceRecords] = useState<DailyPresenceRecord[]>([]);

  // Modals
  const [inspectIncident, setInspectIncident] = useState<SecurityIncident | null>(null);
  const [incidentNotification, setIncidentNotification] = useState<{ incident: SecurityIncident; count: number } | null>(null);
  const previousIncidentIdsRef = useRef<Set<string> | null>(null);
  const incidentNotificationTimerRef = useRef<number | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Admin Authentication State
  const [initialAdminUser] = useState<AdminUser | null>(() => getCachedAdminSessionUser());
  const [isAdmin, setIsAdmin] = useState<boolean>(() => Boolean(initialAdminUser));
  const [adminUser, setAdminUser] = useState<AdminUser | null>(initialAdminUser);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState<boolean>(false);
  const [adminPromptReason, setAdminPromptReason] = useState<string>('');
  const pendingAdminActionRef = useRef<(() => void) | null>(null);
  const adminAuthGenerationRef = useRef(0);

  useEffect(() => {
    traceRuntimeEvent('app.mount');
    const onPageHide = (event: PageTransitionEvent) => {
      traceRuntimeEvent('app.pagehide', { persisted: event.persisted });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      traceRuntimeEvent('app.unmount');
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Existing installs may have persisted autoScan=false before real-time
  // monitoring became the default. Enable it once so those users actually get
  // live detections, then preserve any later manual toggle across reloads.
  useEffect(() => {
    const migrationKey = 'trinetra_auto_scan_default_v1';
    if (safeGetItem(migrationKey) === 'true') return;
    setSettings((previous) => previous.autoScan ? previous : { ...previous, autoScan: true });
    safeSetItem(migrationKey, 'true');
  }, []);

  useEffect(() => {
    let isMounted = true;
    const verificationGeneration = adminAuthGenerationRef.current;
    void verifyAdminSession().then((user) => {
      if (!isMounted || adminAuthGenerationRef.current !== verificationGeneration) return;
      traceRuntimeEvent('admin.session.verified', { authenticated: Boolean(user) });
      setAdminUser(user);
      setIsAdmin(Boolean(user));
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const refreshTodayPresence = () => {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      void fetchDailyPresence(date)
        .then((records) => {
          if (isMounted) setTodayPresenceRecords(records);
        })
        .catch(() => {
          // Preserve the last complete daily trail when tracking refresh is transiently unavailable.
        });
    };
    refreshTodayPresence();
    const intervalId = window.setInterval(refreshTodayPresence, 5_000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // Admin Permission Gatekeeper Helper
  const requireAdmin = useCallback((actionCallback: () => void, promptReason?: string) => {
    if (isAdmin) {
      actionCallback();
    } else {
      pendingAdminActionRef.current = actionCallback;
      setAdminPromptReason(promptReason || 'Administrative authorization required to perform this action.');
      setIsAdminModalOpen(true);
    }
  }, [isAdmin]);

  const handleLoginSuccess = useCallback((user: AdminUser) => {
    adminAuthGenerationRef.current += 1;
    traceRuntimeEvent('admin.login.success', { username: user.username });
    setIsAdmin(true);
    setAdminUser(user);
    if (pendingAdminActionRef.current) {
      const pendingAction = pendingAdminActionRef.current;
      pendingAdminActionRef.current = null;
      setTimeout(() => {
        pendingAction();
      }, 300);
    }
  }, []);

  const handleLogoutSuccess = useCallback(() => {
    adminAuthGenerationRef.current += 1;
    traceRuntimeEvent('admin.logout.explicit');
    setIsAdmin(false);
    setAdminUser(null);
    pendingAdminActionRef.current = null;
  }, []);

  // Lifetime Stats
  const [totalScansCount, setTotalScansCount] = useState<number>(0);
  const [authorizedMatchesCount, setAuthorizedMatchesCount] = useState<number>(0);
  const [unauthorizedBreachesCount, setUnauthorizedBreachesCount] = useState<number>(0);
  const incidentLog = incidents;
  const activeIncidents = incidentLog.filter((inc) => inc.status === 'ACTIVE');
  const operationalIncidents = activeIncidents.filter((inc) =>
    inc.feedMode !== 'simulation' &&
    inc.category !== 'IDENTITY_REVIEW'
  );
  const activeIncidentCount = activeIncidents.length;
  const currentThreatLevel = highestActiveThreat(operationalIncidents);

  useEffect(() => {
    const currentIncidentIds = new Set(incidentLog.map((incident) => incident.id));
    const previousIncidentIds = previousIncidentIdsRef.current;
    previousIncidentIdsRef.current = currentIncidentIds;
    if (!previousIncidentIds) return;

    const newlyCreatedIncidents = incidentLog.filter((incident) => !previousIncidentIds.has(incident.id));
    if (newlyCreatedIncidents.length === 0) return;

    setIncidentNotification({ incident: newlyCreatedIncidents[0], count: newlyCreatedIncidents.length });
    if (incidentNotificationTimerRef.current !== null) {
      window.clearTimeout(incidentNotificationTimerRef.current);
    }
    incidentNotificationTimerRef.current = window.setTimeout(() => {
      setIncidentNotification(null);
      incidentNotificationTimerRef.current = null;
    }, 10_000);
  }, [incidents]);

  useEffect(() => () => {
    if (incidentNotificationTimerRef.current !== null) {
      window.clearTimeout(incidentNotificationTimerRef.current);
    }
  }, []);

  const dismissIncidentNotification = () => {
    if (incidentNotificationTimerRef.current !== null) {
      window.clearTimeout(incidentNotificationTimerRef.current);
      incidentNotificationTimerRef.current = null;
    }
    setIncidentNotification(null);
  };

  useEffect(() => {
    let isMounted = true;
    void fetch('/api/personnel')
      .then((response) => {
        if (!response.ok) throw new Error(`Personnel database load failed (${response.status}).`);
        return response.json();
      })
      .then((result: { personnel?: AuthorizedPerson[] }) => {
        if (!isMounted) return;
        const serverPersonnel = Array.isArray(result.personnel)
          ? result.personnel.filter((person) => person && typeof person.id === 'string' && typeof person.name === 'string')
          : [];
        if (serverPersonnel.length > 0) {
          setAuthorizedPersonnel(serverPersonnel.map((person) => {
            const faceEmbeddings = Array.isArray(person.faceEmbeddings)
              ? person.faceEmbeddings.map(decodeFaceEmbedding).filter((embedding): embedding is number[] => Boolean(embedding)).slice(0, 5)
              : [];
            const faceEmbedding = decodeFaceEmbedding(person.faceEmbedding) || faceEmbeddings[0];
            return {
              ...person,
              photoUrl: typeof person.photoUrl === 'string' ? person.photoUrl : '',
              accessZones: Array.isArray(person.accessZones) ? person.accessZones : [],
              faceEmbedding,
              faceEmbeddings: faceEmbeddings.length > 0 ? faceEmbeddings : faceEmbedding ? [faceEmbedding] : undefined,
            };
          }));
        }
        setIsPersonnelStoreReady(true);
      })
      .catch((error: unknown) => {
        console.warn('Could not load the server personnel database; using this device\'s saved directory:', error);
        if (isMounted) setIsPersonnelStoreReady(true);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Sync state safely to local storage
  useEffect(() => {
    if (!isPersonnelStoreReady) return;
    safeSetItem('trinetra_personnel', JSON.stringify(authorizedPersonnel.map((person) => ({
      ...person,
      faceEmbedding: encodeFaceEmbeddingForStorage(person.faceEmbedding),
      faceEmbeddings: person.faceEmbeddings?.map(encodeFaceEmbeddingForStorage).filter((embedding): embedding is string => Boolean(embedding)),
    }))));
  }, [authorizedPersonnel, isPersonnelStoreReady]);

  useEffect(() => {
    if (!isPersonnelStoreReady) {
      setIsIdentityDirectoryReady(false);
      return;
    }
    let isMounted = true;
    setIsIdentityDirectoryReady(false);
    personnelSaveQueueRef.current = personnelSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const saveResponse = await fetch('/api/personnel', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personnel: authorizedPersonnel }),
        });
        if (!saveResponse.ok) throw new Error(`Personnel database save failed (${saveResponse.status}).`);

        const profilesToSync = authorizedPersonnel.filter((person) => person.faceEmbeddings?.length || person.faceEmbedding || person.photoUrl);
        for (const person of profilesToSync) {
          const embeddings = person.faceEmbeddings?.length
            ? person.faceEmbeddings
            : person.faceEmbedding ? [person.faceEmbedding] : [];
          if (embeddings.length > 0) RealtimeFaceTracker.registerFaceEmbeddings(person.id, embeddings);
        }

        if (profilesToSync.length > 0) {
          const response = await fetch('/api/tracking/register-embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              personnel: profilesToSync.map(({ id, faceEmbedding, faceEmbeddings, photoUrl }) => {
                const profileEmbeddings = faceEmbeddings?.length ? faceEmbeddings : faceEmbedding ? [faceEmbedding] : [];
                return {
                  id,
                  ...(profileEmbeddings.length > 1
                    ? { faceEmbeddings: profileEmbeddings }
                    : profileEmbeddings[0] ? { faceEmbedding: profileEmbeddings[0] } : {}),
                  ...(profileEmbeddings.length === 0 && photoUrl ? { photoUrl } : {}),
                };
              }),
            }),
          });
          if (!response.ok) throw new Error(`Identity sync failed (${response.status}).`);
          const result: { embeddings?: { personId: string; faceEmbedding?: number[]; faceEmbeddings?: number[][] }[] } = await response.json();
          if (isMounted && Array.isArray(result.embeddings) && result.embeddings.length > 0) {
            const embeddingsByPerson = new Map(result.embeddings.map((entry) => [
              entry.personId,
              entry.faceEmbeddings?.length ? entry.faceEmbeddings : entry.faceEmbedding ? [entry.faceEmbedding] : [],
            ]));
            setAuthorizedPersonnel((previous) => {
              let changed = false;
              const updated = previous.map((person) => {
                const faceEmbeddings = embeddingsByPerson.get(person.id);
                if (!faceEmbeddings?.length || person.faceEmbeddings?.length || person.faceEmbedding) return person;
                changed = true;
                RealtimeFaceTracker.registerFaceEmbeddings(person.id, faceEmbeddings);
                return { ...person, faceEmbedding: faceEmbeddings[0], faceEmbeddings };
              });
              return changed ? updated : previous;
            });
          }
        }
        if (isMounted) setIsIdentityDirectoryReady(true);
      })
      .catch((error: unknown) => {
        if (isMounted) setIsIdentityDirectoryReady(false);
        console.warn('Could not save or sync the authorized face directory:', error);
      });
    return () => {
      isMounted = false;
    };
  }, [authorizedPersonnel, isPersonnelStoreReady]);

  useEffect(() => {
    safeSetItem('trinetra_incidents', sanitizeIncidentsForStorage(incidentLog));
  }, [incidents]);

  useEffect(() => {
    let isMounted = true;
    let retryTimer: number | undefined;
    const loadUnauthorizedIncidentStore = async () => {
      try {
        const response = await fetch('/api/incidents/unauthorized');
        if (!response.ok) throw new Error(`Unauthorized incident database load failed (${response.status}).`);
        const result: { incidents?: SecurityIncident[] } = await response.json();
        if (!isMounted) return;
        const storedIncidents = pendingUnauthorizedIncidentClearRef.current
          ? []
          : Array.isArray(result.incidents)
            ? result.incidents.filter((incident) => incident && typeof incident.id === 'string' &&
                isUnauthorizedIncident(incident) && !pendingUnauthorizedIncidentDeletesRef.current.has(incident.id))
            : [];
        pendingUnauthorizedIncidentClearRef.current = false;
        unauthorizedIncidentSnapshotRef.current = new Map(storedIncidents.map((incident) => [
          incident.id,
          JSON.stringify(getUnauthorizedIncidentMetadata(incident)),
        ]));
        unauthorizedIncidentEvidenceSavedAtRef.current = new Map(storedIncidents.map((incident) => [
          incident.id,
          incident.capturedFrameUrl ? Date.now() : 0,
        ]));
        setIncidents((previous) => mergeStoredIncidents(storedIncidents, previous));
        setIsUnauthorizedIncidentStoreReady(true);
      } catch (error) {
        console.warn('Could not load the unauthorized incident database; retrying:', error);
        if (isMounted) retryTimer = window.setTimeout(loadUnauthorizedIncidentStore, 5_000);
      }
    };
    void loadUnauthorizedIncidentStore();
    return () => {
      isMounted = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (!isUnauthorizedIncidentStoreReady) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      const changedIncidents = incidents
        .filter(isUnauthorizedIncident)
        .map((incident) => {
          const metadata = JSON.stringify(getUnauthorizedIncidentMetadata(incident));
          const lastEvidenceSavedAt = unauthorizedIncidentEvidenceSavedAtRef.current.get(incident.id) || 0;
          const includeEvidence = getIncidentEvidenceUpload(incident) && now - lastEvidenceSavedAt >= 10_000;
          return { incident, metadata, includeEvidence };
        })
        .filter(({ incident, metadata, includeEvidence }) =>
          unauthorizedIncidentSnapshotRef.current.get(incident.id) !== metadata || includeEvidence
        );

      if (changedIncidents.length === 0) return;
      unauthorizedIncidentSaveQueueRef.current = unauthorizedIncidentSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          for (const { incident, metadata, includeEvidence } of changedIncidents) {
            const payload: SecurityIncident = { ...incident };
            if (!includeEvidence) {
              if (isDataImage(payload.capturedFrameUrl)) payload.capturedFrameUrl = '';
              if (isDataImage(payload.croppedFaceUrl)) payload.croppedFaceUrl = undefined;
              if (isDataImage(payload.fullSceneFrameUrl)) payload.fullSceneFrameUrl = undefined;
              payload.faces = payload.faces.map((face) => ({
                ...face,
                croppedFaceUrl: isDataImage(face.croppedFaceUrl) ? undefined : face.croppedFaceUrl,
              }));
            }
            const response = await fetch('/api/incidents/unauthorized', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ incident: payload }),
            });
            if (!response.ok) throw new Error(`Unauthorized incident save failed (${response.status}).`);
            unauthorizedIncidentSnapshotRef.current.set(incident.id, metadata);
            if (includeEvidence) unauthorizedIncidentEvidenceSavedAtRef.current.set(incident.id, Date.now());
          }
        })
        .catch((error: unknown) => {
          console.warn('Could not save an unauthorized incident:', error);
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [incidents, isUnauthorizedIncidentStoreReady]);

  useEffect(() => {
    let isMounted = true;
    const incidentIds = incidents.map((incident) => incident.id);
    void loadIncidentEvidence(incidentIds).then((evidenceByIncident) => {
      if (!isMounted) return;
      if (evidenceByIncident.size > 0) {
        setIncidents((previous) => previous.map((incident) => {
          const evidence = evidenceByIncident.get(incident.id);
          if (!evidence) return incident;
          const portrait = evidence.croppedFaceUrl || evidence.capturedFrameUrl;
          const capturedFrameUrl = incident.capturedFrameUrl || evidence.capturedFrameUrl || portrait || '';
          const croppedFaceUrl = incident.croppedFaceUrl || portrait;
          return {
            ...incident,
            capturedFrameUrl,
            ...(croppedFaceUrl ? { croppedFaceUrl } : {}),
            ...(incident.fullSceneFrameUrl || evidence.fullSceneFrameUrl
              ? { fullSceneFrameUrl: incident.fullSceneFrameUrl || evidence.fullSceneFrameUrl }
              : {}),
            ...(incident.faces?.length && portrait
              ? { faces: incident.faces.map((face, index) => index === 0 && !face.croppedFaceUrl
                ? { ...face, croppedFaceUrl: portrait }
                : face) }
              : {}),
          };
        }));
      }
      setIncidentEvidenceReady(true);
    }).catch((error: unknown) => {
      console.warn('Could not restore saved incident photos:', error);
      if (isMounted) setIncidentEvidenceReady(true);
    });
    return () => {
      isMounted = false;
    };
  }, [isUnauthorizedIncidentStoreReady]);

  useEffect(() => {
    if (!incidentEvidenceReady) return;
    const timer = window.setTimeout(() => {
      void syncIncidentEvidence(incidents).catch((error: unknown) => {
        console.warn('Could not save incident photos:', error);
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [incidentEvidenceReady, incidents]);

  useEffect(() => {
    safeSetItem('trinetra_settings', JSON.stringify(settings));
    soundEngine.setMuted(!settings.audioAlerts || isAudioMuted);
    soundEngine.setVolume(settings.alertVolume);
  }, [settings, isAudioMuted]);

  useEffect(() => {
    let isMounted = true;
    const updatePresence = () => {
      void fetchCurrentPresence()
        .then((presence) => {
          if (isMounted) setCurrentPresence(presence);
        })
        .catch(() => {
          // Keep the last server-confirmed sightings while a refresh is retried.
        });
    };

    updatePresence();
    const intervalId = window.setInterval(updatePresence, 1000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  // Multi-camera detection tracking ref for cross-camera correlation & batch alert aggregation
  const recentDetectionsRef = useRef<Map<string, { zone: string; camLabel: string; timestamp: number }>>(new Map());
  const pendingBreachesRef = useRef<Array<{
    channelId: string;
    camLabel: string;
    zoneLabel: string;
    personName: string;
    threatLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    matchedName?: string;
  }>>([]);
  const breachDebounceTimerRef = useRef<any>(null);

  // Unified batch speech synthesizer for single or multi-camera breaches
  const flushAggregatedBreachAlerts = useCallback(() => {
    const breaches = [...pendingBreachesRef.current];
    pendingBreachesRef.current = [];
    if (breaches.length === 0) return;

    // Deduplicate by channel/zone
    const locationMap = new Map<string, { camLabel: string; zone: string; threatLevel: string }>();
    const personToLocations = new Map<string, string[]>();

    breaches.forEach((b) => {
      const locKey = `${b.zoneLabel} (${b.camLabel})`;
      locationMap.set(locKey, { camLabel: b.camLabel, zone: b.zoneLabel, threatLevel: b.threatLevel });

      const personKey = b.matchedName && b.matchedName !== 'Unknown' 
        ? b.matchedName 
        : 'Unauthorized Person';
      
      const locs = personToLocations.get(personKey) || [];
      if (!locs.includes(locKey)) {
        locs.push(locKey);
      }
      personToLocations.set(personKey, locs);
    });

    const uniqueLocations = Array.from(locationMap.keys());
    const hasCritical = breaches.some((b) => b.threatLevel === 'CRITICAL');

    // Check if the same person was detected across multiple distinct locations
    let samePersonMultiLocation = false;
    let samePersonAnnouncement = '';

    for (const [person, locs] of personToLocations.entries()) {
      if (locs.length > 1) {
        samePersonMultiLocation = true;
        samePersonAnnouncement = `Critical Security Alert! Same unauthorized individual detected across multiple zones: ${locs.join(', and ')}!`;
        break;
      }
    }

    soundEngine.playIntruderAlarm();

    if (samePersonMultiLocation && samePersonAnnouncement) {
      soundEngine.speakAnnouncement(samePersonAnnouncement, true);
    } else if (uniqueLocations.length === 1) {
      const loc = uniqueLocations[0];
      soundEngine.speakAnnouncement(
        `Security Alert. Unauthorized individual detected on ${loc}`,
        true
      );
    } else if (uniqueLocations.length === 2) {
      soundEngine.speakAnnouncement(
        `Security Alert! Unauthorized persons detected on ${uniqueLocations[0]}, and ${uniqueLocations[1]}!`,
        true
      );
    } else {
      soundEngine.speakAnnouncement(
        `Critical Multi-Zone Alert! Unauthorized persons detected across ${uniqueLocations.slice(0, -1).join(', ')}, and ${uniqueLocations[uniqueLocations.length - 1]}!`,
        true
      );
    }
  }, []);

  // Handle Scan Outcome & Automated Real-Time Threat Alerts
  const handleScanComplete = useCallback(
    async (result: ScanResult, frameBase64: string) => {
      setTotalScansCount((prev) => prev + 1);
      traceRuntimeEvent('scan.completed', {
        channelId: result.channelId,
        feedMode: result.feedMode,
        threatLevel: result.overallThreatLevel,
        faces: result.faces.length,
      });

      // 1. Isolate every person's face into their own distinct portrait picture
      // ensuring no other person is in that person's picture!
      const facesWithPortraits = await attachIsolatedPortraitsToFaces(frameBase64, result.faces);

      const unauthFaces = facesWithPortraits.filter(
        (f) => f.status === 'UNAUTHORIZED'
      );
      const reviewFaces = facesWithPortraits.filter((f) => f.status === 'UNKNOWN' || f.status === 'SUSPICIOUS');
      const authFaces = facesWithPortraits.filter((f) => f.status === 'AUTHORIZED');

      const hasFaceFreeCriticalThreat = facesWithPortraits.length === 0 &&
        (result.overallThreatLevel === 'HIGH' || result.overallThreatLevel === 'CRITICAL');

      if (authFaces.length > 0 && result.feedMode !== 'simulation') {
        setAuthorizedMatchesCount((prev) => prev + authFaces.length);
      }
      if (
        authFaces.length > 0 && unauthFaces.length === 0 && reviewFaces.length === 0 &&
        result.feedMode !== 'simulation'
      ) {
        soundEngine.playAuthorizedChime();
      }

      const camLabel = result.channelNumber ? `CAM 0${result.channelNumber}` : 'Camera Feed';
      const zoneLabel = result.zone || settings.activeZone;

      // Security logs are for unregistered/uncertain people and actual threats.
      // Authorized sightings are recorded by the presence tracker and directory history instead.
      if (unauthFaces.length > 0 || reviewFaces.length > 0 || hasFaceFreeCriticalThreat) {
        const hasConfirmedBreach = unauthFaces.length > 0 || hasFaceFreeCriticalThreat;
        if (hasConfirmedBreach) {
          setUnauthorizedBreachesCount((prev) => prev + Math.max(1, unauthFaces.length));

          // Simulations should visibly exercise the incident banner and counters,
          // but only a real camera feed may trigger audible alarms or lockdown.
          if (result.feedMode !== 'simulation') {
            unauthFaces.forEach((face) => {
              pendingBreachesRef.current.push({
                channelId: result.channelId,
                camLabel,
                zoneLabel,
                personName: face.matchedName || 'Unknown',
                matchedName: face.matchedName,
                threatLevel: result.overallThreatLevel,
              });
            });

            if (unauthFaces.length === 0) {
              pendingBreachesRef.current.push({
                channelId: result.channelId,
                camLabel,
                zoneLabel,
                personName: 'Threat Detected',
                threatLevel: result.overallThreatLevel,
              });
            }

            if (breachDebounceTimerRef.current) {
              clearTimeout(breachDebounceTimerRef.current);
            }
            breachDebounceTimerRef.current = setTimeout(() => {
              flushAggregatedBreachAlerts();
            }, 500);

            if (settings.autoLockdownOnCritical && result.overallThreatLevel === 'CRITICAL') {
              setIsLockdownActive(true);
            }
          }
        }

        // Only people who need a security response get incident records. Routine
        // authorized detections remain available in the personnel location history.
        const targetFaces = facesWithPortraits.length > 0
          ? [
              ...unauthFaces,
              ...reviewFaces,
            ]
          : [
              {
                id: `face-synth-${Date.now()}`,
                box_2d: [150, 250, 750, 750] as [number, number, number, number],
                status: 'UNAUTHORIZED' as const,
                matchedName: 'UNREGISTERED INDIVIDUAL',
                confidence: 90,
                threatLevel: result.overallThreatLevel,
                threatReason: result.sceneSummary || 'Security Threat Detected',
                croppedFaceUrl: frameBase64,
              }
            ];

        const totalSubjects = targetFaces.length;
        const currentChannelId = result.channelId || `cam-${result.channelNumber || 1}`;
        const nowMs = Date.now();

        setIncidents((prev) => {
          let currentIncidents = [...prev];

          for (let i = 0; i < targetFaces.length; i++) {
            const face = targetFaces[i];
            const subjectNum = i + 1;
            // Picture is strictly of THAT person only!
            const isolatedPersonPicture = face.croppedFaceUrl || frameBase64;

            const isProperlyVisible =
              face.isProperlyVisible !== false &&
              face.visibilityStatus !== 'NOT_PROPERLY_VISIBLE' &&
              face.visibilityStatus !== 'BLURRY' &&
              face.visibilityStatus !== 'OCCLUDED' &&
              (face.confidence || 85) >= 65;

            const visibilityStatus = face.visibilityStatus || (isProperlyVisible ? 'CLEAR' : 'NOT_PROPERLY_VISIBLE');
            const visibilityReason = face.visibilityReason || (isProperlyVisible ? 'Clear facial biometrics' : 'Partial angle or blurry facial features');

            // Unique faceKey fallback for cameras that do not provide a descriptor.
            const boxCenterX = Math.round(((face.box_2d?.[1] ?? 0) + (face.box_2d?.[3] ?? 0)) / 2);
            const boxCenterY = Math.round(((face.box_2d?.[0] ?? 0) + (face.box_2d?.[2] ?? 0)) / 2);
            const isIdentityReview = face.status === 'UNKNOWN' || face.status === 'SUSPICIOUS';
            const incidentThreatLevel = isIdentityReview
              ? 'LOW'
              : face.threatLevel || (face.status === 'AUTHORIZED' ? 'LOW' : result.overallThreatLevel);
            const incidentFace = isIdentityReview ? { ...face, threatLevel: 'LOW' as const } : face;
            const faceKey = face.matchedPersonnelId
              ? `person_${face.matchedPersonnelId}`
              : isIdentityReview
              ? `review_${currentChannelId}_${face.localTrackId || `subject_${subjectNum}`}`
              : face.matchedName && face.matchedName !== 'UNREGISTERED INDIVIDUAL'
              ? `name_${face.matchedName.toLowerCase().replace(/\s+/g, '_')}_p${subjectNum}`
              : `unauth_s${subjectNum}_${(face.features?.genderEstimate || 'person').toLowerCase()}_${(face.features?.ageEstimate || 'gen').toLowerCase()}_pos${Math.round(boxCenterX / 80)}_${Math.round(boxCenterY / 80)}`;

            const subjectLabel = face.matchedName && face.matchedName !== 'UNREGISTERED INDIVIDUAL'
              ? face.matchedName
              : isIdentityReview
              ? totalSubjects > 1 ? `Unverified Person #${subjectNum}` : 'Unverified Person'
              : totalSubjects > 1
              ? `Unregistered Individual #${subjectNum}`
              : `Unregistered Individual`;

            // Reuse the same person record across camera sightings and keep its full breadcrumb history.
            const matchIndex = currentIncidents.findIndex((inc) => {
              const incTime = new Date(inc.lastSeenTimestamp || inc.timestamp).getTime();

              // Never link camera offline alerts with biometric face sightings
              if (inc.category === 'CAMERA_OFFLINE') return false;
              // Demo scenarios must never merge into live camera incident history.
              if ((inc.feedMode === 'simulation') !== (result.feedMode === 'simulation')) return false;
              // Two different faces in the same frame must stay separate even
              // if their descriptors are unusually similar.
              if (
                inc.channelId === currentChannelId && inc.timestamp === result.timestamp &&
                inc.subjectIndex !== subjectNum
              ) return false;

              // A registered identity is globally stable across cameras and
              // subject order, including when several people share a frame.
              const existingPersonnelId = inc.faces?.[0]?.matchedPersonnelId;
              if (face.matchedPersonnelId && existingPersonnelId) {
                return existingPersonnelId === face.matchedPersonnelId;
              }

              const existingFace = inc.faces?.[0];
              const existingIsAuthorized = existingFace?.status === 'AUTHORIZED' || Boolean(existingFace?.matchedPersonnelId);
              const canMatchAuthorizedHistory = face.status === 'AUTHORIZED';
              const similarity = getIncidentIdentitySimilarity(face.embedding, inc);
              if (
                similarity !== null && similarity >= INCIDENT_IDENTITY_MATCH_THRESHOLD &&
                (!existingIsAuthorized || canMatchAuthorizedHistory)
              ) {
                return true;
              }

              // A short camera-local track fallback is used only when an
              // embedding cannot be compared. Text labels and frame positions
              // are never treated as a cross-camera identity.
              const sameCamera = inc.channelId === currentChannelId;
              const sameTrack = Boolean(face.localTrackId) && existingFace?.localTrackId === face.localTrackId;
              const bothUnregistered = face.status !== 'AUTHORIZED' && existingFace?.status !== 'AUTHORIZED';
              return sameCamera && bothUnregistered && sameTrack && nowMs - incTime < 15000;
            });

            if (matchIndex !== -1) {
              const existing = currentIncidents[matchIndex];
              const wasPreviouslyUnauthorized = existing.category === 'BIOMETRIC_BREACH' || existing.faces.some((priorFace) =>
                priorFace.status === 'UNAUTHORIZED'
              );
              const newCount = (existing.sightingsCount || 1) + 1;
              
              // Track breadcrumb trail across all camera locations
              const rawTrail: LocationBreadcrumb[] = existing.locationHistory && existing.locationHistory.length > 0
                ? existing.locationHistory
                : [{
                    zone: existing.zone,
                    channelId: existing.channelId,
                    channelName: existing.channelName,
                    channelNumber: existing.channelNumber,
                    timestamp: existing.firstSeenTimestamp || existing.timestamp,
                    firstSeenTimestamp: existing.firstSeenTimestamp || existing.timestamp,
                    sightingsCount: 1,
                  }];
              const sameCameraLocation = (left: LocationBreadcrumb, right: LocationBreadcrumb) => {
                if (left.channelId && right.channelId) return left.channelId === right.channelId;
                if (left.channelNumber !== undefined && right.channelNumber !== undefined) {
                  return left.channelNumber === right.channelNumber;
                }
                return Boolean(left.channelName && right.channelName && left.channelName === right.channelName);
              };

              // Keep one compact record per camera/location, preserving its first
              // and latest detection times. This avoids a frame-sized image and a
              // new breadcrumb being retained on every two-second scan.
              const existingTrail: LocationBreadcrumb[] = [];
              for (const crumb of rawTrail) {
                const priorIndex = existingTrail.findIndex((prior) =>
                  prior.zone === crumb.zone && sameCameraLocation(prior, crumb)
                );
                if (priorIndex === -1) {
                  existingTrail.push({
                    ...crumb,
                    firstSeenTimestamp: crumb.firstSeenTimestamp || crumb.timestamp,
                    sightingsCount: crumb.sightingsCount || 1,
                    capturedFrameUrl: undefined,
                  });
                  continue;
                }
                const prior = existingTrail[priorIndex];
                const priorTime = new Date(prior.timestamp).getTime();
                const crumbTime = new Date(crumb.timestamp).getTime();
                existingTrail[priorIndex] = {
                  ...prior,
                  timestamp: crumbTime > priorTime ? crumb.timestamp : prior.timestamp,
                  firstSeenTimestamp: prior.firstSeenTimestamp || crumb.firstSeenTimestamp || crumb.timestamp,
                  sightingsCount: (prior.sightingsCount || 1) + (crumb.sightingsCount || 1),
                };
              }

              const currentCameraLocation: LocationBreadcrumb = {
                zone: zoneLabel,
                channelId: currentChannelId,
                channelName: result.channelName || camLabel,
                channelNumber: result.channelNumber,
                timestamp: result.timestamp,
              };
              const existingLocationIndex = existingTrail.findIndex((crumb) =>
                crumb.zone === zoneLabel && sameCameraLocation(crumb, currentCameraLocation)
              );
              const previousLocation = existingLocationIndex === -1 ? undefined : existingTrail[existingLocationIndex];
              const currentLocation: LocationBreadcrumb = {
                zone: zoneLabel,
                channelId: currentChannelId,
                channelName: result.channelName || camLabel,
                channelNumber: result.channelNumber,
                timestamp: result.timestamp,
                firstSeenTimestamp: previousLocation?.firstSeenTimestamp || result.timestamp,
                sightingsCount: (previousLocation?.sightingsCount || 0) + 1,
              };
              const updatedTrail = [
                ...existingTrail.filter((_, index) => index !== existingLocationIndex),
                currentLocation,
              ];

              const uniqueLocations = Array.from(new Set(updatedTrail.map((breadcrumb) =>
                `${breadcrumb.zone} (${breadcrumb.channelName || `CAM 0${breadcrumb.channelNumber || 1}`})`
              )));
              const isMultiLocation = uniqueLocations.length > 1;

              // ALWAYS prioritize the latest high-res portrait picture
              const bestPhotoUrl = (isolatedPersonPicture && isolatedPersonPicture.length > 100)
                ? isolatedPersonPicture
                : (existing.croppedFaceUrl || existing.capturedFrameUrl || isolatedPersonPicture);

              const updatedIncident: SecurityIncident = {
                ...existing,
                sightingsCount: newCount,
                lastSeenTimestamp: result.timestamp,
                zone: zoneLabel,
                channelId: currentChannelId,
                channelName: result.channelName || camLabel,
                channelNumber: result.channelNumber,
                capturedFrameUrl: bestPhotoUrl,
                croppedFaceUrl: bestPhotoUrl,
                fullSceneFrameUrl: frameBase64 || existing.fullSceneFrameUrl,
                isProperlyVisible: isProperlyVisible || existing.isProperlyVisible,
                visibilityStatus: isProperlyVisible ? 'CLEAR' : existing.visibilityStatus,
                locationHistory: updatedTrail,
                feedMode: result.feedMode,
                threatLevel: incidentThreatLevel,
                ...rememberIncidentIdentityEmbedding(existing, face.embedding),
                category: wasPreviouslyUnauthorized
                  ? 'BIOMETRIC_BREACH'
                  : isIdentityReview
                  ? 'IDENTITY_REVIEW'
                  : face.status === 'AUTHORIZED'
                  ? undefined
                  : 'BIOMETRIC_BREACH',
                description: wasPreviouslyUnauthorized && face.status === 'AUTHORIZED'
                  ? `This person was previously recorded as unauthorized. A later scan matched ${subjectLabel} in the authorized directory. The original incident is retained for operator review.`
                  : wasPreviouslyUnauthorized && isIdentityReview
                  ? `This person was previously recorded as unauthorized. The latest face image is unclear, so the original incident remains open for operator review.`
                  : isIdentityReview
                  ? `${isMultiLocation ? `This face has appeared at ${uniqueLocations.join(' ➔ ')}. ` : ''}No authorized profile matched with sufficient confidence. Manual identity review is required; unauthorized status is not confirmed.`
                  : face.status === 'AUTHORIZED'
                  ? `Biometric match confirmed: ${subjectLabel}.${isMultiLocation ? ` Seen at ${uniqueLocations.join(' ➔ ')}.` : ''}`
                  : isMultiLocation
                  ? `Person tracked across ${uniqueLocations.length} camera locations: ${uniqueLocations.join(' ➔ ')}. Currently sighted in ${zoneLabel} on ${camLabel}.`
                  : face.threatReason || result.sceneSummary || `Unregistered individual detected on ${camLabel} in ${zoneLabel}: Face biometric not present in authorized personnel directory.`,
                title: wasPreviouslyUnauthorized
                  ? face.status === 'AUTHORIZED'
                    ? `⚠️ Prior Unauthorized Detection · Matched: ${subjectLabel}`
                    : isIdentityReview
                    ? `⚠️ Prior Unauthorized Detection · Review Required`
                    : `⚠️ Unauthorized Person on ${camLabel}`
                  : isIdentityReview
                  ? `🔎 Identity Review: ${subjectLabel} on ${camLabel}`
                  : face.status === 'AUTHORIZED'
                  ? `🛡️ Verified Personnel: ${subjectLabel} on ${camLabel}`
                  : isMultiLocation
                  ? `🚨 Multi-Camera Movement: ${subjectLabel} (${uniqueLocations.join(' ➔ ')})`
                  : totalSubjects > 1
                  ? `⚠️ ${subjectLabel} on ${camLabel} (Seen ${newCount}x)`
                  : `⚠️ Unregistered Face on ${camLabel} (Seen ${newCount}x)`,
                status: wasPreviouslyUnauthorized
                  ? existing.status
                  : face.status === 'AUTHORIZED' ? 'RESOLVED' : 'ACTIVE',
                faces: [incidentFace],
              };

              currentIncidents.splice(matchIndex, 1);
              currentIncidents.unshift(updatedIncident);
              continue;
            }

            // New Incident for this specific individual with THEIR picture only
            const uniqueIncidentId = `INC-${Date.now()}-P${subjectNum}-${Math.random().toString(36).substring(2, 6)}`;
            const newIncident: SecurityIncident = {
              id: uniqueIncidentId,
              timestamp: result.timestamp,
              firstSeenTimestamp: result.timestamp,
              lastSeenTimestamp: result.timestamp,
              sightingsCount: 1,
              isProperlyVisible,
              visibilityStatus,
              visibilityReason,
              faceKey,
              zone: zoneLabel,
              channelId: currentChannelId,
              channelName: result.channelName || camLabel,
              channelNumber: result.channelNumber,
              feedMode: result.feedMode,
              category: isIdentityReview ? 'IDENTITY_REVIEW' : face.status === 'AUTHORIZED' ? undefined : 'BIOMETRIC_BREACH',
              identityEmbedding: face.embedding ? [...face.embedding] : undefined,
              locationHistory: [
                {
                  zone: zoneLabel,
                  channelId: currentChannelId,
                  channelName: result.channelName || camLabel,
                  channelNumber: result.channelNumber,
                  timestamp: result.timestamp,
                  firstSeenTimestamp: result.timestamp,
                  sightingsCount: 1,
                },
              ],
              threatLevel: incidentThreatLevel,
              title: isIdentityReview
                ? `🔎 Identity Review: ${subjectLabel} on ${camLabel} (${zoneLabel})`
                : !isProperlyVisible
                ? `📷 Unclear/Partial Face (${subjectLabel}) on ${camLabel}`
                : face.status === 'AUTHORIZED'
                ? `🛡️ Verified Personnel: ${subjectLabel} on ${camLabel}`
                : totalSubjects > 1
                ? `⚠️ ${subjectLabel} on ${camLabel} (${zoneLabel})`
                : `⚠️ Unregistered Face on ${camLabel} (${zoneLabel})`,
              description: isIdentityReview
                ? `A face was detected on ${camLabel} in ${zoneLabel}, but no authorized profile matched with sufficient confidence. Manual identity review is required; unauthorized status is not confirmed.`
                : !isProperlyVisible
                ? `Face not properly visible (${visibilityReason}). Forensic portrait isolated.`
                : face.threatReason || (face.status === 'AUTHORIZED' ? `Biometric match confirmed: ${subjectLabel}.` : result.sceneSummary) || `Unregistered individual detected on ${camLabel}: Face biometric not present in authorized personnel directory.`,
              status: face.status === 'AUTHORIZED' ? 'RESOLVED' : 'ACTIVE',
              // CRITICAL: capturedFrameUrl and croppedFaceUrl are of THAT PERSON ONLY!
              capturedFrameUrl: isolatedPersonPicture,
              croppedFaceUrl: isolatedPersonPicture,
              fullSceneFrameUrl: frameBase64,
              subjectIndex: subjectNum,
              totalSubjectsInScene: totalSubjects,
              faces: [incidentFace],
              recommendedAction: isIdentityReview
                ? 'Review the isolated face and confirm whether this person should be added to the authorized directory.'
                : !isProperlyVisible
                ? 'Review photographic snapshot manually or adjust camera angle/lighting for clear face angle.'
                : result.recommendedAction,
            };

            currentIncidents.unshift(newIncident);
          }

          return currentIncidents;
        });
      }
    },
    [settings.activeZone, settings.autoLockdownOnCritical, flushAggregatedBreachAlerts]
  );

  // Personnel Handlers
  const handleAddPersonnel = (person: AuthorizedPerson) => {
    setAuthorizedPersonnel((prev) => [person, ...prev]);
  };

  const handleDeletePersonnel = (id: string) => {
    setAuthorizedPersonnel((prev) => prev.filter((p) => p.id !== id));
  };

  // Incident Handlers
  const handleAcknowledgeIncident = (id: string) => {
    setIncidents((prev) =>
      prev.map((inc) => (inc.id === id ? { ...inc, status: 'ACKNOWLEDGED' } : inc))
    );
  };

  const handleResolveIncident = (id: string) => {
    setIncidents((prev) =>
      prev.map((inc) => (inc.id === id ? { ...inc, status: 'RESOLVED' } : inc))
    );
  };

  const handleDeleteIncident = (id: string) => {
    const deletedIncident = incidents.find((incident) => incident.id === id);
    setIncidents((prev) => prev.filter((inc) => inc.id !== id));
    if (deletedIncident && isUnauthorizedIncident(deletedIncident)) {
      pendingUnauthorizedIncidentDeletesRef.current.add(id);
      unauthorizedIncidentSaveQueueRef.current = unauthorizedIncidentSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const response = await fetch(`/api/incidents/unauthorized/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (!response.ok) throw new Error(`Unauthorized incident delete failed (${response.status}).`);
          unauthorizedIncidentSnapshotRef.current.delete(id);
          unauthorizedIncidentEvidenceSavedAtRef.current.delete(id);
        })
        .catch((error: unknown) => {
          pendingUnauthorizedIncidentDeletesRef.current.delete(id);
          console.warn('Could not delete the saved unauthorized incident:', error);
        });
    }
  };

  // Handle Camera Feed Toggle (Close camera / re-open camera in any zone)
  const handleToggleCameraFeed = useCallback((camera: CameraChannel, explicitClosedState?: boolean) => {
    const isNowClosed = explicitClosedState !== undefined ? explicitClosedState : !camera.isClosed;
    const nowIso = new Date().toISOString();
    const zoneName = camera.zone || `Zone ${camera.channelNumber}`;
    const camName = camera.name || `CAM 0${camera.channelNumber}`;

    if (isNowClosed) {
      const offlineIncident: SecurityIncident = {
        id: `INC-CAM-${camera.id}-${Date.now()}`,
        timestamp: nowIso,
        firstSeenTimestamp: nowIso,
        lastSeenTimestamp: nowIso,
        zone: zoneName,
        channelId: camera.id,
        channelName: camName,
        channelNumber: camera.channelNumber,
        threatLevel: 'MEDIUM',
        title: `Camera Feed Closed • ${camName}`,
        description: `The camera feed for ${zoneName} was closed by an operator. This creates an unmonitored blind spot until the feed is restored.`,
        status: 'ACTIVE',
        capturedFrameUrl: '',
        faces: [],
        recommendedAction: 'Restore the camera feed or acknowledge planned maintenance.',
        category: 'CAMERA_OFFLINE',
        feedMode: camera.feedMode,
      };
      setIncidents((previous) => {
        if (previous.some((incident) => incident.category === 'CAMERA_OFFLINE' && incident.channelId === camera.id && incident.status === 'ACTIVE')) {
          return previous;
        }
        return [offlineIncident, ...previous];
      });
      soundEngine.playWarningBeep();
      soundEngine.speakAnnouncement(`Camera feed closed in ${zoneName}.`, true);
    } else {
      setIncidents((previous) => previous.map((incident) =>
        incident.category === 'CAMERA_OFFLINE' && incident.channelId === camera.id && incident.status === 'ACTIVE'
          ? {
              ...incident,
              status: 'RESOLVED',
              lastSeenTimestamp: nowIso,
              operatorNotes: `[${new Date().toLocaleTimeString()}] Camera feed restored by operator.`,
            }
          : incident
      ));
      soundEngine.speakAnnouncement(`Camera feed restored in ${zoneName}. Monitoring online.`, true);
    }
  }, [activeIncidents]);

  const handleClearAllIncidents = () => {
    setIncidents([]);
    pendingUnauthorizedIncidentClearRef.current = true;
    unauthorizedIncidentSaveQueueRef.current = unauthorizedIncidentSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch('/api/incidents/unauthorized', { method: 'DELETE' });
        if (!response.ok) throw new Error(`Unauthorized incident database clear failed (${response.status}).`);
        unauthorizedIncidentSnapshotRef.current.clear();
        unauthorizedIncidentEvidenceSavedAtRef.current.clear();
        if (isUnauthorizedIncidentStoreReady) pendingUnauthorizedIncidentClearRef.current = false;
      })
      .catch((error: unknown) => {
        console.warn('Could not clear the saved unauthorized incidents:', error);
      });
  };

  const handleDispatchSecurity = (id: string) => {
    soundEngine.playWarningBeep();
    setIncidents((prev) =>
      prev.map((inc) =>
        inc.id === id
          ? {
              ...inc,
              status: 'DISPATCHED',
              operatorNotes: `[${new Date().toLocaleTimeString()}] Dispatch request logged for sector ${inc.zone}. No external dispatch integration is configured.`,
            }
          : inc
      )
    );
  };

  const handleForensicReviewComplete = (id: string) => {
    setIncidents((previous) => previous.map((incident) => incident.id === id
      ? {
          ...incident,
          status: 'FORENSIC_REVIEWED',
          operatorNotes: `${incident.operatorNotes ? `${incident.operatorNotes}\n` : ''}[${new Date().toLocaleString()}] Forensic review completed.`,
        }
      : incident
    ));
  };

  const updateSettingsPartial = (newSet: Partial<SurveillanceSettings>) => {
    setSettings((prev) => ({ ...prev, ...newSet }));
  };

  // Keep all hooks above this branch unconditional so the phone transmitter can
  // exit to the dashboard without changing App's hook order.
  if (isPhoneTransmitterMode) {
    return (
      <MobileCameraTransmitter
        initialChannelId={phonePairParams.channelId}
        initialPairCode={phonePairParams.pairCode}
        onExit={() => {
          if (typeof window !== 'undefined') {
            const url = new URL(window.location.href);
            url.searchParams.delete('phoneCam');
            url.searchParams.delete('code');
            window.history.replaceState({}, '', url.toString());
          }
          setIsPhoneTransmitterMode(false);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 flex flex-col font-sans antialiased selection:bg-zinc-900 selection:text-white">
      {/* Top Global Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        activeZone={settings.activeZone}
        setActiveZone={(zone) => updateSettingsPartial({ activeZone: zone })}
        isAudioMuted={isAudioMuted}
        setIsAudioMuted={setIsAudioMuted}
        isLockdownActive={isLockdownActive}
        setIsLockdownActive={(lockdown) => {
          requireAdmin(
            () => setIsLockdownActive(lockdown),
            lockdown
              ? 'Admin clearance required to trigger the local lockdown alert.'
              : 'Admin clearance required to deactivate the local lockdown alert.'
          );
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        activeIncidentCount={activeIncidentCount}
        currentThreatLevel={currentThreatLevel}
        isAutoScanning={settings.autoScan}
        isAdmin={isAdmin}
        adminUser={adminUser}
        onOpenAdminLogin={() => {
          setAdminPromptReason('');
          setIsAdminModalOpen(true);
        }}
      />

      {/* Real-time Flashing Intruder Alert Banner */}
      <AlertBanner
        activeIncidents={operationalIncidents}
        onAcknowledge={handleAcknowledgeIncident}
        onDispatchSecurity={handleDispatchSecurity}
        onViewDetails={(inc) => setInspectIncident(inc)}
        onSilenceAll={() => setIsAudioMuted(true)}
      />

      {incidentNotification && (
        <IncidentNotificationToast
          incident={incidentNotification.incident}
          count={incidentNotification.count}
          onView={() => {
            setActiveTab('incidents');
            setInspectIncident(incidentNotification.incident);
            dismissIncidentNotification();
          }}
          onDismiss={dismissIncidentNotification}
        />
      )}

      {/* Main Content Dashboard */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 space-y-5">
        {/* Top Metric Cards */}
        <StatsOverview
          totalScansCount={totalScansCount}
          authorizedMatchesCount={authorizedMatchesCount}
          unauthorizedBreachesCount={unauthorizedBreachesCount}
          authorizedPersonnelCount={authorizedPersonnel.length}
          currentThreatLevel={currentThreatLevel}
          activeZone={settings.activeZone}
        />

        {/* Dynamic Tab Views */}
        <div className={activeTab === 'live' ? 'contents' : 'hidden'} aria-hidden={activeTab !== 'live'}>
          <SurveillanceHUD
            authorizedPersonnel={authorizedPersonnel}
            isIdentityDirectoryReady={isIdentityDirectoryReady}
            settings={settings}
            onUpdateSettings={updateSettingsPartial}
            onScanComplete={handleScanComplete}
            isAnalyzing={isAnalyzing}
            setIsAnalyzing={setIsAnalyzing}
            selectedScenario={selectedScenario}
            setSelectedScenario={setSelectedScenario}
            onNavigateToDirectory={() => setActiveTab('directory')}
            onToggleCameraFeed={handleToggleCameraFeed}
            isAdmin={isAdmin}
            onRequireAdmin={requireAdmin}
            incidents={incidentLog}
            onViewIncident={(inc) => setInspectIncident(inc)}
            onNavigateToIncidents={() => setActiveTab('incidents')}
          />
        </div>

        {activeTab === 'incidents' && (
          <IncidentFeed
            incidents={incidentLog}
            authorizedPersonnel={authorizedPersonnel}
            todayPresenceRecords={todayPresenceRecords}
            currentPresence={currentPresence}
            onAcknowledge={handleAcknowledgeIncident}
            onResolve={handleResolveIncident}
            onDelete={handleDeleteIncident}
            onClearAll={handleClearAllIncidents}
            onViewDetails={(inc) => setInspectIncident(inc)}
            onDispatchTeam={handleDispatchSecurity}
            isAdmin={isAdmin}
            onRequireAdmin={requireAdmin}
          />
        )}

        {activeTab === 'directory' && (
          <PersonnelDirectory
            personnel={authorizedPersonnel}
            currentPresence={currentPresence}
            onAddPersonnel={handleAddPersonnel}
            onDeletePersonnel={handleDeletePersonnel}
            isAdmin={isAdmin}
            onRequireAdmin={requireAdmin}
          />
        )}
      </main>

      {/* Footer Status Strip */}
      <footer className="border-t border-zinc-200 bg-white py-3 text-center text-xs font-mono text-zinc-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-zinc-900 font-bold">Trinetra Surveillance Dashboard</span>
            <span>•</span>
            <span className="text-zinc-600">Local monitoring and incident log</span>
          </div>
          <div className="text-zinc-500">Live video and AI analysis depend on connected cameras and API configuration.</div>
        </div>
      </footer>

      {/* Modals & Overlays */}
      <IncidentDetailsModal
        incident={inspectIncident}
        onClose={() => setInspectIncident(null)}
        onAcknowledge={handleAcknowledgeIncident}
        onResolve={handleResolveIncident}
        onDispatchTeam={handleDispatchSecurity}
        onForensicReview={handleForensicReviewComplete}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={updateSettingsPartial}
        isAdmin={isAdmin}
        onRequireAdmin={requireAdmin}
        onOpenAdminLogin={() => {
          setAdminPromptReason('');
          setIsAdminModalOpen(true);
        }}
      />

      <LockdownOverlay
        isActive={isLockdownActive}
        onDeactivate={() => requireAdmin(
          () => setIsLockdownActive(false),
          'Admin clearance required to deactivate the local lockdown alert.'
        )}
        zone={settings.activeZone}
      />

      <AdminLoginModal
        isOpen={isAdminModalOpen}
        onClose={() => {
          setIsAdminModalOpen(false);
          pendingAdminActionRef.current = null;
        }}
        isAdmin={isAdmin}
        adminUser={adminUser}
        onLoginSuccess={handleLoginSuccess}
        onLogoutSuccess={handleLogoutSuccess}
        promptReason={adminPromptReason}
      />
    </div>
  );
}
