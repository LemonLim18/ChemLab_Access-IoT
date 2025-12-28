
import React, { useState, useEffect } from 'react';
import { Bell, Sun, Moon, MapPin, Check, Info, AlertTriangle, AlertCircle, CheckCircle2, Activity } from 'lucide-react';
import type { Notification } from '../types';

interface NavbarProps {
  onOpenSettings: () => void;
  notifications: Notification[];
  anomalyEvents?: any[];
  onFetchEvents?: () => void;
  onMarkAsRead: (id: string) => void;
  onClearAll: () => void;
  onMarkAllAsRead: () => void;
  unreadCount: number;
  onToggleLocation: () => void;
  userLocation: { lat: number, lng: number } | null;
  isLocating: boolean;
  userName?: string;
}

const Navbar: React.FC<NavbarProps> = ({
  onOpenSettings,
  notifications,
  anomalyEvents = [],
  onFetchEvents,
  onMarkAsRead,
  onClearAll,
  onMarkAllAsRead,
  unreadCount,
  onToggleLocation,
  userLocation,
  isLocating,
  userName = "User"
}) => {
  const [theme, setTheme] = useState<'cupcake' | 'dark'>(
    (localStorage.getItem('theme') as 'cupcake' | 'dark') || 'cupcake'
  );

  const [view, setView] = useState<'notifications' | 'logs'>('notifications');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'cupcake' ? 'dark' : 'cupcake'));
  };

  const toggleView = () => {
    const nextView = view === 'notifications' ? 'logs' : 'notifications';
    setView(nextView);
    if (nextView === 'logs' && onFetchEvents) {
      onFetchEvents();
    }
  };

  return (
    <div className="navbar bg-base-100 shadow-md sticky top-0 z-50 px-4">
      <div className="flex-1">
        <a className="text-xl font-bold flex items-center gap-2 cursor-pointer">
          <span className="text-primary">❄️</span>
          <span className="hidden sm:inline">SmartFridge AI</span>
        </a>
      </div>
      <div className="flex-none flex items-center gap-1 sm:gap-2">
        <fieldset className="fieldset hidden md:inline-flex m-0 p-0 border-none">
          <div className="join">
            <input
              type="text"
              placeholder="Search..."
              className="input input-sm join-item bg-base-200 w-32 focus:w-48 transition-all"
            />
          </div>
        </fieldset>

        {/* GPS Location Toggle */}
        <button
          className={`btn btn-ghost btn-circle ${userLocation ? 'text-primary' : 'opacity-50'}`}
          onClick={onToggleLocation}
          title={userLocation ? `Location: ${userLocation.lat.toFixed(2)}, ${userLocation.lng.toFixed(2)}` : "Request GPS Location"}
        >
          {isLocating ? (
            <span className="loading loading-spinner loading-xs"></span>
          ) : (
            <div className="indicator">
              <MapPin size={20} />
              {userLocation && (
                <span className="badge badge-xs badge-primary indicator-item"></span>
              )}
            </div>
          )}
        </button>

        {/* Theme Toggle */}
        <button className="btn btn-ghost btn-circle" onClick={toggleTheme} title="Toggle Theme">
          {theme === 'cupcake' ? <Moon size={20} /> : <Sun size={20} className="text-warning" />}
        </button>

        {/* Notifications Dropdown */}
        <div className="dropdown dropdown-end">
          <button tabIndex={0} role="button" className="btn btn-ghost btn-circle relative z-[110]">
            <div className="indicator">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="badge badge-xs badge-error indicator-item"></span>
              )}
            </div>
          </button>
          <div tabIndex={0} className="dropdown-content z-[100] card card-compact w-screen sm:w-96 left-0 sm:left-auto sm:right-0 fixed sm:absolute p-2 shadow-2xl bg-base-100 border-y sm:border border-base-content/10 top-[64px] sm:top-auto sm:mt-2 rounded-none sm:rounded-2xl">
            <div className="card-body">
              <div className="flex flex-col gap-3 border-b border-base-content/5 pb-3">
                <div className="tabs tabs-boxed bg-base-200/50 p-1 flex">
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); setView('notifications'); }}
                    className={`rounded-xl flex-1 tab tab-sm font-black transition-all duration-300 ${view === 'notifications' ? 'tab-active !bg-primary !text-primary-content shadow-sm' : 'opacity-50 hover:opacity-100'}`}
                  >
                    Notifications
                  </button>
                  <button
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleView(); }}
                    className={`rounded-xl flex-1 tab tab-sm font-black transition-all duration-300 ${view === 'logs' ? 'tab-active !bg-primary !text-primary-content shadow-sm' : 'opacity-50 hover:opacity-100'}`}
                  >
                    Alert Logs
                  </button>
                </div>

                <div className="flex items-center justify-between px-1">
                  <h3 className="font-black text-[10px] uppercase tracking-widest opacity-40">
                    {view === 'notifications' ? `Recent Updates (${unreadCount})` : 'Anomaly Events'}
                  </h3>
                  {view === 'notifications' && notifications.length > 0 && (
                    <div className="flex gap-2">
                      <button onClick={onMarkAllAsRead} className="text-[10px] font-bold text-primary hover:underline">Mark all</button>
                      <button onClick={onClearAll} className="text-[10px] font-bold text-error hover:underline">Clear all</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="max-h-[70vh] overflow-y-auto no-scrollbar py-2 space-y-2">
                {view === 'notifications' ? (
                  notifications.length === 0 ? (
                    <div className="py-8 text-center opacity-30">
                      <Bell size={32} className="mx-auto mb-2" />
                      <p className="text-xs font-bold">All caught up!</p>
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`relative group p-3 rounded-2xl border transition-all duration-300 ${!n.isRead
                          ? 'bg-primary/5 border-primary/20 shadow-sm'
                          : 'bg-base-200/50 border-transparent hover:bg-base-200'
                          }`}
                      >
                        <div className="flex gap-3">
                          <div className={`w-8 h-8 rounded-xl shrink-0 flex items-center justify-center ${n.type === 'error' ? 'bg-error/10 text-error' :
                            n.type === 'warning' ? 'bg-warning/10 text-warning' :
                              n.type === 'success' ? 'bg-success/10 text-success' :
                                'bg-primary/10 text-primary'
                            }`}>
                            {n.type === 'error' && <AlertCircle size={16} />}
                            {n.type === 'warning' && <AlertTriangle size={16} />}
                            {n.type === 'success' && <CheckCircle2 size={16} />}
                            {n.type === 'info' && <Info size={16} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-1">
                              <h4 className={`text-xs font-black truncate ${!n.isRead ? 'text-base-content' : 'text-base-content/60'}`}>
                                {n.title}
                              </h4>
                              <span className="text-[9px] font-bold opacity-30 whitespace-nowrap mt-0.5">
                                {new Date(n.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className={`text-[11px] leading-relaxed mt-1 ${!n.isRead ? 'text-base-content/80' : 'text-base-content/50'}`}>
                              {n.message}
                            </p>
                          </div>
                        </div>
                        {!n.isRead && (
                          <button
                            onClick={() => onMarkAsRead(n.id)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity btn btn-ghost btn-xs btn-circle"
                            title="Mark as read"
                          >
                            <Check size={12} />
                          </button>
                        )}
                      </div>
                    ))
                  )
                ) : (
                  anomalyEvents.length === 0 ? (
                    <div className="py-8 text-center opacity-30">
                      <Activity size={32} className="mx-auto mb-2" />
                      <p className="text-xs font-bold">No historical events found</p>
                    </div>
                  ) : (
                    anomalyEvents.map((e, idx) => (
                      <div key={idx} className="p-3 rounded-2xl bg-base-200/50 border border-base-content/5">
                        <div className="flex gap-3">
                          <div className="w-8 h-8 rounded-xl shrink-0 bg-base-300 flex items-center justify-center text-base-content/60">
                            <Activity size={16} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-1">
                              <h4 className="text-xs font-black truncate text-base-content uppercase">
                                {e.alert_category || e.type} Resolved
                              </h4>
                              <span className="text-[9px] font-bold opacity-30 whitespace-nowrap mt-0.5">
                                {new Date(e.created_at).toLocaleDateString()}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed mt-1 text-base-content/70">
                              {e.alert_info || e.info}
                            </p>
                            <div className="mt-2 text-[9px] font-bold opacity-50 flex items-center gap-2">
                              <span>From: {new Date(e.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              <span>•</span>
                              <span>Duration: {e.duration_mins} mins</span>
                              <span>•</span>
                              <span>Until: {new Date(e.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )
                )}
              </div>

            </div>
          </div>
        </div>

        {/* <button className="btn btn-ghost btn-circle" onClick={onOpenSettings}>
          <Settings size={20} />
        </button> */}

        <div className="dropdown dropdown-end">
          <div tabIndex={0} role="button" className="btn btn-ghost btn-circle avatar">
            <div className="w-10 rounded-full border-2 border-primary/20">
              <img src="https://picsum.photos/seed/user1/100/100" alt="avatar" />
            </div>
          </div>
          <ul tabIndex={0} className="mt-3 z-1 p-2 shadow menu menu-sm dropdown-content bg-base-100 rounded-box w-52">
            <li className="menu-title px-4 py-2 opacity-50 text-[10px] font-black uppercase tracking-widest">{userName}</li>
            <li><a>Profile</a></li>
            <li><a>Family Shared Access</a></li>
            <li><a onClick={onOpenSettings}>Settings</a></li>
            <li className="border-t border-base-content/5 mt-1 pt-1"><a className="text-error font-bold">Logout</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Navbar;
