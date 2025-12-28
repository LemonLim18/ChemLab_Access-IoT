
import React from 'react';
import { Thermometer, Droplets, Snowflake, DoorOpen, DoorClosed, AlertTriangle } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import type { SensorData } from '../types';

interface RealtimeStatusCardProps {
  data: SensorData;
  history: SensorData[];
  onHoverSensor: (type: 'temperature' | 'humidity' | null) => void;
}

const RealtimeStatusCard: React.FC<RealtimeStatusCardProps> = ({ data, history, onHoverSensor }) => {
  const getTempBadge = (t: number) => {
    if (t > 7) return 'badge-error';
    if (t > 5) return 'badge-warning';
    return 'badge-success';
  };

  return (
    <div className="card bg-base-100 shadow-xl overflow-hidden">
      <div className="card-body px-4 pb-4 pt-2 sm:p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="card-title text-sm uppercase text-base-content/60 tracking-wider font-semibold">Live Conditions</h2>
          <div className="text-[10px] text-base-content/40">Last sync: {new Date(data.lastUpdated).toLocaleTimeString()}</div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Temperature */}
          <div
            className="flex flex-col gap-1 p-3 rounded-2xl bg-base-200/50 cursor-pointer hover:bg-base-200 transition-colors"
            onMouseEnter={() => onHoverSensor('temperature')}
            onMouseLeave={() => onHoverSensor(null)}
          >
            <div className="flex items-center justify-between">
              <Thermometer size={18} className="text-primary" />
              <span className={`badge badge-sm ${getTempBadge(data.temperature)}`}>
                {/* Modify the lower compartment temperature range */}
                {data.temperature > 7 ? 'Unsafe' : data.temperature > 4 ? 'Alert' : 'Optimal'}
              </span>
            </div>
            <div className="text-2xl font-bold">{data.temperature}°C</div>
            <div className="text-xs text-base-content/50">Fridge Temperature</div>
            <div className="h-8 w-full mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <Line type="monotone" dataKey="temperature" stroke="#641ae6" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Humidity */}
          <div
            className="flex flex-col gap-1 p-3 rounded-2xl bg-base-200/50 cursor-pointer hover:bg-base-200 transition-colors"
            onMouseEnter={() => onHoverSensor('humidity')}
            onMouseLeave={() => onHoverSensor(null)}
          >
            <div className="flex items-center justify-between">
              <Droplets size={18} className="text-info" />
              <span className="badge badge-sm badge-success">OK</span>
            </div>
            <div className="text-2xl font-bold">{data.humidity}%</div>
            <div className="text-xs text-base-content/50">Air Humidity</div>
            <div className="h-8 w-full mt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <Line type="monotone" dataKey="humidity" stroke="#00d7c0" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Freezer Status */}
          {(() => {
            const status = (data.freezerStatus || 'Frozen').toLowerCase();
            const isUnfreezing = status.includes('defreeze') || status.includes('unfreezing') || status.includes('defrosting') || status.includes('melting') || data.moistureAlert;

            return (
              <div className={`flex flex-col gap-1 p-3 rounded-2xl transition-colors ${isUnfreezing ? 'bg-error/10 border border-error/20' : 'bg-base-200/50'}`}>
                <div className="flex items-center justify-between">
                  <Snowflake size={18} className={isUnfreezing ? "text-error" : "text-success"} />
                  {isUnfreezing && (
                    <span className="animate-pulse text-[10px] text-error font-bold uppercase">Melting</span>
                  )}
                </div>
                <div className="text-lg font-bold capitalize">{data.freezerStatus || 'Frozen'}</div>
                <div className="text-xs text-base-content/50">Freezer Status</div>
                {isUnfreezing && (
                  <div className="flex items-center gap-1 text-[10px] text-error mt-1 font-bold">
                    <AlertTriangle size={10} /> Alert: Thawing
                  </div>
                )}
              </div>
            );
          })()}

          {/* Door Status */}
          <div className={`flex flex-col gap-1 p-3 rounded-2xl transition-colors ${data.doorOpen ? 'bg-error/10 border border-error/20' : 'bg-base-200/50'}`}>
            <div className="flex items-center justify-between">
              {data.doorOpen ? <DoorOpen size={18} className="text-error" /> : <DoorClosed size={18} className="text-success" />}
              {data.doorOpen && <span className="animate-pulse text-[10px] text-error font-bold">OPEN</span>}
            </div>
            <div className="text-lg font-bold">{data.doorOpen ? 'Open' : 'Closed'}</div>
            <div className="text-xs text-base-content/50">Door State</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RealtimeStatusCard;
