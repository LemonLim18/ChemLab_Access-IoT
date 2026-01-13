// Constants for Chemical Lab Storage Container System

import type { StorageState, Notification, EnvironmentThresholds } from './types';

export const INITIAL_STORAGE_STATE: StorageState = {
  temperature: 20.0,
  humidity: 45,
  door_locked: true,
  last_access_time: null,
  last_access_by: null,
  intrusion_detected: false,
  alert_active: false,
  lastUpdated: new Date().toISOString()
};

export const INITIAL_NOTIFICATIONS: Notification[] = [
  {
    id: 'welcome',
    title: 'System Online',
    message: 'Chemical Lab Storage Container is operational.',
    type: 'success',
    timestamp: new Date().toISOString(),
    isRead: false
  }
];

export const DEFAULT_THRESHOLDS: EnvironmentThresholds = {
  temperature_max: 25,
  temperature_min: 15,
  humidity_max: 60,
  humidity_min: 30
};

// Color palette for the Chemical Lab theme
export const THEME_COLORS = {
  primary: '#0891b2',        // Cyan/Teal
  secondary: '#0e7490',      // Darker teal
  accent: '#06b6d4',         // Light cyan
  danger: '#dc2626',         // Red for alerts
  warning: '#f59e0b',        // Amber for warnings
  success: '#22c55e',        // Green for success
  info: '#3b82f6',           // Blue for info
  background: '#0f172a',     // Dark slate
  surface: '#1e293b',        // Lighter slate
  text: '#f8fafc',           // Light text
};

// Tab configuration
export const TABS = ['dashboard', 'access-log', 'users', 'settings'] as const;
export type TabType = typeof TABS[number];
