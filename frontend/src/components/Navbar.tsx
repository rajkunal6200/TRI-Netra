import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  ShieldAlert, 
  ShieldCheck,
  Volume2, 
  VolumeX, 
  Radio, 
  Settings, 
  Users, 
  AlertTriangle, 
  Lock, 
  Unlock,
  Eye,
  Camera,
  User
} from 'lucide-react';
import { ThreatLevel, AdminUser } from '@shared/types';

interface NavbarProps {
  activeTab: 'live' | 'directory' | 'incidents';
  setActiveTab: (tab: 'live' | 'directory' | 'incidents') => void;
  activeZone: string;
  setActiveZone: (zone: string) => void;
  isAudioMuted: boolean;
  setIsAudioMuted: (muted: boolean) => void;
  isLockdownActive: boolean;
  setIsLockdownActive: (lockdown: boolean) => void;
  onOpenSettings: () => void;
  activeIncidentCount: number;
  currentThreatLevel: ThreatLevel;
  isAutoScanning: boolean;
  isAdmin: boolean;
  adminUser: AdminUser | null;
  onOpenAdminLogin: () => void;
}

const ZONES = [
  'Main Entrance',
  'Server Vault',
  'Executive Suite',
  'Loading Bay',
  'Research Lab',
  'Control Room'
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  activeZone,
  setActiveZone,
  isAudioMuted,
  setIsAudioMuted,
  isLockdownActive,
  setIsLockdownActive,
  onOpenSettings,
  activeIncidentCount,
  currentThreatLevel,
  isAutoScanning,
  isAdmin,
  adminUser,
  onOpenAdminLogin,
}) => {
  const [timeString, setTimeString] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeString(
        now.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const getThreatColor = (level: ThreatLevel) => {
    switch (level) {
      case 'CRITICAL':
        return 'bg-red-50 text-red-700 border-red-300 font-bold';
      case 'HIGH':
        return 'bg-orange-50 text-orange-700 border-orange-300 font-semibold';
      case 'MEDIUM':
        return 'bg-amber-50 text-amber-800 border-amber-300 font-medium';
      case 'LOW':
      case 'NONE':
      default:
        return 'bg-emerald-50 text-emerald-700 border-emerald-300 font-medium';
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-zinc-200 text-zinc-900 select-none shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        {/* Brand & System Status */}
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-800 rounded-xl flex items-center justify-center shadow-md text-white border border-zinc-700/50 relative overflow-hidden group">
            <div className="absolute inset-0 bg-amber-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            <Eye className="w-5 h-5 text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-black tracking-tight text-zinc-950 uppercase font-sans">
                TRINETRA
              </h1>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200/80 font-bold shadow-2xs">
                VISION AI 3.7
              </span>
            </div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest leading-none font-mono mt-0.5 flex items-center gap-1.5 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              INTELLIGENT SURVEILLANCE GRID
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center bg-zinc-100 p-1 rounded-xl border border-zinc-200">
          <button
            id="tab-live-surveillance"
            onClick={() => setActiveTab('live')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all ${
              activeTab === 'live'
                ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200/80'
                : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Live Feed</span>
          </button>

          <button
            id="tab-incidents-feed"
            onClick={() => setActiveTab('incidents')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all relative ${
              activeTab === 'incidents'
                ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200/80'
                : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
            <span>Incident Logs</span>
            {activeIncidentCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-red-600 text-white animate-pulse">
                {activeIncidentCount}
              </span>
            )}
          </button>

          <button
            id="tab-personnel-directory"
            onClick={() => setActiveTab('directory')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all ${
              activeTab === 'directory'
                ? 'bg-white text-zinc-950 shadow-sm border border-zinc-200/80'
                : 'text-zinc-600 hover:text-zinc-950 hover:bg-zinc-200/60'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Authorized Directory</span>
          </button>
        </div>

        {/* Global Telemetry & Controls */}
        <div className="flex items-center gap-2.5">
          {/* Active Status & Uptime */}
          <div className="hidden lg:flex flex-col items-end font-mono">
            <span className="text-xs font-bold text-emerald-700 flex items-center">
              <span className="w-2 h-2 bg-emerald-500 rounded-full mr-2 animate-pulse"></span>
              {isAutoScanning ? 'AUTO-SCAN ENABLED' : 'STANDBY'}
            </span>
            <span className="text-[10px] text-zinc-500">{timeString || '--:--:--'}</span>
          </div>

          <div className="hidden lg:block h-7 w-px bg-zinc-200" />

          {/* Zone Selector */}
          <div className="hidden sm:flex items-center gap-1.5 bg-zinc-50 px-2.5 py-1.5 rounded-lg border border-zinc-200 text-xs font-mono">
            <span className="text-zinc-500 font-bold">ZONE:</span>
            <select
              id="select-zone"
              value={activeZone}
              onChange={(e) => setActiveZone(e.target.value)}
              className="bg-transparent text-zinc-900 font-semibold focus:outline-none cursor-pointer"
            >
              {ZONES.map((zone) => (
                <option key={zone} value={zone} className="bg-white text-zinc-900">
                  {zone}
                </option>
              ))}
            </select>
          </div>

          {/* Current Threat Level Indicator */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono ${getThreatColor(currentThreatLevel)}`}>
            <ShieldAlert className="w-3.5 h-3.5" />
            <span className="hidden md:inline">THREAT:</span>
            <span>{currentThreatLevel}</span>
          </div>

          {/* Sound Alarm Toggle */}
          <button
            id="btn-toggle-sound"
            onClick={() => setIsAudioMuted(!isAudioMuted)}
            title={isAudioMuted ? 'Unmute Security Sirens' : 'Mute Security Sirens'}
            className={`p-2 rounded-lg border transition-all ${
              isAudioMuted
                ? 'bg-zinc-100 border-zinc-200 text-zinc-400 hover:text-zinc-700'
                : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
            }`}
          >
            {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Emergency Lockdown Toggle */}
          <button
            id="btn-toggle-lockdown"
            onClick={() => setIsLockdownActive(!isLockdownActive)}
            title="Trigger Emergency Sector Lockdown"
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all ${
              isLockdownActive
                ? 'bg-red-600 border-red-700 text-white animate-pulse shadow-md shadow-red-500/20'
                : 'bg-zinc-100 border-zinc-300 text-zinc-800 hover:border-red-500 hover:bg-red-50 hover:text-red-700'
            }`}
          >
            {isLockdownActive ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isLockdownActive ? 'LOCKDOWN' : 'LOCKDOWN'}</span>
          </button>

          {/* Admin Authentication Status & Control */}
          <button
            id="btn-navbar-admin-status"
            onClick={onOpenAdminLogin}
            title={isAdmin ? `Admin Mode Active: ${adminUser?.username || 'admin'} - Click for options` : 'Click to Login as Administrator with Password'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-bold transition-all ${
              isAdmin
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100 shadow-2xs'
                : 'bg-zinc-900 border-zinc-900 text-white hover:bg-zinc-800'
            }`}
          >
            {isAdmin ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span className="hidden sm:inline">ADMIN: ACTIVE</span>
                <span className="sm:hidden">ADMIN</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Admin Login</span>
                <span className="sm:hidden">Login</span>
              </>
            )}
          </button>

          {/* Settings Button */}
          <button
            id="btn-open-settings"
            onClick={onOpenSettings}
            title="Surveillance & AI Settings"
            className="p-2 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-700 hover:text-zinc-950 hover:bg-zinc-200 transition-all"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
