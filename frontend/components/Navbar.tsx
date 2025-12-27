
import React, { useState, useEffect } from 'react';
import { Search, Bell, Settings, User, Sun, Moon, MapPin } from 'lucide-react';

interface NavbarProps {
  onOpenSettings: () => void;
  onOpenAlerts: () => void;
  unreadCount: number;
  onToggleLocation: () => void;
  userLocation: { lat: number, lng: number } | null;
  isLocating: boolean;
}

const Navbar: React.FC<NavbarProps> = ({ onOpenSettings, onOpenAlerts, unreadCount, onToggleLocation, userLocation, isLocating }) => {
  const [theme, setTheme] = useState<'cupcake' | 'dark'>(
    (localStorage.getItem('theme') as 'cupcake' | 'dark') || 'cupcake'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'cupcake' ? 'dark' : 'cupcake'));
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

        <button className="btn btn-ghost btn-circle relative" onClick={onOpenAlerts}>
          <Bell size={20} />
          {unreadCount > 0 && (
            <span className="badge badge-xs badge-error indicator-item absolute top-2 right-2"></span>
          )}
        </button>

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
            <li><a>Profile</a></li>
            <li><a>Family Shared Access</a></li>
            <li><a>Logout</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Navbar;
