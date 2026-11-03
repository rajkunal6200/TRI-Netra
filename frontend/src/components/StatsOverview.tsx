import React from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Scan, 
  Activity, 
  Eye, 
  Users
} from 'lucide-react';
import { ThreatLevel } from '@shared/types';

interface StatsOverviewProps {
  totalScansCount: number;
  authorizedMatchesCount: number;
  unauthorizedBreachesCount: number;
  authorizedPersonnelCount: number;
  currentThreatLevel: ThreatLevel;
  activeZone: string;
}

export const StatsOverview: React.FC<StatsOverviewProps> = ({
  totalScansCount,
  authorizedMatchesCount,
  unauthorizedBreachesCount,
  authorizedPersonnelCount,
  currentThreatLevel,
  activeZone,
}) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {/* Total Scans Card */}
      <div className="bg-white p-4 rounded-xl border border-zinc-200 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
        <div>
          <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider">Total Detections</div>
          <div className="text-2xl font-black text-zinc-950 mt-1 font-sans">
            {totalScansCount.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-600 font-mono mt-0.5">Continuous Vision Stream</div>
        </div>
        <div className="p-2.5 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-800">
          <Scan className="w-5 h-5" />
        </div>
      </div>

      {/* Authorized Matches Card */}
      <div className="bg-white p-4 rounded-xl border border-zinc-200 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
        <div>
          <div className="text-[10px] font-mono font-bold text-emerald-700 uppercase tracking-wider">Verified Personnel</div>
          <div className="text-2xl font-black text-emerald-700 mt-1 font-sans">
            {authorizedMatchesCount.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
            {authorizedPersonnelCount} Whitelisted
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700">
          <ShieldCheck className="w-5 h-5" />
        </div>
      </div>

      {/* Unauthorized Intrusions Card */}
      <div className="bg-white p-4 rounded-xl border border-zinc-200 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
        <div>
          <div className="text-[10px] font-mono font-bold text-red-600 uppercase tracking-wider">Intrusion Alerts</div>
          <div className="text-2xl font-black text-red-600 mt-1 font-sans">
            {unauthorizedBreachesCount.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">Perimeter Breaches</div>
        </div>
        <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-600">
          <ShieldAlert className="w-5 h-5" />
        </div>
      </div>

      {/* Active Defense Zone Status */}
      <div className="bg-white p-4 rounded-xl border border-zinc-200 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
        <div>
          <div className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-wider">Monitored Sector</div>
          <div className="text-base font-black text-zinc-950 mt-1 truncate max-w-[130px] font-sans">
            {activeZone}
          </div>
          <div className="text-[10px] text-emerald-700 font-mono flex items-center gap-1 mt-0.5 font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
            <span>GRID: ACTIVE</span>
          </div>
        </div>
        <div className="p-2.5 rounded-xl bg-zinc-100 border border-zinc-200 text-zinc-700">
          <Activity className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};
