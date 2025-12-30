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
  quantity: number; // item count
  status: FreshnessStatus;
  reorderThreshold: number;
}

export interface SensorData {
  temperature: number;
  humidity: number;
  voc: number; // MQ2/VOC level
  doorOpen: boolean;
  freezerStatus: string;
  moistureAlert: boolean;
  latest_image_url?: string;
  lastCaptureTime?: string;
  inventory?: any[];
  shopping_list?: any[];
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
  id?: string;
  name: string;
  description: string;
  missingIngredients: string[];
  cookTime: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  instructions?: string[];
  fullIngredients?: string[];
  imageUrl?: string;
}

export interface PricePoint {
  date: string;
  price: number;
}

export interface StoreItem {
  item_code: string;
  item: string;
  price: number;
  unit: string;
  date: string;
  item_group?: string;
  item_category?: string;
  history: PricePoint[];
}

export interface StoreResult {
  name: string;
  address: string;
  distance?: string;
  priceLevel?: string;
  uri: string;
  // Fields for real store data
  premise: string;
  premise_type: string;
  min_price: number;
  distance_km?: number;
  lat?: number;
  lon?: number;
  items: StoreItem[];
  last_date: string;
  thumbnail_url?: string;
}

export interface BuyItem {
  id: string | number;
  name: string;
  source: 'low-stock' | 'manual'; 
  quantity: number;
  completed: boolean;
}