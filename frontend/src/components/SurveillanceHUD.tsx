import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Camera, 
  Zap, 
  Play, 
  Pause, 
  Eye, 
  Crosshair, 
  Upload, 
  Layers, 
  Moon, 
  UserCheck, 
  UserX, 
  Maximize2, 
  Scan, 
  AlertCircle,
  Grid,
  Square,
  Columns,
  Radio,
  Sliders,
  ShieldCheck,
  ChevronRight,
  ZoomIn,
  RefreshCw,
  Volume2,
  SquareSquare,
  StopCircle,
  Smartphone,
  Bluetooth,
  Wifi,
  Power,
  ExternalLink,
  User,
  CheckCircle2,
  Clock,
  Activity
} from 'lucide-react';
import { 
  AuthorizedPerson, 
  DetectedFace, 
  ScanResult, 
  SurveillanceSettings, 
  SampleScenario,
  CameraChannel,
  LayoutMode,
  ThreatLevel,
  SecurityIncident
} from '@shared/types';
import { SAMPLE_SCENARIOS } from '../data/sampleScenarios';
import { DEFAULT_CAMERAS } from '../data/defaultCameras';
import { CameraTile } from './CameraTile';
import { BluetoothAndRemoteCameraModal } from './BluetoothAndRemoteCameraModal';
import { safeSetItem, safeGetItem, sanitizeCamerasForStorage } from '@shared/utils/storage';
import { soundEngine } from '../utils/audioAlert';
import { HostWebRTCReceiver } from '../utils/webrtc';
import { deduplicateFaces } from '../utils/faceDeduplication';
import { traceRuntimeEvent } from '../utils/runtimeDiagnostics';

interface SurveillanceHUDProps {
  authorizedPersonnel: AuthorizedPerson[];
  isIdentityDirectoryReady: boolean;
  settings: SurveillanceSettings;
  onUpdateSettings: (newSettings: Partial<SurveillanceSettings>) => void;
  onScanComplete: (result: ScanResult, imageBase64: string) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (analyzing: boolean) => void;
  selectedScenario: SampleScenario | null;
  setSelectedScenario: (scenario: SampleScenario | null) => void;
  onNavigateToDirectory?: () => void;
  onToggleCameraFeed?: (camera: CameraChannel, explicitClosedState?: boolean) => void;
  isAdmin?: boolean;
  onRequireAdmin?: (actionCallback: () => void, promptReason: string) => void;
  incidents?: SecurityIncident[];
  onViewIncident?: (incident: SecurityIncident) => void;
  onNavigateToIncidents?: () => void;
}

function cameraAccessErrorMessage(error: unknown): string {
  const name = error && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name || '')
    : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Camera permission is blocked. Allow camera access for localhost in your browser and macOS Privacy & Security settings, then retry.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No laptop camera was found. Check that a camera is connected and enabled in macOS settings.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'The camera is busy in another app. Close FaceTime, Zoom, or other apps using it, then retry.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'The selected camera is no longer available. Choose the laptop camera again and retry.';
  }
  return `Camera could not start${name ? ` (${name})` : ''}. Check browser and macOS camera permissions, then retry.`;
}

const ACTIVE_WEBCAM_CHANNELS_KEY = 'trinetra_active_webcams_v1';

function getActiveWebcamChannelIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(ACTIVE_WEBCAM_CHANNELS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function setWebcamChannelActive(channelId: string, isActive: boolean): void {
  if (typeof window === 'undefined') return;
  const activeIds = new Set(getActiveWebcamChannelIds());
  if (isActive) activeIds.add(channelId);
  else activeIds.delete(channelId);
  try {
    window.sessionStorage.setItem(ACTIVE_WEBCAM_CHANNELS_KEY, JSON.stringify(Array.from(activeIds)));
  } catch {
    // The in-memory stream continues working if session storage is unavailable.
  }
}

export const SurveillanceHUD: React.FC<SurveillanceHUDProps> = ({
  authorizedPersonnel,
  isIdentityDirectoryReady,
  settings,
  onUpdateSettings,
  onScanComplete,
  isAnalyzing,
  setIsAnalyzing,
  selectedScenario,
  setSelectedScenario,
  onNavigateToDirectory,
  onToggleCameraFeed,
  isAdmin = false,
  onRequireAdmin,
  incidents = [],
  onViewIncident,
  onNavigateToIncidents,
}) => {
  // Multi-Camera Grid State
  const [cameras, setCameras] = useState<CameraChannel[]>(() => {
    const saved = safeGetItem('trinetra_cameras');
    if (saved) {
      try {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((camera: any) =>
            camera && typeof camera.id === 'string' && typeof camera.name === 'string' &&
            typeof camera.zone === 'string' && Number.isFinite(camera.channelNumber) &&
            ['webcam', 'simulation', 'upload', 'phone_stream', 'bluetooth', 'ip_stream'].includes(camera.feedMode) &&
            ['ONLINE', 'ACTIVE_SCAN', 'ALERT', 'OFFLINE'].includes(camera.status)
          );
          if (valid.length > 0) {
            // Persist camera configuration, but never trust cached detections
            // after a reload: their boxes may belong to a previous feed source.
            // Resume webcams only when the user explicitly opened them earlier
            // in this same browser tab.
            const activeWebcamIds = new Set(getActiveWebcamChannelIds());
            return valid.map((camera) => {
              const resumeWebcam = camera.feedMode === 'webcam' &&
                !camera.isClosed && activeWebcamIds.has(camera.id);
              const feedMode = camera.feedMode === 'webcam' && !resumeWebcam ? 'simulation' : camera.feedMode;
              return {
                ...camera,
                feedMode,
                customImageSrc: feedMode === 'simulation' ? undefined : camera.customImageSrc,
                lastScanResult: null,
                activeThreatLevel: 'NONE' as const,
                status: camera.isClosed ? 'OFFLINE' as const : 'ONLINE' as const,
              };
            });
          }
        }
      } catch (e) {
        console.warn('Failed to parse saved cameras:', e);
      }
    }
    return DEFAULT_CAMERAS;
  });

  const [selectedCameraId, setSelectedCameraId] = useState<string>(() =>
    cameras.find((camera) => camera.zone === settings.activeZone)?.id ||
    (cameras.some((camera) => camera.id === 'cam-1') ? 'cam-1' : cameras[0].id)
  );
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('grid'); // 'grid' (2x2) | 'focus' (1+3) | 'single'
  const [scanningChannelId, setScanningChannelId] = useState<string | null>(null);
  const [scanningChannelIds, setScanningChannelIds] = useState<Set<string>>(() => new Set());
  const [isRemoteModalOpen, setIsRemoteModalOpen] = useState<boolean>(false);

  // Hardware webcam state
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [webcamStreams, setWebcamStreams] = useState<Record<string, MediaStream>>({});
  const [webcamStartingCameraIds, setWebcamStartingCameraIds] = useState<Set<string>>(() => new Set());
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [webRtcStreams, setWebRtcStreams] = useState<Record<string, MediaStream>>({});

  // Face inspector
  const [selectedFaceDetail, setSelectedFaceDetail] = useState<DetectedFace | null>(null);
  const [nextScanCountdown, setNextScanCountdown] = useState<number>(settings.scanIntervalSeconds);
  const [isQuotaFailover, setIsQuotaFailover] = useState<boolean>(false);
  const [currentAutoScanChannelIdx, setCurrentAutoScanChannelIdx] = useState<number>(0);

  // References for pure, decoupled async operations
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autoScanTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const camerasRef = useRef<CameraChannel[]>(cameras);
  camerasRef.current = cameras;

  const webcamStreamsRef = useRef<Record<string, MediaStream>>(webcamStreams);
  webcamStreamsRef.current = webcamStreams;
  const webcamResumeAttemptedRef = useRef<Set<string>>(new Set());
  const webcamStartInFlightRef = useRef<Set<string>>(new Set());
  const webcamDeviceReservationsRef = useRef<Map<string, string>>(new Map());
  const webcamReconnectTimersRef = useRef<Map<string, number>>(new Map());
  const webcamReconnectAttemptsRef = useRef<Map<string, number>>(new Map());
  const webcamLastStartAtRef = useRef<Map<string, number>>(new Map());
  const scheduleWebcamReconnectRef = useRef<(cameraId: string) => void>(() => {});

  const authorizedPersonnelRef = useRef<AuthorizedPerson[]>(authorizedPersonnel);
  authorizedPersonnelRef.current = authorizedPersonnel;

  const settingsRef = useRef<SurveillanceSettings>(settings);
  settingsRef.current = settings;

  const isAnalyzingRef = useRef<boolean>(isAnalyzing);
  isAnalyzingRef.current = isAnalyzing;

  const onScanCompleteRef = useRef(onScanComplete);
  onScanCompleteRef.current = onScanComplete;

  const currentAutoScanChannelIdxRef = useRef<number>(0);
  const isScanningAbortedRef = useRef<boolean>(false);
  const inFlightScansRef = useRef<Set<string>>(new Set());

  // Save cameras state safely without exceeding browser storage quota
  useEffect(() => {
    safeSetItem('trinetra_cameras', sanitizeCamerasForStorage(cameras));
  }, [cameras]);

  // Selected camera reference
  const activeCamera = cameras.find((c) => c.id === selectedCameraId) || cameras[0];
  const getWebcamStreamForCamera = (camera: CameraChannel) =>
    webcamStreams[`channel:${camera.id}`] ||
    (camera.deviceId ? webcamStreams[camera.deviceId] : null) ||
    (!camera.deviceId && selectedDeviceId ? webcamStreams[selectedDeviceId] : null) || null;

  useEffect(() => {
    const zoneCamera = camerasRef.current.find((camera) => camera.zone === settings.activeZone);
    if (zoneCamera) setSelectedCameraId(zoneCamera.id);
  }, [settings.activeZone]);

  // List available video devices
  useEffect(() => {
    async function getDevices() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoInputs = devices.filter((d) => d.kind === 'videoinput');
          setCameraDevices(videoInputs);
          if (videoInputs.length > 0 && !selectedDeviceId) {
            setSelectedDeviceId(videoInputs[0].deviceId);
          }
        }
      } catch (err) {
        console.warn('Unable to enumerate camera devices:', err);
      }
    }
    getDevices();
  }, []);

  const deviceListSignature = cameraDevices.map((device) => device.deviceId).join('|');
  const cameraSourceSignature = cameras
    .map((camera) => `${camera.id}:${camera.feedMode}:${camera.deviceId || ''}:${camera.isClosed ? 'closed' : 'open'}`)
    .join('|');

  useEffect(() => {
    if (cameraDevices.length === 0) return;

    const occupiedDeviceIds = new Set<string>();
    const camerasNeedingDevice = new Set<string>();
    for (const camera of camerasRef.current) {
      if (camera.feedMode !== 'webcam' || camera.isClosed) continue;
      if (!camera.deviceId || occupiedDeviceIds.has(camera.deviceId)) {
        camerasNeedingDevice.add(camera.id);
      } else {
        occupiedDeviceIds.add(camera.deviceId);
      }
    }
    const availableDeviceIds = cameraDevices
      .map((device) => device.deviceId)
      .filter((deviceId) => deviceId && !occupiedDeviceIds.has(deviceId));
    const unassignedCameraIds = Array.from(camerasNeedingDevice);

    if (unassignedCameraIds.length === 0) return;
    if (availableDeviceIds.length < unassignedCameraIds.length) {
      setCameraError('Each live camera needs its own video device. Assign another physical, phone, or IP camera to the remaining channels.');
    }

    let deviceIndex = 0;
    setCameras((previous) => previous.map((camera) => {
      if (!unassignedCameraIds.includes(camera.id)) return camera;
      const deviceId = availableDeviceIds[deviceIndex++];
      return deviceId
        ? { ...camera, deviceId, lastScanResult: null }
        : { ...camera, deviceId: undefined, lastScanResult: null };
    }));
  }, [deviceListSignature, cameraSourceSignature]);

  useEffect(() => () => {
    for (const timerId of webcamReconnectTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    webcamReconnectTimersRef.current.clear();
    const streams = Object.values(webcamStreamsRef.current);
    if (streams.length > 0) {
      traceRuntimeEvent('camera.stream.componentUnmount', { streamCount: streams.length });
    }
    streams.forEach((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
  }, []);

  const clearWebcamReconnect = useCallback((cameraId: string) => {
    const timerId = webcamReconnectTimersRef.current.get(cameraId);
    if (timerId !== undefined) window.clearTimeout(timerId);
    webcamReconnectTimersRef.current.delete(cameraId);
    webcamReconnectAttemptsRef.current.delete(cameraId);
    webcamLastStartAtRef.current.delete(cameraId);
    setWebcamStartingCameraIds((previous) => {
      if (!previous.has(cameraId)) return previous;
      const next = new Set(previous);
      next.delete(cameraId);
      return next;
    });
  }, []);

  const stopWebcamStreamForChannel = useCallback((channelId: string) => {
    clearWebcamReconnect(channelId);
    const channel = camerasRef.current.find((camera) => camera.id === channelId);
    const currentStreams = webcamStreamsRef.current;
    const ownedKeys = Object.keys(currentStreams).filter((key) =>
      key === `channel:${channelId}` || Boolean(channel?.deviceId && key === channel.deviceId)
    );
    if (ownedKeys.length === 0) return;

    traceRuntimeEvent('camera.stream.explicitStop', { channelId, keys: ownedKeys });
    setWebcamChannelActive(channelId, false);
    for (const [deviceId, reservedChannelId] of webcamDeviceReservationsRef.current) {
      if (reservedChannelId === channelId) webcamDeviceReservationsRef.current.delete(deviceId);
    }
    const nextStreams = { ...currentStreams };
    for (const key of ownedKeys) {
      nextStreams[key].getTracks().forEach((track) => track.stop());
      delete nextStreams[key];
    }
    webcamStreamsRef.current = nextStreams;
    setWebcamStreams(nextStreams);
  }, [clearWebcamReconnect]);

  // Update specific camera channel
  const handleUpdateChannel = useCallback((channelId: string, updates: Partial<CameraChannel>) => {
    const hasOwn = (key: keyof CameraChannel) => Object.prototype.hasOwnProperty.call(updates, key);
    const currentChannel = camerasRef.current.find((camera) => camera.id === channelId);
    const isLeavingWebcam = currentChannel?.feedMode === 'webcam' && (
      (hasOwn('feedMode') && updates.feedMode !== 'webcam') || updates.isClosed === true
    );
    if (isLeavingWebcam) stopWebcamStreamForChannel(channelId);
    if (currentChannel && (
      (hasOwn('feedMode') && updates.feedMode !== currentChannel.feedMode) ||
      (hasOwn('isClosed') && updates.isClosed !== currentChannel.isClosed)
    )) {
      traceRuntimeEvent('camera.channel.sourceChanged', {
        channelId,
        fromFeedMode: currentChannel.feedMode,
        toFeedMode: hasOwn('feedMode') ? updates.feedMode : currentChannel.feedMode,
        fromClosed: currentChannel.isClosed,
        toClosed: hasOwn('isClosed') ? updates.isClosed : currentChannel.isClosed,
      });
    }
    if ((hasOwn('feedMode') && updates.feedMode !== 'webcam') || updates.isClosed === true) {
      setWebcamChannelActive(channelId, false);
    }
    if (typeof updates.deviceId === 'string') {
      const assignedElsewhere = camerasRef.current.some((camera) =>
        camera.id !== channelId && camera.feedMode === 'webcam' && !camera.isClosed && camera.deviceId === updates.deviceId
      );
      if (assignedElsewhere) {
        setCameraError('This camera device is already assigned to another live channel. Choose a different device for each camera.');
        return;
      }
      setSelectedDeviceId(updates.deviceId);
      setCameraError(null);
    }
    setCameras((previous) => previous.map((camera) => {
      if (camera.id !== channelId) return camera;
      const feedModeChanged = hasOwn('feedMode') && updates.feedMode !== camera.feedMode;
      const sourceChanged = feedModeChanged ||
        (hasOwn('scenarioId') && updates.scenarioId !== camera.scenarioId) ||
        (hasOwn('customImageSrc') && updates.customImageSrc !== camera.customImageSrc) ||
        (hasOwn('streamUrl') && updates.streamUrl !== camera.streamUrl) ||
        (hasOwn('deviceId') && updates.deviceId !== camera.deviceId);
      const cameraIsClosed = updates.isClosed ?? camera.isClosed;

      return {
        ...camera,
        ...updates,
        ...(feedModeChanged && !hasOwn('customImageSrc') ? { customImageSrc: undefined } : {}),
        ...(sourceChanged ? {
          lastScanResult: null,
          activeThreatLevel: 'NONE' as const,
          status: cameraIsClosed ? 'OFFLINE' as const : 'ONLINE' as const,
        } : {}),
      };
    }));
  }, [clearWebcamReconnect, stopWebcamStreamForChannel]);

  // Toggle camera feed closed / open for any zone
  const handleToggleChannelFeed = useCallback((channelId: string, explicitClosedState?: boolean) => {
    const current = camerasRef.current.find((c) => c.id === channelId);
    if (!current) return;
    const nextClosed = explicitClosedState !== undefined ? explicitClosedState : !current.isClosed;

    const applyToggle = () => {
      handleUpdateChannel(channelId, {
        isClosed: nextClosed,
        status: nextClosed ? 'OFFLINE' : 'ONLINE',
        activeThreatLevel: 'NONE',
        lastScanResult: nextClosed ? null : current.lastScanResult,
      });

      // If the closed camera is the currently selected camera, automatically switch selection to the next open camera!
      if (nextClosed && selectedCameraId === channelId) {
        const nextOpenCam = camerasRef.current.find((c) => c.id !== channelId && !c.isClosed && c.status !== 'OFFLINE');
        if (nextOpenCam) {
          setSelectedCameraId(nextOpenCam.id);
          onUpdateSettings({ activeZone: nextOpenCam.zone });
        }
      }

      if (onToggleCameraFeed) {
        onToggleCameraFeed({ ...current, isClosed: nextClosed, status: nextClosed ? 'OFFLINE' : 'ONLINE' }, nextClosed);
      }
    };

    if (!isAdmin && onRequireAdmin) {
      onRequireAdmin(
        applyToggle,
        `${nextClosed ? 'Closing' : 'restoring'} ${current.name} requires administrator clearance.`
      );
      return;
    }
    applyToggle();
  }, [handleUpdateChannel, onToggleCameraFeed, selectedCameraId, onUpdateSettings, isAdmin, onRequireAdmin]);

  // Real-time Phone Camera Stream Connection Monitor & WebRTC P2P Receiver
  useEffect(() => {
    const phoneChannels = cameras.filter((c) => c.feedMode === 'phone_stream');
    if (phoneChannels.length === 0) return;

    const receivers: Map<string, HostWebRTCReceiver> = new Map();

    phoneChannels.forEach((ch) => {
      const pairCode = ch.pairCode || 'PHONE-1';
      const receiver = new HostWebRTCReceiver(
        pairCode,
        (stream) => {
          setWebRtcStreams((prev) => ({ ...prev, [ch.id]: stream }));
          handleUpdateChannel(ch.id, {
            phoneConnected: true,
            lastFrameReceivedAt: Date.now(),
          });
        },
        (status, isConnected) => {
          if (isConnected) {
            handleUpdateChannel(ch.id, {
              phoneConnected: true,
              lastFrameReceivedAt: Date.now(),
            });
          }
        }
      );
      receiver.startListening();
      receivers.set(ch.id, receiver);
    });

    let isMounted = true;
    let timeoutId: any = null;

    const pollPhoneStreams = async () => {
      if (!isMounted) return;

      for (const ch of phoneChannels) {
        const pairCode = ch.pairCode || 'PHONE-1';
        try {
          const res = await fetch(`/api/phone-camera/status/${pairCode}`, {
            cache: 'no-store',
          });
          const json = await res.json();
          if (json.online) {
            handleUpdateChannel(ch.id, {
              phoneConnected: true,
              phoneDeviceModel: json.deviceModel || ch.phoneDeviceModel,
              lastFrameReceivedAt: Date.now(),
            });
          } else {
            // If WebRTC is also not streaming, mark offline
            if (ch.phoneConnected && !webRtcStreams[ch.id]) {
              handleUpdateChannel(ch.id, {
                phoneConnected: false,
                lastFrameReceivedAt: 0,
              });
            }
          }
        } catch (e) {
          // ignore transient network hiccups
        }
      }

      if (isMounted) {
        timeoutId = setTimeout(pollPhoneStreams, 1500);
      }
    };

    pollPhoneStreams();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      receivers.forEach((r) => r.destroy());
    };
  }, [cameras.map((c) => `${c.id}:${c.feedMode}:${c.pairCode}`).join(','), handleUpdateChannel]);

  // Helper to extract 16:9 cropped viewport matching CameraTile's object-cover layout
  const extract16x9ViewportFrame = (
    source: HTMLVideoElement | HTMLImageElement,
    srcW: number,
    srcH: number,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    zoomLevel = 1,
  ): string => {
    const targetAspect = 16 / 9;
    const srcAspect = srcW / srcH;
    let sx = 0;
    let sy = 0;
    let sw = srcW;
    let sh = srcH;

    if (srcAspect > targetAspect) {
      // Wider than 16:9 -> crop horizontal edges evenly
      sw = Math.round(srcH * targetAspect);
      sx = Math.round((srcW - sw) / 2);
    } else if (srcAspect < targetAspect) {
      // Taller than 16:9 (e.g. 4:3 or portrait) -> crop vertical edges evenly (matching object-cover)
      sh = Math.round(srcW / targetAspect);
      sy = Math.round((srcH - sh) / 2);
    }

    // Match the camera tile's center PTZ zoom in the analyzed frame too.
    // Previously the preview zoomed, while face detection still received the
    // full, unzoomed sensor frame, making distant faces just as small to AI.
    const zoom = Math.max(1, Math.min(3, Number.isFinite(zoomLevel) ? zoomLevel : 1));
    if (zoom > 1) {
      const zoomedWidth = sw / zoom;
      const zoomedHeight = sh / zoom;
      sx += (sw - zoomedWidth) / 2;
      sy += (sh - zoomedHeight) / 2;
      sw = zoomedWidth;
      sh = zoomedHeight;
    }

    // Keep the camera's native detail up to 720p. The old 640x360 / 0.65
    // export blurred faces before they reached detection and identity matching.
    const scale = Math.min(1, 1280 / sw, 720 / sh);
    const outputWidth = Math.max(1, Math.round(sw * scale));
    const outputHeight = Math.max(1, Math.round(sh * scale));
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight);
    return canvas.toDataURL('image/jpeg', 0.88);
  };

  // Capture frame for a specific camera channel
  const captureChannelFrame = useCallback(async (channel: CameraChannel): Promise<string | null> => {
    try {
      const canvas = canvasRef.current || document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      if (channel.feedMode === 'webcam') {
        // Find active playing video element on DOM for this specific channel or any active video
        const targetTile = document.getElementById(`camera-tile-${channel.id}`);
        const localVideo = targetTile ? targetTile.querySelector('video') : null;
        
        if (localVideo && localVideo.videoWidth > 0 && localVideo.readyState >= 2) {
          return extract16x9ViewportFrame(localVideo, localVideo.videoWidth, localVideo.videoHeight, canvas, ctx, channel.ptzZoom);
        }

        // If video element on DOM is warming up, capture directly from webcamStream
        const channelStream = webcamStreams[`channel:${channel.id}`] ||
          (channel.deviceId ? webcamStreams[channel.deviceId] : null);
        if (channelStream) {
          const videoElem = document.createElement('video');
          videoElem.srcObject = channelStream;
          videoElem.muted = true;
          videoElem.playsInline = true;
          await new Promise<void>((resolve) => {
            videoElem.onloadedmetadata = async () => {
              await videoElem.play().catch(() => {});
              resolve();
            };
            setTimeout(resolve, 250);
          });

          const vW = videoElem.videoWidth || 640;
          const vH = videoElem.videoHeight || 360;
          return extract16x9ViewportFrame(videoElem, vW, vH, canvas, ctx, channel.ptzZoom);
        }
        return null;
      } else if (channel.feedMode === 'phone_stream') {
        // Priority 1: Instant zero-latency frame directly from WebRTC <video> element
        const targetTile = document.getElementById(`camera-tile-${channel.id}`);
        const videoElem = targetTile ? targetTile.querySelector('video') : null;
        if (videoElem && videoElem.videoWidth > 0 && videoElem.readyState >= 2) {
          const dataUrl = extract16x9ViewportFrame(videoElem, videoElem.videoWidth, videoElem.videoHeight, canvas, ctx, channel.ptzZoom);
          if (dataUrl && dataUrl.length > 300) {
            return dataUrl;
          }
        }

        // Priority 2: Direct frame grab from live MJPEG image tile
        const imgElem = targetTile ? targetTile.querySelector('img') : null;
        if (imgElem && imgElem.naturalWidth > 0) {
          try {
            const dataUrl = extract16x9ViewportFrame(imgElem, imgElem.naturalWidth, imgElem.naturalHeight, canvas, ctx, channel.ptzZoom);
            if (dataUrl && dataUrl.length > 300) {
              return dataUrl;
            }
          } catch (canvasErr) {
            // cross-origin canvas export fallback to server endpoint
          }
        }

        // Priority 3: Fall back to latest server frame buffer
        try {
          const res = await fetch(`/api/phone-camera/latest-frame/${channel.pairCode || 'PHONE-1'}`, {
            cache: 'no-store',
          });
          const json = await res.json();
          if (json.success && json.online && json.data && json.data.frameBase64) {
            return json.data.frameBase64;
          }
        } catch (e) {
          console.warn('Failed to pull phone frame:', e);
        }
        return null;
      } else if (channel.feedMode === 'ip_stream') {
        return channel.streamUrl || channel.customImageSrc || null;
      } else if (channel.feedMode === 'upload' && channel.customImageSrc) {
        return channel.customImageSrc;
      } else if (channel.feedMode === 'bluetooth') {
        // BLE pairing provides device telemetry only. Use an OS camera input for
        // video, since browsers do not expose a BLE camera's image stream here.
        return channel.customImageSrc || null;
      } else {
        // Simulation Scenario - try to grab rendered image from DOM canvas or fallback to scenario URL
        const targetTile = document.getElementById(`camera-tile-${channel.id}`);
        const imgElem = targetTile ? targetTile.querySelector('img') : null;
        if (imgElem && imgElem.naturalWidth > 0 && imgElem.complete) {
          try {
            const dataUrl = extract16x9ViewportFrame(imgElem, imgElem.naturalWidth, imgElem.naturalHeight, canvas, ctx, channel.ptzZoom);
            if (dataUrl && dataUrl.length > 500) {
              return dataUrl;
            }
          } catch (canvasErr) {
            // If cross-origin prevents canvas export, fallback to direct URL
          }
        }
        const scenario = SAMPLE_SCENARIOS.find((s) => s.id === channel.scenarioId) || SAMPLE_SCENARIOS[0];
        return scenario.imageUrl;
      }
    } catch (err) {
      console.warn('Frame capture error:', err);
      return null;
    }
  }, [webcamStreams, selectedDeviceId]);

  // Execute optical scan on a single camera channel
  const executeScanOnChannel = useCallback(async (channelId: string, isBatch = false) => {
    if (isScanningAbortedRef.current && !isBatch) return;
    if (inFlightScansRef.current.has(channelId)) return;
    const currentCams = camerasRef.current;
    const targetChannel = currentCams.find((c) => c.id === channelId);
    if (!targetChannel) return;
    if (targetChannel.isClosed || targetChannel.status === 'OFFLINE') return;
    if (targetChannel.feedMode !== 'simulation' && !isIdentityDirectoryReady) {
      setCameraError('Syncing authorized face profiles. Live scans will start as soon as identity matching is ready.');
      return;
    }

    inFlightScansRef.current.add(channelId);
    setScanningChannelIds((current) => new Set(current).add(channelId));
    try {
      if (!isBatch) {
        isScanningAbortedRef.current = false;
        setScanningChannelId(channelId);
        setIsAnalyzing(true);
      }

      const frameBase64 = await captureChannelFrame(targetChannel);
      // Do not ask the server to analyze an empty phone frame. The API returns a
      // current frame only when the paired transmitter is online.
      if (!frameBase64) {
        if (targetChannel.feedMode === 'phone_stream') {
          handleUpdateChannel(channelId, { phoneConnected: false, lastFrameReceivedAt: 0 });
          setCameraError('No frame is arriving from the paired phone. Reconnect its transmitter and try again.');
        } else if (targetChannel.feedMode === 'ip_stream') {
          setCameraError('This IP camera has no image URL. Configure a direct image or snapshot URL first.');
        } else if (targetChannel.feedMode === 'bluetooth') {
          setCameraError('No image is available from this Bluetooth device. Connect a camera source or choose a snapshot.');
        } else if (targetChannel.feedMode === 'upload') {
          setCameraError('Upload a JPG or PNG snapshot before scanning this camera.');
        } else {
          setCameraError('No video frame is available. Check camera permission and select an available camera.');
        }
        if (!isBatch) {
          setIsAnalyzing(false);
          setScanningChannelId(null);
        }
        return;
      }

      const response = await fetch('/api/surveillance/analyze-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: frameBase64,
          scenarioId: targetChannel.scenarioId,
          feedMode: targetChannel.feedMode,
          pairCode: targetChannel.pairCode || 'PHONE-1',
          authorizedPersonnel: authorizedPersonnelRef.current.map(({ id, name, role, department, clearanceLevel, accessZones }) => ({
            id,
            name,
            role,
            department,
            clearanceLevel,
            accessZones,
          })),
          currentZone: targetChannel.zone,
          channelId: targetChannel.id,
          securityLevel: settingsRef.current.securityMode,
        }),
      });

      if (isScanningAbortedRef.current) return;

      const json = await response.json().catch(() => ({}));
      if (isScanningAbortedRef.current) return;

      if (!response.ok || !json.success || !json.data) {
        setCameraError(json.error || `Scan failed (${response.status}). Check the camera feed and server status.`);
        return;
      }
      setCameraError(json.quotaNotice || null);

      if (json.success && json.data) {
        setIsQuotaFailover(!!json.isQuotaFallback);

        const rawFaces = json.data.detectedFaces || [];
        const cleanedFaces = deduplicateFaces(rawFaces);

        const facesWithIds = cleanedFaces.map((f: any, idx: number) => ({
          ...f,
          id: f.id || `face-${channelId}-${idx}-${f.box_2d ? f.box_2d.join('_') : idx}`,
          personId: f.personId || f.matchedPersonnelId || undefined,
        }));

        const result: ScanResult = {
          scanId: json.scanId,
          timestamp: json.timestamp,
          faces: facesWithIds,
          sceneSummary: json.data.sceneSummary || `Surveillance monitoring active on ${targetChannel.name}`,
          overallThreatLevel: json.data.overallThreatLevel || 'NONE',
          recommendedAction: json.data.recommendedAction || 'Normal surveillance state',
          capturedFrameUrl: frameBase64,
          zone: targetChannel.zone,
          channelId: targetChannel.id,
          channelName: targetChannel.name,
          channelNumber: targetChannel.channelNumber,
          feedMode: targetChannel.feedMode,
        };

        // Check if channel was closed or set offline while scan was in-flight
        const freshCam = camerasRef.current.find((c) => c.id === channelId);
        if (!freshCam || freshCam.isClosed || freshCam.status === 'OFFLINE') {
          return;
        }

        // Update channel's scan result and threat level
        handleUpdateChannel(channelId, {
          lastScanResult: result,
          activeThreatLevel: result.overallThreatLevel,
          status: result.overallThreatLevel === 'CRITICAL' || result.overallThreatLevel === 'HIGH' ? 'ALERT' : 'ONLINE',
        });

        // Notify global incident logger ONLY if camera is open and active
        await onScanCompleteRef.current(result, frameBase64);

        if (targetChannel.id === selectedCameraId && facesWithIds.length > 0) {
          setSelectedFaceDetail(facesWithIds[0]);
        }
      }
    } catch (err) {
      console.warn('Channel scan completed via internal failover', err);
      setCameraError(err instanceof Error ? err.message : 'Scan failed. Check the server and camera connection.');
    } finally {
      inFlightScansRef.current.delete(channelId);
      setScanningChannelIds((current) => {
        const next = new Set(current);
        next.delete(channelId);
        return next;
      });
      if (!isBatch) {
        setIsAnalyzing(false);
        setScanningChannelId(null);
      }
    }
  }, [
    captureChannelFrame,
    setIsAnalyzing,
    handleUpdateChannel,
    selectedCameraId,
    isIdentityDirectoryReady,
  ]);

  // Scan active channels with intelligent stagger & active channel priority
  const executeScanAllChannels = useCallback(async (includeSimulation = true) => {
    if (isAnalyzingRef.current) return;
    isScanningAbortedRef.current = false;
    setIsAnalyzing(true);
    const currentCams = camerasRef.current;
    
    // Always scan selected/focused camera first, then remaining cameras
    const sortedCams = [...currentCams].sort((a, b) => {
      if (a.id === selectedCameraId) return -1;
      if (b.id === selectedCameraId) return 1;
      return 0;
    });

    // Scan all available open/online cameras
    const availableCams = sortedCams.filter((c) =>
      !c.isClosed && c.status !== 'OFFLINE' && (includeSimulation || c.feedMode !== 'simulation')
    );
    const targetCamsToScan = availableCams;
    setScanningChannelIds(new Set(targetCamsToScan.map((camera) => camera.id)));

    // Scan every independent physical camera channel. Results stay attached to
    // the camera that produced the frame, so locations never get copied.
    const webcamCams = targetCamsToScan.filter((c) => c.feedMode === 'webcam');
    const distinctCams = targetCamsToScan.filter((c) => c.feedMode !== 'webcam');

    // Run scans concurrently in parallel for instant response
    const scanPromises: Promise<any>[] = [];

    if (webcamCams.length > 0) {
      const primaryWebcam = webcamCams.find((c) => c.id === selectedCameraId) || webcamCams[0];
      setScanningChannelId(primaryWebcam.id);
      for (const camera of webcamCams) {
        scanPromises.push(executeScanOnChannel(camera.id, true));
      }
    }

    for (const cam of distinctCams) {
      scanPromises.push(executeScanOnChannel(cam.id, true));
    }

    try {
      await Promise.allSettled(scanPromises);
    } catch (err) {
      console.warn('Parallel scan error:', err);
    }

    setIsAnalyzing(false);
    setScanningChannelId(null);
    setScanningChannelIds(new Set());
    setNextScanCountdown(settingsRef.current.scanIntervalSeconds);
  }, [executeScanOnChannel, setIsAnalyzing, selectedCameraId]);

  // Stop scanning immediately and pause auto-scan loop
  const handleStopScanning = useCallback(() => {
    isScanningAbortedRef.current = true;
    soundEngine.stopAllSpeech();
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (autoScanTimerRef.current) clearInterval(autoScanTimerRef.current);
    setIsAnalyzing(false);
    setScanningChannelId(null);
    onUpdateSettings({ autoScan: false });
  }, [setIsAnalyzing, onUpdateSettings]);

  // Initial automatic startup scan
  useEffect(() => {
    const timer = setTimeout(() => {
      if (settingsRef.current.autoScan) executeScanAllChannels(false);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Multi-Camera Auto-Scan loop
  useEffect(() => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    if (autoScanTimerRef.current) clearInterval(autoScanTimerRef.current);

    if (settings.autoScan) {
      countdownIntervalRef.current = setInterval(() => {
        setNextScanCountdown((prev) => (prev <= 1 ? settings.scanIntervalSeconds : prev - 1));
      }, 1000);

      autoScanTimerRef.current = setInterval(() => {
        if (isAnalyzingRef.current) return;
        const currentCams = camerasRef.current;
        if (currentCams.length === 0) return;

        if (settings.autoScanMode === 'sequential') {
          const openCams = currentCams.filter((c) =>
            !c.isClosed && c.status !== 'OFFLINE' && c.feedMode !== 'simulation'
          );
          if (openCams.length === 0) return;
          const nextIdx = currentAutoScanChannelIdxRef.current % openCams.length;
          currentAutoScanChannelIdxRef.current = nextIdx;
          setCurrentAutoScanChannelIdx((nextIdx + 1) % openCams.length);
          currentAutoScanChannelIdxRef.current = (nextIdx + 1) % openCams.length;

          const nextCam = openCams[nextIdx];
          if (nextCam) {
            executeScanOnChannel(nextCam.id);
          }
        } else {
          // Default: Scan ALL open channels simultaneously so every camera traces faces & alerts
          executeScanAllChannels(false);
        }
      }, settings.scanIntervalSeconds * 1000);
    }

    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
      if (autoScanTimerRef.current) clearInterval(autoScanTimerRef.current);
    };
  }, [settings.autoScan, settings.autoScanMode, settings.scanIntervalSeconds, executeScanOnChannel, executeScanAllChannels]);

  // Upload photo to active channel
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isSupportedImage = ['image/jpeg', 'image/png'].includes(file.type) || /\.(jpe?g|png)$/i.test(file.name);
    if (!isSupportedImage || file.size > 10 * 1024 * 1024) {
      setCameraError(!isSupportedImage ? 'Upload a JPG or PNG snapshot.' : 'Snapshot must be 10 MB or smaller.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;
      setCameraError(null);
      handleUpdateChannel(selectedCameraId, {
        feedMode: 'upload',
        customImageSrc: dataUrl,
      });
      setTimeout(() => {
        executeScanOnChannel(selectedCameraId);
      }, 300);
    };
    reader.onerror = () => setCameraError('Could not read that snapshot. Try another image.');
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // Start and toggle are separate operations. Reconnect/resume must never use
  // toggle semantics, otherwise a second callback can turn off a working feed.
  const startWebcamForCamera = async (cameraId: string, isReconnect = false) => {
    if (webcamStartInFlightRef.current.has(cameraId)) return;
    if (!isReconnect) {
      const pendingReconnect = webcamReconnectTimersRef.current.get(cameraId);
      if (pendingReconnect !== undefined) window.clearTimeout(pendingReconnect);
      webcamReconnectTimersRef.current.delete(cameraId);
      webcamReconnectAttemptsRef.current.delete(cameraId);
      webcamLastStartAtRef.current.delete(cameraId);
    }
    const targetCamera = camerasRef.current.find((camera) => camera.id === cameraId);
    if (!targetCamera) return;

    const streamKey = `channel:${cameraId}`;
    const currentStream = webcamStreamsRef.current[streamKey] ||
      (targetCamera.deviceId ? webcamStreamsRef.current[targetCamera.deviceId] : null);
    if (currentStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
      setWebcamChannelActive(cameraId, true);
      return;
    }
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      const remainingStreams = Object.fromEntries(
        Object.entries(webcamStreamsRef.current).filter(([, stream]) => stream !== currentStream)
      );
      webcamStreamsRef.current = remainingStreams;
      setWebcamStreams(remainingStreams);
    }

    if (targetCamera.isClosed) {
      setCameraError(`Re-open ${targetCamera.name} before assigning a webcam.`);
      setWebcamChannelActive(cameraId, false);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Webcam access requires localhost or HTTPS. Open this app at http://localhost:3000 and allow camera permission.');
      setWebcamChannelActive(cameraId, false);
      return;
    }

    webcamStartInFlightRef.current.add(cameraId);
    setWebcamStartingCameraIds((previous) => new Set(previous).add(cameraId));
    setWebcamChannelActive(cameraId, true);
    setCameraError(null);

    const usedByOtherCamera = camerasRef.current
      .filter((camera) => camera.id !== cameraId && camera.feedMode === 'webcam' && !camera.isClosed)
      .map((camera) => camera.deviceId)
      .filter((deviceId): deviceId is string => Boolean(deviceId));
    const reservedByOtherCamera = Array.from(webcamDeviceReservationsRef.current.entries())
      .filter(([, reservedChannelId]) => reservedChannelId !== cameraId)
      .map(([deviceId]) => deviceId);
    const unavailableDeviceIds = new Set([...usedByOtherCamera, ...reservedByOtherCamera]);
    const requestedDeviceId = [targetCamera.deviceId, selectedDeviceId,
      cameraDevices.find((device) => device.deviceId && !unavailableDeviceIds.has(device.deviceId))?.deviceId,
    ].find((deviceId): deviceId is string =>
      typeof deviceId === 'string' && deviceId.length > 0 && !unavailableDeviceIds.has(deviceId)
    );
    if (requestedDeviceId) webcamDeviceReservationsRef.current.set(requestedDeviceId, cameraId);

    let streamStarted = false;
    try {
      const constraints: MediaStreamConstraints = {
        video: requestedDeviceId
          ? { deviceId: { exact: requestedDeviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (error) {
        if (!requestedDeviceId) throw error;
        // A saved device ID can expire; retry with the browser's default camera.
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }

      const actualDeviceId = stream.getVideoTracks()[0]?.getSettings().deviceId;
      const currentCamera = camerasRef.current.find((camera) => camera.id === cameraId);
      const desiredChannelIds = getActiveWebcamChannelIds();
      const liveChannelStream = webcamStreamsRef.current[streamKey];
      const actualDeviceReservedElsewhere = Boolean(
        actualDeviceId && webcamDeviceReservationsRef.current.has(actualDeviceId) &&
        webcamDeviceReservationsRef.current.get(actualDeviceId) !== cameraId
      );
      const actualDeviceInUseElsewhere = Boolean(actualDeviceId && camerasRef.current.some((camera) =>
        camera.id !== cameraId && camera.feedMode === 'webcam' && !camera.isClosed && camera.deviceId === actualDeviceId
      ));

      // A close/source switch while the permission prompt was open cancels the
      // pending start. Also discard a duplicate stream instead of replacing a
      // live stream already owned by this channel.
      if (!currentCamera || currentCamera.isClosed || !desiredChannelIds.includes(cameraId)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (liveChannelStream?.getVideoTracks().some((track) => track.readyState === 'live')) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (actualDeviceReservedElsewhere || actualDeviceInUseElsewhere) {
        stream.getTracks().forEach((track) => track.stop());
        setWebcamChannelActive(cameraId, false);
        setCameraError('That webcam is already assigned to another camera tile. Connect another camera or stop its other feed first.');
        return;
      }

      const assignedDeviceId = actualDeviceId || requestedDeviceId;
      if (assignedDeviceId) webcamDeviceReservationsRef.current.set(assignedDeviceId, cameraId);
      traceRuntimeEvent('camera.stream.open', { channelId: cameraId, deviceId: assignedDeviceId || null });
      const nextStreams = { ...webcamStreamsRef.current, [streamKey]: stream };
      webcamStreamsRef.current = nextStreams;
      setWebcamStreams(nextStreams);
      const videoTrack = stream.getVideoTracks()[0];
      videoTrack?.addEventListener('ended', () => {
        traceRuntimeEvent('camera.stream.trackEnded', {
          channelId: cameraId,
          deviceId: videoTrack.getSettings().deviceId || null,
          reconnectAttempt: webcamReconnectAttemptsRef.current.get(cameraId) || 0,
        });
        const activeCamera = camerasRef.current.find((camera) => camera.id === cameraId);
        const userStillWantsFeed = getActiveWebcamChannelIds().includes(cameraId) &&
          activeCamera?.feedMode === 'webcam' && !activeCamera.isClosed;
        if (!userStillWantsFeed || webcamStreamsRef.current[streamKey] !== stream) return;
        for (const [deviceId, reservedChannelId] of webcamDeviceReservationsRef.current) {
          if (reservedChannelId === cameraId) webcamDeviceReservationsRef.current.delete(deviceId);
        }
        setCameraError('The webcam track ended unexpectedly. Reconnecting the camera…');
        const remainingStreams = { ...webcamStreamsRef.current };
        delete remainingStreams[streamKey];
        webcamStreamsRef.current = remainingStreams;
        setWebcamStreams(remainingStreams);
        scheduleWebcamReconnectRef.current(cameraId);
      }, { once: true });

      if (assignedDeviceId) setSelectedDeviceId(assignedDeviceId);
      webcamLastStartAtRef.current.set(cameraId, Date.now());
      setCameraError(null);
      handleUpdateChannel(cameraId, {
        feedMode: 'webcam',
        ...(assignedDeviceId ? { deviceId: assignedDeviceId } : {}),
      });
      streamStarted = true;
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        const videoDevices = devices.filter((device) => device.kind === 'videoinput');
        if (videoDevices.length > 0) setCameraDevices(videoDevices);
      }).catch(() => {});
    } catch (error) {
      const activeCamera = camerasRef.current.find((camera) => camera.id === cameraId);
      const userStillWantsFeed = getActiveWebcamChannelIds().includes(cameraId) &&
        activeCamera?.feedMode === 'webcam' && !activeCamera.isClosed;
      const errorName = error && typeof error === 'object' && 'name' in error
        ? String((error as { name?: unknown }).name || '')
        : '';
      const canRetry = !['NotAllowedError', 'PermissionDeniedError', 'SecurityError', 'NotFoundError', 'DevicesNotFoundError'].includes(errorName);
      if (isReconnect && userStillWantsFeed && canRetry) {
        // Keep the user's active-camera intent and retry transient device-busy
        // or track failures instead of silently switching the feed off.
        setWebcamChannelActive(cameraId, true);
        setWebcamStartingCameraIds((previous) => new Set(previous).add(cameraId));
        scheduleWebcamReconnectRef.current(cameraId);
      } else {
        setWebcamChannelActive(cameraId, false);
        if (isReconnect) clearWebcamReconnect(cameraId);
      }
      setCameraError(cameraAccessErrorMessage(error));
    } finally {
      webcamStartInFlightRef.current.delete(cameraId);
      if (!streamStarted) {
        for (const [deviceId, reservedChannelId] of webcamDeviceReservationsRef.current) {
          if (reservedChannelId === cameraId) webcamDeviceReservationsRef.current.delete(deviceId);
        }
      }
      setWebcamStartingCameraIds((previous) => {
        const next = new Set(previous);
        if (!webcamReconnectTimersRef.current.has(cameraId)) next.delete(cameraId);
        return next;
      });
    }
  };

  scheduleWebcamReconnectRef.current = (cameraId: string) => {
    if (webcamReconnectTimersRef.current.has(cameraId)) return;
    const activeCamera = camerasRef.current.find((camera) => camera.id === cameraId);
    if (
      !activeCamera || activeCamera.isClosed || activeCamera.feedMode !== 'webcam' ||
      !getActiveWebcamChannelIds().includes(cameraId)
    ) {
      clearWebcamReconnect(cameraId);
      return;
    }

    const now = Date.now();
    const lastSuccessfulStart = webcamLastStartAtRef.current.get(cameraId) || 0;
    if (lastSuccessfulStart && now - lastSuccessfulStart > 30_000) {
      webcamReconnectAttemptsRef.current.delete(cameraId);
    }
    const attempt = (webcamReconnectAttemptsRef.current.get(cameraId) || 0) + 1;
    webcamReconnectAttemptsRef.current.set(cameraId, attempt);
    const delayMs = Math.min(10_000, 500 * (2 ** Math.min(attempt - 1, 4)));
    setWebcamStartingCameraIds((previous) => new Set(previous).add(cameraId));
    traceRuntimeEvent('camera.stream.reconnectScheduled', { channelId: cameraId, attempt, delayMs });
    const timerId = window.setTimeout(() => {
      webcamReconnectTimersRef.current.delete(cameraId);
      const currentCamera = camerasRef.current.find((camera) => camera.id === cameraId);
      if (
        currentCamera && !currentCamera.isClosed && currentCamera.feedMode === 'webcam' &&
        getActiveWebcamChannelIds().includes(cameraId)
      ) {
        void startWebcamForCamera(cameraId, true);
      } else {
        clearWebcamReconnect(cameraId);
      }
    }, delayMs);
    webcamReconnectTimersRef.current.set(cameraId, timerId);
  };

  // Only a direct user click may toggle an already-running camera off.
  const toggleWebcamForCamera = async (cameraId: string) => {
    const targetCamera = camerasRef.current.find((camera) => camera.id === cameraId);
    if (!targetCamera || webcamStartInFlightRef.current.has(cameraId)) return;
    if (targetCamera.feedMode === 'webcam') {
      const streamKey = `channel:${cameraId}`;
      const currentStream = webcamStreamsRef.current[streamKey] ||
        (targetCamera.deviceId ? webcamStreamsRef.current[targetCamera.deviceId] : null);
      const hasLiveVideoTrack = currentStream?.getVideoTracks().some((track) => track.readyState === 'live');
      if (currentStream && hasLiveVideoTrack) {
        traceRuntimeEvent('camera.stream.manualStop', { channelId: cameraId });
        clearWebcamReconnect(cameraId);
        setWebcamChannelActive(cameraId, false);
        for (const [deviceId, reservedChannelId] of webcamDeviceReservationsRef.current) {
          if (reservedChannelId === cameraId) webcamDeviceReservationsRef.current.delete(deviceId);
        }
        currentStream.getTracks().forEach((track) => track.stop());
        const remainingStreams = Object.fromEntries(
          Object.entries(webcamStreamsRef.current).filter(([, stream]) => stream !== currentStream)
        );
        webcamStreamsRef.current = remainingStreams;
        setWebcamStreams(remainingStreams);
        handleUpdateChannel(cameraId, { feedMode: 'simulation', deviceId: undefined });
        setCameraError(null);
        return;
      }
    }
    await startWebcamForCamera(cameraId);
  };

  const resumeWebcamSignature = cameras
    .filter((camera) => camera.feedMode === 'webcam' && !camera.isClosed)
    .map((camera) => camera.id)
    .sort()
    .join('|');

  useEffect(() => {
    const savedChannelIds = getActiveWebcamChannelIds();
    for (const cameraId of savedChannelIds) {
      const camera = camerasRef.current.find((item) => item.id === cameraId);
      if (!camera || camera.isClosed || camera.feedMode !== 'webcam') {
        setWebcamChannelActive(cameraId, false);
        continue;
      }
      const stream = webcamStreamsRef.current[`channel:${cameraId}`];
      const hasLiveVideoTrack = stream?.getVideoTracks().some((track) => track.readyState === 'live');
      if (hasLiveVideoTrack || webcamResumeAttemptedRef.current.has(cameraId)) continue;
      webcamResumeAttemptedRef.current.add(cameraId);
      traceRuntimeEvent('camera.stream.resume', { channelId: cameraId });
      void startWebcamForCamera(cameraId);
    }
  }, [resumeWebcamSignature]);

  const toggleWebcamForSelectedCamera = () => {
    void toggleWebcamForCamera(selectedCameraId);
  };

  const detectedFaces = activeCamera.lastScanResult?.faces || [];

  return (
    <div className="space-y-5">
      {/* Hidden Canvas for Frame Capture */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top Multi-Camera Matrix Navigation Header */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        {/* Left: Matrix Title & Status */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-zinc-950 rounded-xl flex items-center justify-center text-white shadow-sm">
            <Radio className="w-5 h-5 text-amber-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black tracking-tight text-zinc-950 uppercase font-sans">
                Multi-Camera Matrix Hub
              </h2>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold">
                4 CHANNELS ACTIVE
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
              Simultaneous AI optical tracking & perimeter threat triage
            </p>
          </div>
        </div>

        {/* Center: Layout Mode Switchers */}
        <div className="flex items-center bg-zinc-100 p-1 rounded-xl border border-zinc-200">
          <button
            id="btn-layout-grid"
            onClick={() => setLayoutMode('grid')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              layoutMode === 'grid'
                ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200'
                : 'text-zinc-600 hover:text-zinc-950'
            }`}
            title="2x2 Quad Multi-Camera Grid"
          >
            <Grid className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Quad Grid (2x2)</span>
          </button>

          <button
            id="btn-layout-focus"
            onClick={() => setLayoutMode('focus')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              layoutMode === 'focus'
                ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200'
                : 'text-zinc-600 hover:text-zinc-950'
            }`}
            title="Focus Split View (1 Large + 3 Side)"
          >
            <Columns className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Split Focus</span>
          </button>

          <button
            id="btn-layout-single"
            onClick={() => setLayoutMode('single')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              layoutMode === 'single'
                ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200'
                : 'text-zinc-600 hover:text-zinc-950'
            }`}
            title="Single Fullscreen Channel"
          >
            <Square className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Single Channel</span>
          </button>
        </div>

        {/* Right: Master Scan & Global Zoom Controls */}
        <div className="flex items-center gap-2">
          {/* Master Zoom All Cameras Control */}
          <div className="hidden sm:flex items-center bg-zinc-100 p-1 rounded-xl border border-zinc-200 text-xs">
            <span className="text-[10px] font-mono font-bold text-zinc-500 px-1.5 flex items-center gap-1">
              <ZoomIn className="w-3 h-3 text-zinc-600" />
              ZOOM ALL:
            </span>
            {[1, 1.5, 2, 3].map((z) => {
              const allMatch = cameras.every((c) => (c.ptzZoom || 1) === z);
              return (
                <button
                  key={`zoom-all-${z}`}
                  onClick={() => {
                    setCameras((prev) => prev.map((c) => ({ ...c, ptzZoom: z })));
                  }}
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold transition-all ${
                    allMatch
                      ? 'bg-zinc-950 text-white shadow-sm'
                      : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200'
                  }`}
                  title={`Set all cameras to ${z === 1 ? '1.0x (No Zoom / Reset)' : `${z.toFixed(1)}x Zoom`}`}
                >
                  {z === 1 ? '1x (None)' : `${z}x`}
                </button>
              );
            })}
          </div>

          {/* Auto-Scan Mode Switcher */}
          <div className="hidden lg:flex items-center bg-zinc-100 p-0.5 rounded-lg border border-zinc-200 text-[10px] font-mono font-bold">
            <button
              onClick={() => onUpdateSettings({ autoScanMode: 'all' })}
              className={`px-2 py-1 rounded transition-all ${
                (settings.autoScanMode || 'all') === 'all'
                  ? 'bg-zinc-950 text-white shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
              title="Continuously scan open live feeds. Simulation scenarios are scanned manually."
            >
              All Live Feeds
            </button>
            <button
              onClick={() => onUpdateSettings({ autoScanMode: 'sequential' })}
              className={`px-2 py-1 rounded transition-all ${
                settings.autoScanMode === 'sequential'
                  ? 'bg-zinc-950 text-white shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-950'
              }`}
              title="Cycle auto-scan across open live feeds one camera at a time."
            >
              Sequential Live
            </button>
          </div>

          {/* Scan Speed Quick Selector */}
          <div className="flex items-center bg-zinc-100 p-0.5 rounded-lg border border-zinc-200 text-[10px] font-mono font-bold">
            {[
              { sec: 1, label: '⚡ 1s Fast' },
              { sec: 2, label: '⚡ 2s Turbo' },
              { sec: 3, label: '3s Fast' },
              { sec: 5, label: '5s Normal' },
            ].map((spd) => (
              <button
                key={`spd-${spd.sec}`}
                onClick={() => onUpdateSettings({ scanIntervalSeconds: spd.sec })}
                className={`px-2 py-1 rounded transition-all ${
                  settings.scanIntervalSeconds === spd.sec
                    ? 'bg-zinc-950 text-white shadow-sm font-bold'
                    : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200'
                }`}
                title={`Set AI continuous face detection scan frequency to ${spd.sec} seconds`}
              >
                {spd.label}
              </button>
            ))}
          </div>

          {/* Audio Alert Quick Test */}
          <button
            id="btn-quick-test-voice-alert"
            onClick={() => soundEngine.testAudioSystem()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-mono font-bold transition-all shadow-2xs"
            title="Test tactical siren and voice security alert audio"
          >
            <Volume2 className="w-3.5 h-3.5 text-red-600" />
            <span className="hidden xl:inline">Test Alert Audio</span>
          </button>

          {/* Connect Phone / Bluetooth Camera Trigger */}
          <button
            id="btn-open-remote-camera-hub"
            onClick={() => setIsRemoteModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-800 text-xs font-mono font-bold transition-all shadow-2xs"
            title="Connect Phone as Camera (QR code) or Bluetooth / IP Camera"
          >
            <Smartphone className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden sm:inline">Phone & BT Cam</span>
            {cameras.some((c) => c.feedMode === 'phone_stream' || c.feedMode === 'bluetooth') && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            )}
          </button>

          {/* Auto-Scan Start / Stop Controls */}
          {settings.autoScan ? (
            <button
              id="btn-stop-scanning"
              onClick={handleStopScanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs font-bold bg-red-50 hover:bg-red-100 text-red-700 border-red-300 shadow-sm transition-all"
              title="Stop scanning and pause continuous AI monitoring"
            >
              <StopCircle className="w-3.5 h-3.5 text-red-600 animate-pulse" />
              <span>Stop Scanning</span>
            </button>
          ) : (
            <button
              id="btn-start-scanning"
              onClick={() => onUpdateSettings({ autoScan: true })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 shadow-sm transition-all"
              title="Start continuous AI surveillance scanning"
            >
              <Play className="w-3.5 h-3.5 text-emerald-700" />
              <span>Start Auto-Scan</span>
            </button>
          )}

          {/* Scan All Active Channels */}
          <button
            id="btn-scan-all-channels"
            onClick={() => executeScanAllChannels()}
            disabled={isAnalyzing}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-mono text-xs font-bold text-white shadow-sm transition-all uppercase tracking-wide ${
              isAnalyzing
                ? 'bg-zinc-400 cursor-not-allowed'
                : 'bg-zinc-950 hover:bg-zinc-800 active:scale-95'
            }`}
            title="Analyze the current frame from all open cameras. Simulation feeds use sample results."
          >
            <Scan className={`w-3.5 h-3.5 ${isAnalyzing ? 'animate-spin' : ''}`} />
            <span>{isAnalyzing ? 'Analyzing' : 'Scan All'} ({cameras.filter((c) => !c.isClosed && c.status !== 'OFFLINE').length})</span>
          </button>
        </div>
      </div>

      {/* Real-time Multi-Camera Matrix Status Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {cameras.map((cam) => {
          const isSelected = selectedCameraId === cam.id;
          const threat = cam.activeThreatLevel;
          const faces = cam.lastScanResult?.faces || [];
          const isUnavailable = Boolean(cam.isClosed || cam.status === 'OFFLINE');
          const hasHighThreat = threat === 'CRITICAL' || threat === 'HIGH';
          const hasBreach = !isUnavailable && cam.feedMode !== 'simulation' && hasHighThreat;
          const hasSimulatedThreat = !isUnavailable && cam.feedMode === 'simulation' && hasHighThreat;
          const isScanning = scanningChannelId === cam.id || (isAnalyzing && !scanningChannelId);

          return (
            <div
              key={`matrix-status-${cam.id}`}
              onClick={() => {
                setSelectedCameraId(cam.id);
                onUpdateSettings({ activeZone: cam.zone });
              }}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                hasBreach
                  ? 'bg-red-50/90 border-red-300 ring-2 ring-red-400/50 shadow-sm'
                  : hasSimulatedThreat
                  ? 'bg-violet-50/90 border-violet-300 ring-1 ring-violet-300/70 shadow-sm'
                  : isSelected
                  ? 'bg-white border-zinc-950 shadow-sm ring-1 ring-zinc-950'
                  : 'bg-white border-zinc-200 hover:border-zinc-300'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${hasBreach ? 'bg-red-500 animate-ping' : hasSimulatedThreat ? 'bg-violet-500' : isUnavailable ? 'bg-zinc-400' : isScanning ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`} />
                  <span className="font-mono font-bold text-xs text-zinc-900">
                    CAM 0{cam.channelNumber}
                  </span>
                </div>
                <span className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded uppercase ${
                  hasBreach
                    ? 'bg-red-600 text-white animate-pulse'
                    : hasSimulatedThreat
                    ? 'bg-violet-100 text-violet-800'
                    : isUnavailable
                    ? 'bg-zinc-100 text-zinc-600'
                    : threat === 'MEDIUM'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {isUnavailable ? 'OFFLINE' : hasBreach ? '🚨 BREACH' : hasSimulatedThreat ? 'DEMO ALERT' : cam.feedMode === 'simulation' ? 'SIMULATION' : threat === 'NONE' ? 'SECURE' : threat}
                </span>
              </div>

              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="text-zinc-500 truncate max-w-[100px] font-medium" title={cam.name}>
                  {cam.zone}
                </span>
                <span className="font-mono font-semibold text-zinc-700 text-[10px]">
                  {!isUnavailable && faces.length > 0 ? `${faces.length} face${faces.length > 1 ? 's' : ''}` : 'No faces'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Main Video Presentation Stage according to LayoutMode */}
      {layoutMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cameras.map((cam) => (
            <CameraTile
              key={cam.id}
              camera={cam}
              isSelected={selectedCameraId === cam.id}
              onSelect={() => {
                setSelectedCameraId(cam.id);
                onUpdateSettings({ activeZone: cam.zone });
              }}
              onScanChannel={executeScanOnChannel}
              isScanningThisChannel={scanningChannelIds.has(cam.id) || scanningChannelId === cam.id}
              onUpdateChannel={handleUpdateChannel}
              onToggleFeed={() => handleToggleChannelFeed(cam.id)}
              onToggleWebcam={() => { void toggleWebcamForCamera(cam.id); }}
              isWebcamStarting={webcamStartingCameraIds.has(cam.id)}
              videoStream={cam.feedMode === 'webcam' ? getWebcamStreamForCamera(cam) : null}
              webRtcStream={cam.feedMode === 'phone_stream' ? webRtcStreams[cam.id] : null}
              onSelectFace={(face) => setSelectedFaceDetail(face)}
              selectedFaceId={selectedFaceDetail?.id}
              showBoundingBoxes={settings.showBoundingBoxes}
              showHudOverlay={settings.showHudOverlay}
            />
          ))}
        </div>
      )}

      {layoutMode === 'focus' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Primary Focused Camera (2 columns) */}
          <div className="lg:col-span-2">
            <CameraTile
              camera={activeCamera}
              isSelected={true}
              onSelect={() => {}}
              onScanChannel={executeScanOnChannel}
              isScanningThisChannel={scanningChannelIds.has(activeCamera.id) || scanningChannelId === activeCamera.id}
              onUpdateChannel={handleUpdateChannel}
              onToggleFeed={() => handleToggleChannelFeed(activeCamera.id)}
              onToggleWebcam={() => { void toggleWebcamForCamera(activeCamera.id); }}
              isWebcamStarting={webcamStartingCameraIds.has(activeCamera.id)}
              videoStream={activeCamera.feedMode === 'webcam' ? getWebcamStreamForCamera(activeCamera) : null}
              webRtcStream={activeCamera.feedMode === 'phone_stream' ? webRtcStreams[activeCamera.id] : null}
              onSelectFace={(face) => setSelectedFaceDetail(face)}
              selectedFaceId={selectedFaceDetail?.id}
              showBoundingBoxes={settings.showBoundingBoxes}
              showHudOverlay={settings.showHudOverlay}
            />
          </div>

          {/* Secondary 3 Side Cameras (1 column) */}
          <div className="flex flex-col gap-3">
            {cameras
              .filter((c) => c.id !== activeCamera.id)
              .map((cam) => (
                <div key={cam.id} className="relative">
                  <CameraTile
                    camera={cam}
                    isSelected={false}
                    onSelect={() => {
                      setSelectedCameraId(cam.id);
                      onUpdateSettings({ activeZone: cam.zone });
                    }}
                    onScanChannel={executeScanOnChannel}
                    isScanningThisChannel={scanningChannelIds.has(cam.id) || scanningChannelId === cam.id}
                    onUpdateChannel={handleUpdateChannel}
                    onToggleFeed={() => handleToggleChannelFeed(cam.id)}
                    onToggleWebcam={() => { void toggleWebcamForCamera(cam.id); }}
                    isWebcamStarting={webcamStartingCameraIds.has(cam.id)}
                    videoStream={cam.feedMode === 'webcam' ? getWebcamStreamForCamera(cam) : null}
                    webRtcStream={cam.feedMode === 'phone_stream' ? webRtcStreams[cam.id] : null}
                    onSelectFace={(face) => setSelectedFaceDetail(face)}
                    selectedFaceId={selectedFaceDetail?.id}
                    isCompact={true}
                    showBoundingBoxes={settings.showBoundingBoxes}
                    showHudOverlay={settings.showHudOverlay}
                  />
                </div>
              ))}
          </div>
        </div>
      )}

      {layoutMode === 'single' && (
        <div className="max-w-5xl mx-auto">
          {/* Quick channel tabs */}
          <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
            {cameras.map((cam) => (
              <button
                key={cam.id}
                onClick={() => {
                  setSelectedCameraId(cam.id);
                  onUpdateSettings({ activeZone: cam.zone });
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold flex items-center gap-2 transition-all whitespace-nowrap ${
                  selectedCameraId === cam.id
                    ? 'bg-zinc-950 text-white shadow-md'
                    : 'bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${cam.activeThreatLevel === 'CRITICAL' ? 'bg-red-500 animate-ping' : 'bg-emerald-400'}`} />
                <span>CAM 0{cam.channelNumber}</span>
                <span className="opacity-70 font-sans font-medium text-[11px]">- {cam.zone}</span>
              </button>
            ))}
          </div>

          <CameraTile
            camera={activeCamera}
            isSelected={true}
            onSelect={() => {}}
            onScanChannel={executeScanOnChannel}
            isScanningThisChannel={scanningChannelIds.has(activeCamera.id) || scanningChannelId === activeCamera.id}
            onUpdateChannel={handleUpdateChannel}
            onToggleFeed={() => handleToggleChannelFeed(activeCamera.id)}
            onToggleWebcam={() => { void toggleWebcamForCamera(activeCamera.id); }}
            isWebcamStarting={webcamStartingCameraIds.has(activeCamera.id)}
            videoStream={activeCamera.feedMode === 'webcam' ? getWebcamStreamForCamera(activeCamera) : null}
            webRtcStream={activeCamera.feedMode === 'phone_stream' ? webRtcStreams[activeCamera.id] : null}
            onSelectFace={(face) => setSelectedFaceDetail(face)}
            selectedFaceId={selectedFaceDetail?.id}
            showBoundingBoxes={settings.showBoundingBoxes}
            showHudOverlay={settings.showHudOverlay}
          />
        </div>
      )}

      {/* Active Camera Management & Optical Diagnostics Strip */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="px-2.5 py-1 rounded-lg bg-zinc-100 border border-zinc-300 font-mono text-xs font-black text-zinc-900">
              CAM 0{activeCamera.channelNumber}
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-950 flex items-center gap-2">
                <span>{activeCamera.name}</span>
                {activeCamera.isClosed && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-red-600 text-white animate-pulse">
                    FEED CLOSED • BLIND SPOT ALERT
                  </span>
                )}
              </h3>
              <p className="text-xs text-zinc-500 font-mono">
                Zone: <span className="font-semibold text-zinc-800">{activeCamera.zone}</span> | Lens: {activeCamera.lensType} | Status: <span className={`font-bold ${activeCamera.isClosed ? 'text-red-600' : 'text-emerald-600'}`}>{activeCamera.isClosed ? 'OFFLINE (CLOSED)' : 'ONLINE'}</span>
              </p>
            </div>
          </div>

          {/* Quick source switchers for active channel */}
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
            {/* Close / Reopen Camera Feed Toggle Button */}
            <button
              id="btn-toggle-camera-feed-power"
              onClick={() => handleToggleChannelFeed(activeCamera.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all border shadow-xs ${
                activeCamera.isClosed
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500 animate-pulse'
                  : 'bg-red-50 hover:bg-red-100 text-red-700 border-red-300'
              }`}
              title={
                activeCamera.isClosed
                  ? `Re-open camera feed in ${activeCamera.zone} (Restore Online)`
                  : `Close camera feed in ${activeCamera.zone} (Generates Blind Spot Incident)`
              }
            >
              <Power className="w-3.5 h-3.5" />
              <span>{activeCamera.isClosed ? `🟢 RE-OPEN FEED (${activeCamera.zone})` : `🔴 CLOSE CAMERA FEED`}</span>
            </button>

            <button
              id="btn-toggle-channel-webcam"
              onClick={toggleWebcamForSelectedCamera}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                activeCamera.feedMode === 'webcam'
                  ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                  : 'bg-zinc-100 text-zinc-700 border-zinc-200 hover:bg-zinc-200'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>{activeCamera.feedMode === 'webcam' ? 'Live Webcam Connected' : 'Bind Live Webcam'}</span>
            </button>

            {/* Webcam Device Selector */}
            {cameraDevices.length > 1 && (
              <select
                value={activeCamera.feedMode === 'webcam' ? activeCamera.deviceId || selectedDeviceId : selectedDeviceId}
                onChange={(e) => {
                  if (activeCamera.feedMode === 'webcam') {
                    handleUpdateChannel(selectedCameraId, { deviceId: e.target.value });
                  } else {
                    setSelectedDeviceId(e.target.value);
                  }
                }}
                className="text-xs font-mono px-2 py-1.5 rounded-lg border border-zinc-300 bg-white text-zinc-800"
              >
                {cameraDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            )}

            <button
              id="btn-upload-channel-photo"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-100 text-zinc-700 border border-zinc-200 hover:bg-zinc-200 transition-all"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Snapshot</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              className="hidden"
              onChange={handleFileUpload}
            />

            <button
              id="btn-open-remote-modal-active-cam"
              onClick={() => setIsRemoteModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100 transition-all"
              title="Pair Phone via QR or Connect Bluetooth / IP Camera to this channel"
            >
              <Smartphone className="w-3.5 h-3.5 text-blue-600" />
              <span>📱 Phone / BT Source</span>
            </button>

            <button
              id="btn-scan-channel-now"
              onClick={() => executeScanOnChannel(activeCamera.id)}
              disabled={isAnalyzing}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-mono font-bold bg-zinc-950 text-white hover:bg-zinc-800 transition-all uppercase"
            >
              <Scan className={`w-3.5 h-3.5 ${scanningChannelId === activeCamera.id ? 'animate-spin' : ''}`} />
              <span>Scan Active Feed</span>
            </button>
            </div>
            {cameraError && (
              <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span>{cameraError}</span>
                <button type="button" onClick={() => setCameraError(null)} className="font-bold underline">Dismiss</button>
              </div>
            )}
          </div>
        </div>

        {/* PTZ Zoom & Magnification Controls for Focused Channel */}
        <div className="py-2.5 px-3 my-2 bg-zinc-50 rounded-xl border border-zinc-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-zinc-700 flex items-center gap-1.5 text-[11px]">
              <ZoomIn className="w-3.5 h-3.5 text-zinc-800" />
              OPTICAL / PTZ ZOOM:
            </span>
            <div className="flex items-center gap-1.5">
              {[1, 1.25, 1.5, 2, 2.5, 3].map((level) => {
                const isActive = (activeCamera.ptzZoom || 1) === level;
                return (
                  <button
                    key={`ptz-preset-${level}`}
                    onClick={() => handleUpdateChannel(activeCamera.id, { ptzZoom: level })}
                    className={`px-2 py-0.5 rounded-md font-mono text-[11px] font-bold transition-all ${
                      isActive
                        ? 'bg-amber-500 text-zinc-950 shadow-sm ring-1 ring-amber-400'
                        : 'bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    {level === 1 ? '1.0x (No Zoom)' : `${level}x`}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="range"
              min="1"
              max="3"
              step="0.1"
              value={activeCamera.ptzZoom || 1}
              onChange={(e) => handleUpdateChannel(activeCamera.id, { ptzZoom: parseFloat(e.target.value) })}
              className="w-24 accent-amber-500 cursor-pointer"
            />
            <span className="font-mono font-bold text-zinc-900 text-xs w-10 text-right">
              {(activeCamera.ptzZoom || 1).toFixed(1)}x
            </span>
            {(activeCamera.ptzZoom || 1) > 1 && (
              <button
                onClick={() => handleUpdateChannel(activeCamera.id, { ptzZoom: 1 })}
                className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-200 hover:bg-zinc-300 text-zinc-800 font-bold"
                title="Reset zoom to default (1.0x)"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Optical Detection Results & Biometrics for Selected Camera */}
        <div className="pt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Left: Situational Summary */}
          <div className="bg-zinc-50 rounded-xl p-3.5 border border-zinc-200 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-zinc-700 uppercase">
              <span>Channel Telemetry:</span>
              <span className={`px-2 py-0.5 rounded text-[10px] ${
                activeCamera.activeThreatLevel === 'CRITICAL' || activeCamera.activeThreatLevel === 'HIGH'
                  ? 'bg-red-100 text-red-700 font-bold'
                  : 'bg-emerald-100 text-emerald-700 font-bold'
              }`}>
                {activeCamera.activeThreatLevel} THREAT
              </span>
            </div>

            <p className="text-xs text-zinc-700 leading-relaxed font-sans">
              {activeCamera.lastScanResult?.sceneSummary || 'Channel running optical baseline scan. Ready for situational analysis.'}
            </p>

            <div className="pt-2 border-t border-zinc-200 text-[11px] font-mono text-zinc-600 flex items-center justify-between">
              <span>Guidance:</span>
              <span className="font-semibold text-zinc-900">{activeCamera.lastScanResult?.recommendedAction || 'Continue routine surveillance'}</span>
            </div>
          </div>

          {/* Center: Detected Individuals List */}
          <div className="bg-zinc-50 rounded-xl p-3.5 border border-zinc-200">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-zinc-700 uppercase mb-2">
              <div className="flex items-center gap-1.5">
                <span>Detected Faces ({detectedFaces.length}):</span>
                {detectedFaces.length >= 2 && (
                  <span className="px-1.5 py-0.2 rounded bg-zinc-900 text-amber-400 text-[9px] font-black tracking-wider">
                    2 SECTIONS
                  </span>
                )}
              </div>
              <span className="text-[10px] text-zinc-500 font-normal">Click face to inspect</span>
            </div>

            {detectedFaces.length === 0 ? (
              <div className="text-center py-6 text-xs text-zinc-400 font-mono">
                No human subjects identified in current frame.
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {detectedFaces.map((face, idx) => {
                  const isAuth = face.status === 'AUTHORIZED';
                  const isUnverified = face.status === 'UNKNOWN' || face.status === 'SUSPICIOUS';
                  const isSelected = selectedFaceDetail?.id === face.id;
                  const personSubjectNum = idx + 1;
                  const linkedIncident = (incidents || []).find((inc) =>
                    inc.channelId === activeCamera.id && inc.subjectIndex === personSubjectNum
                  ) || (incidents || []).find((inc) =>
                    inc.faces?.[0]?.id === face.id
                  );

                  return (
                    <div
                      key={`face-detail-${face.id || 'face'}-${idx}`}
                      onClick={() => setSelectedFaceDetail(face)}
                      className={`p-2.5 rounded-lg border text-xs flex items-center justify-between cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-white border-zinc-900 shadow-sm ring-2 ring-zinc-900'
                          : isAuth
                          ? 'bg-emerald-50/70 border-emerald-300 hover:bg-emerald-100/60'
                          : isUnverified
                          ? 'bg-amber-50/70 border-amber-300 hover:bg-amber-100/60'
                          : idx === 0
                          ? 'bg-red-50/70 border-red-300 hover:bg-red-100/60'
                          : 'bg-amber-50/70 border-amber-300 hover:bg-amber-100/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        {isAuth ? (
                          <div className="p-1.5 rounded-md bg-emerald-600 text-white">
                            <UserCheck className="w-4 h-4" />
                          </div>
                        ) : isUnverified ? (
                          <div className="p-1.5 rounded-md bg-amber-500 text-zinc-950">
                            <Scan className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className={`p-1.5 rounded-md text-white animate-pulse ${idx === 0 ? 'bg-red-600' : 'bg-amber-600'}`}>
                            <UserX className="w-4 h-4" />
                          </div>
                        )}
                        <div>
                          <div className="font-bold text-zinc-950 flex items-center gap-1.5">
                            {isAuth ? (
                              <span>{face.matchedName || 'Authorized Staff'}</span>
                            ) : isUnverified ? (
                              <span className="font-extrabold text-amber-800">
                                Unverified subject #{personSubjectNum} {face.matchedName && face.matchedName !== 'UNVERIFIED SUBJECT' ? `(${face.matchedName})` : ''}
                              </span>
                            ) : (
                              <span className={`font-extrabold ${idx === 0 ? 'text-red-700' : 'text-amber-700'}`}>
                                Section {personSubjectNum}: Person #{personSubjectNum} {face.matchedName && face.matchedName !== 'UNREGISTERED INDIVIDUAL' ? `(${face.matchedName})` : ''}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-600 font-mono flex items-center gap-2 mt-0.5">
                            {face.matchedPersonnelId ? (
                              <span className="px-1 py-0.2 rounded bg-emerald-200/60 text-emerald-900 font-bold">
                                ID: {face.matchedPersonnelId}
                              </span>
                            ) : (
                              <span className={`px-1 py-0.2 rounded font-bold ${isUnverified ? 'bg-amber-200/60 text-amber-900' : idx === 0 ? 'bg-red-200/60 text-red-900' : 'bg-amber-200/60 text-amber-900'}`}>
                                {isUnverified ? 'IDENTITY REVIEW' : `SUBJECT #${personSubjectNum}`}
                              </span>
                            )}
                            <span>{isAuth ? 'Identity match' : 'Face detection'}: {face.confidence}%</span>
                            {linkedIncident && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onViewIncident ? onViewIncident(linkedIncident) : onNavigateToIncidents?.();
                                }}
                                className="px-1.5 py-0.2 rounded bg-zinc-900 hover:bg-zinc-800 text-amber-400 font-bold flex items-center gap-1 cursor-pointer transition-all"
                                title="Open full incident record for this person"
                              >
                                <span>LOG #{linkedIncident.id.slice(-5).toUpperCase()}</span>
                                <ExternalLink className="w-2.5 h-2.5 text-zinc-400" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`text-[9px] font-mono font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                            isAuth ? 'bg-emerald-600 text-white' : isUnverified ? 'bg-amber-500 text-zinc-950' : 'bg-red-600 text-white'
                          }`}
                        >
                          {isAuth ? 'REGISTERED' : isUnverified ? 'UNVERIFIED' : 'UNAUTHORIZED'}
                        </span>
                        <span className="text-[9px] font-mono text-zinc-500">
                          {isAuth ? 'CLEARANCE CONFIRMED' : isUnverified ? 'MANUAL REVIEW' : `INCIDENT #${personSubjectNum}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Selected Face Biometric Profile */}
          <div className="bg-zinc-50 rounded-xl p-3.5 border border-zinc-200">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-zinc-700 uppercase mb-2">
              <span>Biometric Breakdown:</span>
              {selectedFaceDetail && (
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                  selectedFaceDetail.status === 'AUTHORIZED'
                    ? 'bg-emerald-100 text-emerald-800'
                    : selectedFaceDetail.status === 'UNKNOWN' || selectedFaceDetail.status === 'SUSPICIOUS'
                    ? 'bg-amber-100 text-amber-900'
                    : 'bg-red-100 text-red-800'
                }`}>
                  {selectedFaceDetail.status === 'AUTHORIZED'
                    ? 'STATUS: REGISTERED'
                    : selectedFaceDetail.status === 'UNKNOWN'
                    ? 'STATUS: UNVERIFIED'
                    : selectedFaceDetail.status === 'SUSPICIOUS'
                    ? 'STATUS: REVIEW'
                    : 'STATUS: UNAUTHORIZED'}
                </span>
              )}
            </div>

            {selectedFaceDetail ? (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-zinc-200">
                  <span className="text-zinc-500 font-mono text-[11px]">Subject Identity:</span>
                  <div className="text-right">
                    <span className="font-bold text-zinc-950 block">{selectedFaceDetail.matchedName || 'Unknown Subject'}</span>
                    <span className="text-[10px] font-mono text-zinc-500">
                      {selectedFaceDetail.matchedPersonnelId ? `ID: ${selectedFaceDetail.matchedPersonnelId}` : '⚠️ Not in Personnel Database'}
                    </span>
                  </div>
                </div>

                <div className={`p-2 rounded-lg border text-[11px] leading-tight ${
                  selectedFaceDetail.status === 'AUTHORIZED'
                    ? 'bg-emerald-50/50 border-emerald-200 text-emerald-950'
                    : selectedFaceDetail.status === 'UNKNOWN' || selectedFaceDetail.status === 'SUSPICIOUS'
                    ? 'bg-amber-50/50 border-amber-200 text-amber-950'
                    : 'bg-red-50/50 border-red-200 text-red-950'
                }`}>
                  <span className="font-bold block mb-0.5">
                    {selectedFaceDetail.status === 'AUTHORIZED'
                      ? 'Credential Verification:'
                      : selectedFaceDetail.status === 'UNKNOWN' || selectedFaceDetail.status === 'SUSPICIOUS'
                      ? 'Identity Verification Needed:'
                      : '🚨 Security Alert Reason:'}
                  </span>
                  {selectedFaceDetail.threatReason || selectedFaceDetail.activityContext || 'Standard visual logging'}
                </div>

                {selectedFaceDetail.features && (
                  <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                    <div className="bg-white p-1.5 rounded border border-zinc-200">
                      <span className="text-zinc-400 block">AGE / GENDER:</span>
                      <span className="font-bold text-zinc-800">
                        {selectedFaceDetail.features.ageEstimate || 'Adult'} • {selectedFaceDetail.features.genderEstimate || 'N/A'}
                      </span>
                    </div>
                    <div className="bg-white p-1.5 rounded border border-zinc-200">
                      <span className="text-zinc-400 block">HEAD POSE:</span>
                      <span className="font-bold text-zinc-800">{selectedFaceDetail.features.headPose || 'Forward'}</span>
                    </div>
                  </div>
                )}

                {selectedFaceDetail.status !== 'AUTHORIZED' && onNavigateToDirectory && (
                  <button
                    id="btn-quick-register-subject"
                    onClick={onNavigateToDirectory}
                    className="w-full mt-1.5 py-1.5 px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white font-mono text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>+ Register Face in Directory</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-xs text-zinc-400 font-mono">
                Select a detected face to view biometric extraction parameters.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scenario Selector Strip for Simulation Feeds */}
      {activeCamera.feedMode === 'simulation' && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono font-bold text-zinc-900 uppercase tracking-wider flex items-center gap-2">
              <Layers className="w-4 h-4 text-zinc-700" />
              Assign Simulation Scenario to CAM 0{activeCamera.channelNumber} ({activeCamera.zone}):
            </span>
            <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
              Click a scenario to test multi-person intrusion or clearance validation
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {SAMPLE_SCENARIOS.map((scen) => {
              const isAssigned = activeCamera.scenarioId === scen.id;

              return (
                <button
                  key={scen.id}
                  id={`scenario-card-${scen.id}`}
                  onClick={() => {
                    handleUpdateChannel(activeCamera.id, {
                      scenarioId: scen.id,
                      feedMode: 'simulation',
                      zone: scen.zone,
                    });
                    setTimeout(() => {
                      executeScanOnChannel(activeCamera.id);
                    }, 200);
                  }}
                  className={`text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
                    isAssigned
                      ? 'bg-zinc-50 border-zinc-950 shadow-md ring-1 ring-zinc-950'
                      : 'bg-white border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                  }`}
                >
                  <img
                    src={scen.imageUrl}
                    alt={scen.title}
                    className="w-14 h-14 rounded-lg object-cover flex-shrink-0 border border-zinc-200 shadow-sm"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase ${
                          scen.category === 'UNAUTHORIZED'
                            ? 'bg-red-50 text-red-700 border border-red-200'
                            : scen.category === 'AUTHORIZED'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {scen.category}
                      </span>
                      <span className="text-[9px] font-mono text-zinc-500 font-semibold">{scen.zone}</span>
                    </div>
                    <h4 className="text-xs font-bold text-zinc-900 mt-1 truncate">{scen.title}</h4>
                    <p className="text-[10px] text-zinc-500 line-clamp-1 mt-0.5">{scen.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Bluetooth, Phone QR Pairing, and Remote IP Camera Modal */}
      <BluetoothAndRemoteCameraModal
        isOpen={isRemoteModalOpen}
        onClose={() => setIsRemoteModalOpen(false)}
        cameras={cameras}
        onUpdateChannel={handleUpdateChannel}
        availableMediaDevices={cameraDevices}
        activeChannelId={selectedCameraId}
        onSelectChannel={(id) => setSelectedCameraId(id)}
      />
    </div>
  );
};
