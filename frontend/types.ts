// TypeScript types for Chemical Lab Storage Container System

// ========== STORAGE STATE ==========
export interface StorageState {
  temperature: number;
  humidity: number;
  door_locked: boolean;
  last_access_time: string | null;
  last_access_by: string | null;
  intrusion_detected: boolean;
  alert_active: boolean;
  lastUpdated: string;
  lastTemperatureUpdate?: string;
  lastHumidityUpdate?: string;
  door_closed_since?: string;
}

// ========== ACCESS CONTROL ==========
export interface AccessAttempt {
  id: string;
  timestamp: string;
  person_name: string | null;
  authorized: boolean;
  image_url: string;
}

export interface RegisteredUser {
  id: string;
  name: string;
  registered_at: string;
  face_image_url: string;
}

// ========== ALERTS & NOTIFICATIONS ==========
export type AlertType =
  | "unauthorized"
  | "intrusion"
  | "temperature_high"
  | "temperature_low"
  | "humidity_high"
  | "humidity_low"
  | "door_open";

export interface SecurityAlert {
  id: string;
  type: AlertType;
  message: string;
  timestamp: string;
  resolved: boolean;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: "info" | "warning" | "error" | "success";
  timestamp: string;
  isRead: boolean;
}

// ========== ENVIRONMENT THRESHOLDS ==========
export interface EnvironmentThresholds {
  temperature_max: number;
  temperature_min: number;
  humidity_max: number;
  humidity_min: number;
}

// ========== WEBSOCKET MESSAGES ==========
export type WebSocketMessageType =
  | "state_update"
  | "access_granted"
  | "access_denied"
  | "security_alert"
  | "alert"
  | "env_warning"
  | "anomaly_resolved";

export interface WebSocketMessage {
  type: WebSocketMessageType;
  data: any;
}

// ========== API RESPONSES ==========
export interface ApiResponse<T = any> {
  status: "success" | "error";
  data?: T;
  message?: string;
}

// ========== USER SETTINGS ==========
export interface UserSettings {
  name: string;
  email: string;
  email_enabled: boolean;
}
