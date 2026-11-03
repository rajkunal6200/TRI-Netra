import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  Smartphone,
  Bluetooth,
  Wifi,
  Camera,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  X,
  Radio,
  Sliders,
  Shield,
  Layers,
  Sparkles,
  Play,
  Zap,
  Battery,
  Tv,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { CameraChannel, BluetoothDeviceInfo, CameraFeedMode } from '@shared/types';

interface BluetoothAndRemoteCameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: CameraChannel[];
  onUpdateChannel: (channelId: string, updates: Partial<CameraChannel>) => void;
  availableMediaDevices: MediaDeviceInfo[];
  activeChannelId: string;
  onSelectChannel: (channelId: string) => void;
}

export const BluetoothAndRemoteCameraModal: React.FC<BluetoothAndRemoteCameraModalProps> = ({
  isOpen,
  onClose,
  cameras,
  onUpdateChannel,
  availableMediaDevices,
  activeChannelId,
  onSelectChannel,
}) => {
  const [activeTab, setActiveTab] = useState<'phone' | 'bluetooth' | 'ip_stream' | 'matrix'>('phone');
  const [targetChannelId, setTargetChannelId] = useState<string>(activeChannelId || 'cam-2');
  const [pairCode, setPairCode] = useState<string>('PHONE-1');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  
  // Phone stream live state
  const [phoneStreamData, setPhoneStreamData] = useState<{
    isOnline: boolean;
    deviceModel?: string;
    batteryLevel?: number;
    fps?: number;
    frameBase64?: string;
    lastSeenMs?: number;
  }>({ isOnline: false });

  // Bluetooth states
  const [isScanningBle, setIsScanningBle] = useState<boolean>(false);
  const [bleDevices, setBleDevices] = useState<BluetoothDeviceInfo[]>([]);
  const [bleError, setBleError] = useState<string | null>(null);
  const bleConnectionsRef = useRef(new Map<string, { device: any; onDisconnected: () => void }>());
  const [bleSupport, setBleSupport] = useState<boolean>(true);

  // IP Stream states
  const [customStreamUrl, setCustomStreamUrl] = useState<string>('http://192.168.1.100:8080/video');
  const [ipStreamStatus, setIpStreamStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  // Compute mobile transmitter URL
  const mobileTransmitterUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?phoneCam=${targetChannelId}&code=${pairCode}`
    : `https://app.trinetra.ai/?phoneCam=${targetChannelId}&code=${pairCode}`;
  const phoneLinkUsesLoopback = typeof window !== 'undefined'
    && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const phoneLinkNeedsHttps = typeof window !== 'undefined'
    && window.location.protocol !== 'https:'
    && !phoneLinkUsesLoopback;

  // Generate QR Code
  useEffect(() => {
    if (typeof window !== 'undefined') {
      QRCode.toDataURL(mobileTransmitterUrl, {
        width: 240,
        margin: 1.5,
        color: {
          dark: '#09090b',
          light: '#ffffff',
        },
      })
        .then((url) => setQrCodeDataUrl(url))
        .catch((err) => console.warn('QR Code generation failed:', err));
    }
  }, [mobileTransmitterUrl]);

  // Check Web Bluetooth support
  useEffect(() => {
    if (typeof navigator !== 'undefined' && !('bluetooth' in navigator)) {
      setBleSupport(false);
    }
  }, []);

  useEffect(() => () => {
    for (const { device, onDisconnected } of bleConnectionsRef.current.values()) {
      device.removeEventListener?.('gattserverdisconnected', onDisconnected);
      if (device.gatt?.connected) device.gatt.disconnect();
    }
    bleConnectionsRef.current.clear();
  }, []);

  // Poll phone camera status if phone tab is open
  useEffect(() => {
    if (!isOpen || activeTab !== 'phone') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/phone-camera/latest-frame/${pairCode}`);
        const json = await res.json();
        if (json.success && json.data) {
          setPhoneStreamData({
            isOnline: json.online,
            deviceModel: json.data.deviceModel,
            batteryLevel: json.data.batteryLevel,
            fps: json.data.fps,
            frameBase64: json.data.frameBase64,
            lastSeenMs: json.data.ageMs,
          });

          // Automatically set the target channel's feed mode to phone_stream
          if (json.online) {
            onUpdateChannel(targetChannelId, {
              feedMode: 'phone_stream',
              phoneConnected: true,
              phoneDeviceModel: json.data?.deviceModel,
              lastFrameReceivedAt: Date.now(),
              pairCode,
            });
          }
        } else {
          setPhoneStreamData({ isOnline: false });
        }
      } catch (err) {
        setPhoneStreamData({ isOnline: false });
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [isOpen, activeTab, pairCode, targetChannelId, onUpdateChannel]);

  // Copy mobile link to clipboard
  const handleCopyLink = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(mobileTransmitterUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  // Open mobile transmitter in a test window
  const handleOpenLocalTestTransmitter = () => {
    window.open(mobileTransmitterUrl, '_blank', 'width=420,height=750');
  };

  // Web Bluetooth Scan Trigger
  const handleScanBluetooth = async () => {
    setBleError(null);
    setIsScanningBle(true);

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setBleError('Bluetooth requires a secure HTTPS page (localhost is allowed). Open this dashboard over HTTPS, then try again.');
      setIsScanningBle(false);
      return;
    }

    if (!('bluetooth' in navigator)) {
      setBleError('Web Bluetooth API is not supported in this browser. Use Chrome/Edge on Desktop/Android, or connect your Bluetooth camera as a wireless video input.');
      setIsScanningBle(false);
      return;
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['battery_service', 'device_information', 'generic_access'],
      });

      if (device) {
        if (!device.gatt) {
          throw new Error('This Bluetooth device does not expose a GATT connection. Choose a BLE device or select its video feed from system camera inputs.');
        }

        // requestDevice only grants permission. Open the actual GATT link and
        // reflect the real connection state instead of assuming it connected.
        await device.gatt.connect();
        const newBleDevice: BluetoothDeviceInfo = {
          id: device.id || `ble-${Date.now()}`,
          name: device.name || 'Bluetooth LE Device',
          connected: Boolean(device.gatt.connected),
          type: 'generic',
        };

        const onDisconnected = () => {
          bleConnectionsRef.current.delete(newBleDevice.id);
          setBleDevices((previous) => previous.map((entry) =>
            entry.id === newBleDevice.id ? { ...entry, connected: false } : entry
          ));
        };
        device.addEventListener('gattserverdisconnected', onDisconnected);
        bleConnectionsRef.current.set(newBleDevice.id, { device, onDisconnected });

        setBleDevices((prev) => {
          const filtered = prev.filter((d) => d.id !== newBleDevice.id);
          return [...filtered, newBleDevice];
        });
      }
    } catch (err: any) {
      if (err.name === 'NotFoundError') {
        setBleError('No Bluetooth device was selected. Keep it nearby and discoverable, then try again.');
      } else {
        setBleError(err.message || 'Bluetooth connection failed. Make sure the device is nearby and not connected to another app.');
      }
    } finally {
      setIsScanningBle(false);
    }
  };

  const handleDisconnectBluetooth = (deviceId: string) => {
    const connection = bleConnectionsRef.current.get(deviceId);
    if (connection) {
      connection.device.removeEventListener?.('gattserverdisconnected', connection.onDisconnected);
      if (connection.device.gatt?.connected) connection.device.gatt.disconnect();
      bleConnectionsRef.current.delete(deviceId);
    }
    setBleDevices((previous) => previous.map((device) =>
      device.id === deviceId ? { ...device, connected: false } : device
    ));
  };

  // Bind IP / RTSP / MJPEG Stream
  const handleApplyIpStream = () => {
    if (!customStreamUrl.trim()) return;
    setIpStreamStatus('testing');
    setTimeout(() => {
      setIpStreamStatus('success');
      onUpdateChannel(targetChannelId, {
        feedMode: 'ip_stream',
        streamUrl: customStreamUrl.trim(),
        customImageSrc: customStreamUrl.trim(),
      });
    }, 600);
  };

  if (!isOpen) return null;

  const targetCamera = cameras.find((c) => c.id === targetChannelId) || cameras[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        id="modal-bluetooth-and-remote-camera"
        className="bg-white rounded-2xl border border-zinc-200 shadow-2xl max-w-3xl w-full overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="bg-zinc-950 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-600 text-white">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <span>Multi-Camera & Remote Device Setup</span>
                <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[11px] font-mono border border-blue-500/40">
                  Phone • Bluetooth • IP Cam
                </span>
              </h2>
              <p className="text-xs text-zinc-400 font-mono">
                Connect phone video over QR/Wi-Fi, BLE sensors, and external camera inputs into the surveillance matrix
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Channel Binding Target Selector Bar */}
        <div className="bg-zinc-100 border-b border-zinc-200 px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-zinc-700 uppercase">Target Surveillance Channel:</span>
            <div className="flex items-center gap-1.5">
              {cameras.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setTargetChannelId(c.id)}
                  className={`px-3 py-1 rounded-lg font-mono text-xs font-bold transition-all ${
                    targetChannelId === c.id
                      ? 'bg-zinc-950 text-white shadow-sm ring-2 ring-zinc-800'
                      : 'bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-200'
                  }`}
                >
                  CAM 0{c.channelNumber} ({c.zone})
                </button>
              ))}
            </div>
          </div>

          <div className="text-[11px] font-mono text-zinc-500">
            Active Mode: <span className="font-bold text-zinc-800 uppercase">{targetCamera.feedMode}</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-200 bg-zinc-50 px-6 pt-2">
          <button
            onClick={() => setActiveTab('phone')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold font-mono border-b-2 transition-all ${
              activeTab === 'phone'
                ? 'border-blue-600 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <Smartphone className="w-4 h-4 text-blue-600" />
            <span>Phone as Camera (QR Link)</span>
          </button>

          <button
            onClick={() => setActiveTab('bluetooth')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold font-mono border-b-2 transition-all ${
              activeTab === 'bluetooth'
                ? 'border-blue-600 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <Bluetooth className="w-4 h-4 text-indigo-600" />
            <span>Bluetooth Devices</span>
          </button>

          <button
            onClick={() => setActiveTab('ip_stream')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold font-mono border-b-2 transition-all ${
              activeTab === 'ip_stream'
                ? 'border-blue-600 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <Wifi className="w-4 h-4 text-emerald-600" />
            <span>IP / DroidCam Stream</span>
          </button>

          <button
            onClick={() => setActiveTab('matrix')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold font-mono border-b-2 transition-all ${
              activeTab === 'matrix'
                ? 'border-blue-600 text-blue-700 bg-white rounded-t-lg'
                : 'border-transparent text-zinc-600 hover:text-zinc-900'
            }`}
          >
            <Layers className="w-4 h-4 text-zinc-800" />
            <span>4-Channel Mapping</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: PHONE AS CAMERA */}
          {activeTab === 'phone' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
              {/* Left Column: QR Code & Mobile URL */}
              <div className="bg-zinc-50 rounded-2xl border border-zinc-200 p-5 flex flex-col items-center text-center space-y-4">
                <div className="w-full flex items-center justify-between text-xs font-mono font-bold text-zinc-700 pb-2 border-b border-zinc-200">
                  <span>📱 Scan with Smartphone</span>
                  <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px]">
                    Pair Code: {pairCode}
                  </span>
                </div>

                {qrCodeDataUrl ? (
                  <div className="p-2 bg-white rounded-xl border border-zinc-300 shadow-md">
                    <img
                      src={qrCodeDataUrl}
                      alt="Scan to pair mobile phone camera"
                      className="w-48 h-48 object-contain rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="w-48 h-48 bg-zinc-200 animate-pulse rounded-xl flex items-center justify-center text-xs font-mono text-zinc-500">
                    Generating QR...
                  </div>
                )}

                <p className="text-xs text-zinc-600 leading-relaxed font-sans">
                  Phone camera video uses the QR link over Wi-Fi/WebRTC. Bluetooth pairing cannot carry a phone camera video stream. Scan this link from a phone on the same network to send live frames into{' '}
                  <strong className="text-zinc-900 font-mono">CAM 0{targetCamera.channelNumber}</strong>.
                </p>

                {(phoneLinkUsesLoopback || phoneLinkNeedsHttps) && (
                  <div className="w-full rounded-xl border border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-900">
                    <span className="font-bold">Phone camera link cannot work from this address. </span>
                    {phoneLinkUsesLoopback
                      ? 'This QR points to localhost, which means the phone itself. Open this dashboard using a reachable HTTPS address on your network before scanning.'
                      : 'Mobile browser camera access requires HTTPS. Open this dashboard using a reachable HTTPS address, then scan the refreshed QR code.'}
                  </div>
                )}

                {/* Direct Link & Copy */}
                <div className="w-full flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={mobileTransmitterUrl}
                    className="flex-1 bg-white border border-zinc-300 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-zinc-700 truncate"
                  />
                  <button
                    onClick={handleCopyLink}
                    className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-sm"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>

                {/* Test in New Window Button */}
                <button
                  onClick={handleOpenLocalTestTransmitter}
                  className="w-full py-2 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-300 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-2 transition-all"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Test Mobile Transmitter (New Window)</span>
                </button>
              </div>

              {/* Right Column: Live Connection Status & Preview */}
              <div className="bg-zinc-50 rounded-2xl border border-zinc-200 p-5 space-y-4 flex flex-col justify-between h-full">
                <div>
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                    <h4 className="text-xs font-mono font-bold text-zinc-800 uppercase flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5 text-blue-600" />
                      Live Feed Status
                    </h4>
                    {phoneStreamData.isOnline ? (
                      <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold border border-emerald-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                        ONLINE & STREAMING
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-mono font-bold border border-amber-300">
                        WAITING FOR PHONE...
                      </span>
                    )}
                  </div>

                  {/* Feed Preview Box */}
                  <div className="mt-4 aspect-video w-full bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 flex items-center justify-center relative shadow-inner">
                    {phoneStreamData.frameBase64 ? (
                      <img
                        src={phoneStreamData.frameBase64}
                        alt="Paired Phone Feed"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center p-4">
                        <Smartphone className="w-8 h-8 text-zinc-600 mx-auto mb-2 animate-bounce" />
                        <p className="text-xs font-mono text-zinc-400">Scan QR Code to Start Stream</p>
                        <p className="text-[10px] text-zinc-600 mt-1">Frames will preview here automatically</p>
                      </div>
                    )}

                    {phoneStreamData.isOnline && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/70 text-emerald-400 font-mono text-[9px] font-bold border border-emerald-500/30">
                        {phoneStreamData.fps || 10} FPS
                      </div>
                    )}
                  </div>

                  {/* Device Telemetry Specs */}
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-mono">
                    <div className="p-2.5 rounded-xl bg-white border border-zinc-200">
                      <span className="text-zinc-400 text-[10px] block">DEVICE MODEL:</span>
                      <span className="font-bold text-zinc-800 truncate block">
                        {phoneStreamData.deviceModel || 'Not Connected'}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-xl bg-white border border-zinc-200">
                      <span className="text-zinc-400 text-[10px] block">BATTERY STATUS:</span>
                      <span className="font-bold text-zinc-800">
                        {phoneStreamData.batteryLevel !== undefined ? `${phoneStreamData.batteryLevel}%` : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    onUpdateChannel(targetChannelId, {
                      feedMode: 'phone_stream',
                      customImageSrc: phoneStreamData.frameBase64 || undefined,
                      pairCode,
                    });
                    onClose();
                  }}
                  className="w-full py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white rounded-xl font-mono text-xs font-bold uppercase transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Bind Phone to CAM 0{targetCamera.channelNumber} & View Matrix</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: BLUETOOTH & BLE DEVICES */}
          {activeTab === 'bluetooth' && (
            <div className="space-y-6">
              <div className="bg-zinc-50 rounded-2xl border border-zinc-200 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-zinc-200">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                      <Bluetooth className="w-4 h-4 text-indigo-600" />
                      <span>Web Bluetooth Discovery & BLE Sensors</span>
                    </h3>
                    <p className="text-xs text-zinc-500 font-mono mt-0.5">
                      BLE pairing is for supported sensors. For phone video, use the Phone QR tab; for a Bluetooth camera, select it from system video inputs below.
                    </p>
                  </div>

                  <button
                    id="btn-scan-bluetooth-devices"
                    onClick={handleScanBluetooth}
                    disabled={isScanningBle}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-2 transition-all shadow-sm"
                  >
                    <Bluetooth className={`w-3.5 h-3.5 ${isScanningBle ? 'animate-spin' : ''}`} />
                    <span>{isScanningBle ? 'Scanning Bluetooth...' : 'Pair BLE Sensor'}</span>
                  </button>
                </div>

                {bleError && (
                  <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Bluetooth Notice: </span>
                      <span>{bleError}</span>
                    </div>
                  </div>
                )}

                {bleDevices.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {bleDevices.map((device) => (
                      <div key={device.id} className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-zinc-800">{device.name}</div>
                          <div className={`mt-0.5 text-[10px] font-mono ${device.connected ? 'text-emerald-700' : 'text-zinc-500'}`}>
                            {device.connected ? 'GATT CONNECTED · SENSOR LINK' : 'DISCONNECTED'}
                          </div>
                        </div>
                        {device.connected && (
                          <button
                            type="button"
                            onClick={() => handleDisconnectBluetooth(device.id)}
                            className="ml-3 rounded-lg border border-zinc-300 px-2.5 py-1.5 text-[10px] font-mono font-bold text-zinc-700 hover:bg-zinc-100"
                          >
                            Disconnect
                          </button>
                        )}
                      </div>
                    ))}
                    <p className="text-[10px] font-mono text-zinc-500">
                      BLE pairing does not carry phone video. Use the Phone QR tab or choose a Bluetooth webcam from system video inputs.
                    </p>
                  </div>
                )}

                {/* Available Video Input Devices from System (e.g. Paired Bluetooth Webcams, DroidCam, EpocCam) */}
                <div className="mt-5 space-y-3">
                  <h4 className="text-xs font-mono font-bold text-zinc-700 uppercase">
                    Detected System Cameras & Wireless Video Inputs ({availableMediaDevices.length}):
                  </h4>

                  {availableMediaDevices.length === 0 ? (
                    <div className="p-4 bg-white rounded-xl border border-zinc-200 text-center text-xs font-mono text-zinc-500">
                      No system video inputs detected. Grant camera permissions to enumerate devices.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {availableMediaDevices.map((dev, idx) => {
                        const isSelectedForThisCam = targetCamera.deviceId === dev.deviceId && targetCamera.feedMode === 'webcam';
                        const isBluetoothOrWireless = /bluetooth|wireless|remote|phone|droidcam|camo|epoccam/i.test(dev.label);

                        return (
                          <div
                            key={dev.deviceId || idx}
                            className={`p-3.5 rounded-xl border flex items-center justify-between transition-all ${
                              isSelectedForThisCam
                                ? 'bg-indigo-50 border-indigo-300 ring-2 ring-indigo-400'
                                : 'bg-white border-zinc-200 hover:border-zinc-300'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg ${isBluetoothOrWireless ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
                                {isBluetoothOrWireless ? <Bluetooth className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                              </div>
                              <div>
                                <div className="font-bold text-xs text-zinc-900">
                                  {dev.label || `Camera Device ${idx + 1}`}
                                </div>
                                <div className="text-[10px] font-mono text-zinc-500 flex items-center gap-1.5">
                                  {isBluetoothOrWireless && (
                                    <span className="px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-800 font-bold">
                                      WIRELESS / BT
                                    </span>
                                  )}
                                  <span>ID: {dev.deviceId.substring(0, 12)}...</span>
                                </div>
                              </div>
                            </div>

                            <button
                              onClick={() => {
                                onUpdateChannel(targetChannelId, {
                                  feedMode: 'webcam',
                                  deviceId: dev.deviceId,
                                });
                              }}
                              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                                isSelectedForThisCam
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
                              }`}
                            >
                              {isSelectedForThisCam ? 'Active' : 'Assign to CAM'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: IP / DROIDCAM STREAM */}
          {activeTab === 'ip_stream' && (
            <div className="bg-zinc-50 rounded-2xl border border-zinc-200 p-5 space-y-5">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                  <Wifi className="w-4 h-4 text-emerald-600" />
                  <span>IP Camera & Phone Webcam Apps (DroidCam / IP Webcam / EpocCam)</span>
                </h3>
                <p className="text-xs text-zinc-500 font-mono mt-0.5">
                  Stream directly from popular wireless phone camera apps or Wi-Fi security IP cameras over your local network
                </p>
              </div>

              {/* Quick App Presets */}
              <div className="space-y-2">
                <span className="text-xs font-mono font-bold text-zinc-700 uppercase">Quick App Presets:</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    onClick={() => setCustomStreamUrl('http://192.168.1.50:8080/video')}
                    className="p-3 bg-white hover:bg-zinc-100 rounded-xl border border-zinc-200 text-left transition-all"
                  >
                    <div className="font-bold text-xs text-zinc-900">IP Webcam (Android)</div>
                    <div className="text-[10px] font-mono text-zinc-500">http://IP:8080/video</div>
                  </button>

                  <button
                    onClick={() => setCustomStreamUrl('http://192.168.1.50:4747/video')}
                    className="p-3 bg-white hover:bg-zinc-100 rounded-xl border border-zinc-200 text-left transition-all"
                  >
                    <div className="font-bold text-xs text-zinc-900">DroidCam (iOS/Android)</div>
                    <div className="text-[10px] font-mono text-zinc-500">http://IP:4747/video</div>
                  </button>

                  <button
                    onClick={() => setCustomStreamUrl('http://192.168.1.50:8080/shot.jpg')}
                    className="p-3 bg-white hover:bg-zinc-100 rounded-xl border border-zinc-200 text-left transition-all"
                  >
                    <div className="font-bold text-xs text-zinc-900">MJPEG / Snapshot URL</div>
                    <div className="text-[10px] font-mono text-zinc-500">http://IP:8080/shot.jpg</div>
                  </button>
                </div>
              </div>

              {/* URL Input */}
              <div className="space-y-2">
                <label className="text-xs font-mono font-bold text-zinc-700 uppercase block">
                  Camera Feed / Snapshot Stream URL:
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={customStreamUrl}
                    onChange={(e) => setCustomStreamUrl(e.target.value)}
                    placeholder="http://192.168.1.X:8080/video or /shot.jpg"
                    className="flex-1 px-3.5 py-2 bg-white border border-zinc-300 rounded-xl text-xs font-mono text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    onClick={handleApplyIpStream}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-mono font-bold uppercase transition-all shadow-sm flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Apply to CAM 0{targetCamera.channelNumber}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: 4-CHANNEL MATRIX MAPPING */}
          {activeTab === 'matrix' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-zinc-200">
                <h3 className="text-sm font-bold text-zinc-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-zinc-800" />
                  <span>Surveillance Channel Source Matrix</span>
                </h3>
                <span className="text-xs font-mono text-zinc-500">4 Independent Multi-Camera Feeds</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cameras.map((cam) => (
                  <div
                    key={cam.id}
                    className="p-4 rounded-xl border border-zinc-200 bg-zinc-50 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-zinc-900 text-white font-mono font-bold text-xs">
                          CAM 0{cam.channelNumber}
                        </span>
                        <span className="font-bold text-xs text-zinc-900">{cam.zone}</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-zinc-200 text-zinc-800 uppercase">
                        {cam.feedMode}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono">
                      <button
                        onClick={() => onUpdateChannel(cam.id, { feedMode: 'webcam' })}
                        className={`p-2 rounded-lg border font-bold transition-all ${
                          cam.feedMode === 'webcam'
                            ? 'bg-blue-600 text-white border-blue-700'
                            : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                        }`}
                      >
                        Webcam
                      </button>

                      <button
                        onClick={() => {
                          setTargetChannelId(cam.id);
                          setActiveTab('phone');
                        }}
                        className={`p-2 rounded-lg border font-bold transition-all ${
                          cam.feedMode === 'phone_stream'
                            ? 'bg-indigo-600 text-white border-indigo-700'
                            : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                        }`}
                      >
                        📱 Phone Cam
                      </button>

                      <button
                        onClick={() => onUpdateChannel(cam.id, { feedMode: 'simulation' })}
                        className={`p-2 rounded-lg border font-bold transition-all ${
                          cam.feedMode === 'simulation'
                            ? 'bg-zinc-900 text-white border-zinc-950'
                            : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100'
                        }`}
                      >
                        Scenario
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-zinc-100 px-6 py-3 border-t border-zinc-200 flex items-center justify-between text-xs font-mono text-zinc-600">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-zinc-800" />
            <span>Trinetra Hardware Multi-Camera Protocol Active</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-xs font-mono font-bold transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
