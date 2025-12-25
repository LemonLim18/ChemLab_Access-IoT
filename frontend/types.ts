export const FreshnessStatus = {
  GOOD: 'Good',
  NEAR_EXPIRY: 'Near Expiry',
  EXPIRED: 'Expired',
  SPOILED: 'Spoiled'
} as const;

export type FreshnessStatus =
  typeof FreshnessStatus[keyof typeof FreshnessStatus];

export interface FridgeItem {
  id: string;
  name: string;
  category: string;
  quantity: number; // percentage or count
  unit: 'percent' | 'count';
  expiryDate?: string;
  addedDate: string;
  status: FreshnessStatus;
  thumbnail: string;
  reorderThreshold: number;
}

export interface SensorData {
  temperature: number;
  humidity: number;
  voc: number; // MQ2/VOC level
  doorOpen: boolean;
  moistureAlert: boolean;
  latest_image_url?: string;
  lastCaptureTime?: string;
  inventory?: any[];
  lastUpdated: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  timestamp: string;
  isRead: boolean;
}

export interface Recipe {
  name: string;
  description: string;
  missingIngredients: string[];
  cookTime: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  instructions?: string[];
  fullIngredients?: string[];
}

export interface StoreResult {
  name: string;
  address: string;
  distance?: string;
  priceLevel?: string;
  uri: string;
}

export interface BuyItem {
  id: string;
  name: string;
  source: 'low-stock' | 'manual';
  completed: boolean;
}