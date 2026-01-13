// ===== API Configuration for ChemLab Access Control =====
// Uses Vite environment variables with fallback to window.location for development

// Get API base URL from environment or fallback to current hostname
const getApiUrl = (): string => {
  // In production (Docker), use environment variable
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // In development, use current hostname
  return `http://${window.location.hostname}:8000`;
};

// Get WebSocket URL from environment or fallback to current hostname
const getWsUrl = (): string => {
  // In production (Docker), use environment variable
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  // In development, use current hostname
  return `ws://${window.location.hostname}:8000/ws`;
};

export const API_URL = getApiUrl();
export const WS_URL = getWsUrl();

// Helper function to construct API endpoints
export const api = {
  state: `${API_URL}/api/state`,
  accessLogs: `${API_URL}/api/access-logs`,
  registeredUsers: `${API_URL}/api/registered-users`,
  thresholds: `${API_URL}/api/thresholds`,
  trigger: `${API_URL}/api/trigger`,
  registerFace: `${API_URL}/api/register-face`,
  userFaceStatus: (userId: string) => `${API_URL}/api/user-face-status/${userId}`,
  deleteUser: (userId: string) => `${API_URL}/api/registered-users/${userId}`,
};
