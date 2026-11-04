export type ClearanceLevel = 'Level 1 - Visitor' | 'Level 2 - Staff' | 'Level 3 - High Security' | 'Level 4 - Executive';

export type IdentificationStatus = 'AUTHORIZED' | 'UNAUTHORIZED' | 'UNKNOWN' | 'SUSPICIOUS';

export type ThreatLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type LayoutMode = 'grid' | 'focus' | 'single';

export type CameraFeedMode = 'webcam' | 'simulation' | 'upload' | 'phone_stream' | 'bluetooth' | 'ip_stream';

export interface BluetoothDeviceInfo {
  id: string;
  name: string;
  connected: boolean;
  batteryLevel?: number;
  rssi?: number;
  serviceUuids?: string[];
  type?: 'camera' | 'sensor' | 'ble_optical' | 'generic';
}

export interface PhoneStreamSession {
  pairCode: string;
  channelId: string;
  connected: boolean;
  deviceModel?: string;
  fps?: number;
  batteryLevel?: number;
  facingMode?: 'environment' | 'user';
  lastPing?: number;
}

export interface CameraChannel {
  id: string;
  channelNumber: number;
  name: string;
  zone: string;
  feedMode: CameraFeedMode;
  deviceId?: string;
  scenarioId?: string;
  customImageSrc?: string;
  streamUrl?: string;
  pairCode?: string;
  bluetoothDeviceName?: string;
  bluetoothDeviceId?: string;
  bluetoothConnected?: boolean;
  phoneConnected?: boolean;
  phoneDeviceModel?: string;
  lastFrameReceivedAt?: number;
  resolution: string;
  fps: number;
  status: 'ONLINE' | 'ACTIVE_SCAN' | 'ALERT' | 'OFFLINE';
  activeThreatLevel: ThreatLevel;
  lastScanResult?: ScanResult | null;
  isRecording?: boolean;
  nightVision?: boolean;
  ptzZoom?: number; // 1 to 3x
  lensType?: string;
  isClosed?: boolean;
}

export interface AuthorizedPerson {
  id: string;
  name: string;
  role: string;
  department: string;
  clearanceLevel: ClearanceLevel;
  photoUrl: string;
  description: string;
  registeredAt: string;
  accessZones: string[];
  faceEmbedding?: number[];
  faceEmbeddings?: number[][];
  notes?: string;
  keyBiometrics?: string[];
}

export interface DetectedFaceFeatures {
  ageEstimate?: string;
  genderEstimate?: string;
  accessories?: string[];
  expression?: string;
  headPose?: string;
}

export interface DetectedFace {
  id: string;
  localTrackId?: string;
  personId?: string;
  embedding?: number[];
  box_2d: [number, number, number, number]; // [ymin, xmin, ymax, xmax] 0-1000
  status: IdentificationStatus;
  matchedPersonnelId?: string | null;
  matchedName?: string;
  confidence: number;
  threatLevel: ThreatLevel;
  threatReason: string;
  features?: DetectedFaceFeatures;
  activityContext?: string;
  isProperlyVisible?: boolean;
  visibilityStatus?: 'CLEAR' | 'PARTIAL' | 'BLURRY' | 'OCCLUDED' | 'NOT_PROPERLY_VISIBLE';
  visibilityReason?: string;
  croppedFaceUrl?: string;
}

export interface ScanResult {
  scanId: string;
  timestamp: string;
  faces: DetectedFace[];
  sceneSummary: string;
  overallThreatLevel: ThreatLevel;
  recommendedAction: string;
  capturedFrameUrl: string;
  zone: string;
  channelId?: string;
  channelName?: string;
  channelNumber?: number;
  feedMode?: CameraFeedMode;
}

export interface LocationBreadcrumb {
  zone: string;
  channelId?: string;
  channelName?: string;
  channelNumber?: number;
  timestamp: string;
  firstSeenTimestamp?: string;
  sightingsCount?: number;
  capturedFrameUrl?: string;
}

export interface SecurityIncident {
  id: string;
  timestamp: string;
  zone: string;
  channelId?: string;
  channelName?: string;
  channelNumber?: number;
  threatLevel: ThreatLevel;
  title: string;
  description: string;
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'DISPATCHED' | 'RESOLVED' | 'DISMISSED' | 'FORENSIC_REVIEWED';
  capturedFrameUrl: string;
  croppedFaceUrl?: string;
  fullSceneFrameUrl?: string;
  subjectIndex?: number;
  totalSubjectsInScene?: number;
  faces: DetectedFace[];
  /** Private local reference descriptor for cross-camera unregistered-person matching. */
  identityEmbedding?: number[];
  /** A few additional views retained to match the same unregistered person at new angles. */
  identityEmbeddings?: number[][];
  recommendedAction: string;
  operatorNotes?: string;
  category?: 'BIOMETRIC_BREACH' | 'IDENTITY_REVIEW' | 'CAMERA_OFFLINE' | 'CAMERA_TAMPER' | 'MANUAL_ALERT';
  feedMode?: CameraFeedMode;
  // Cross-camera sighting aggregation and complete breadcrumb history
  sightingsCount?: number;
  firstSeenTimestamp?: string;
  lastSeenTimestamp?: string;
  isProperlyVisible?: boolean;
  visibilityStatus?: 'CLEAR' | 'PARTIAL' | 'BLURRY' | 'OCCLUDED' | 'NOT_PROPERLY_VISIBLE';
  visibilityReason?: string;
  faceKey?: string;
  // Complete breadcrumb movement history across all security cameras
  locationHistory?: LocationBreadcrumb[];
}

export interface SurveillanceSettings {
  autoScan: boolean;
  autoScanMode?: 'all' | 'sequential';
  scanIntervalSeconds: number;
  minConfidenceThreshold: number;
  audioAlerts: boolean;
  alertVolume: number;
  nightVisionMode: boolean;
  activeZone: string;
  showBoundingBoxes: boolean;
  showHudOverlay: boolean;
  autoLockdownOnCritical: boolean;
  securityMode: 'STANDARD' | 'HIGH_SECURITY' | 'MAXIMUM_RESTRICTION';
  speedPreset?: 'ULTRA_FAST' | 'BALANCED' | 'DEEP_SCAN';
}

export interface SampleScenario {
  id: string;
  title: string;
  category: 'AUTHORIZED' | 'UNAUTHORIZED' | 'SUSPICIOUS' | 'MIXED';
  description: string;
  imageUrl: string;
  zone: string;
  expectedOutcome: string;
}

export interface AdminUser {
  username: string;
  role: 'SYSTEM_ADMINISTRATOR' | 'SECURITY_CHIEF' | 'SUPER_ADMIN';
  loginTime: string;
  token?: string;
}

export interface AdminAuthState {
  isAdmin: boolean;
  user: AdminUser | null;
}
