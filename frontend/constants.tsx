
import { FreshnessStatus } from './types';
import type { FridgeItem, SensorData, Notification } from './types';

export const INITIAL_INVENTORY: FridgeItem[] = [
  {
    id: '1',
    name: 'Whole Milk',
    category: 'Dairy',
    quantity: 30,
    unit: 'percent',
    expiryDate: '2024-05-20',
    addedDate: '2024-05-10',
    status: FreshnessStatus.NEAR_EXPIRY,
    thumbnail: 'https://picsum.photos/seed/milk/200/200',
    reorderThreshold: 20
  },
  {
    id: '2',
    name: 'Organic Spinach',
    category: 'Vegetables',
    quantity: 1,
    unit: 'count',
    expiryDate: '2024-05-15',
    addedDate: '2024-05-12',
    status: FreshnessStatus.GOOD,
    thumbnail: 'https://picsum.photos/seed/spinach/200/200',
    reorderThreshold: 1
  },
  {
    id: '3',
    name: 'Chicken Breast',
    category: 'Meat',
    quantity: 500,
    unit: 'count',
    expiryDate: '2024-05-14',
    addedDate: '2024-05-11',
    status: FreshnessStatus.GOOD,
    thumbnail: 'https://picsum.photos/seed/chicken/200/200',
    reorderThreshold: 200
  },
  {
    id: '4',
    name: 'Greek Yogurt',
    category: 'Dairy',
    quantity: 80,
    unit: 'percent',
    expiryDate: '2024-05-25',
    addedDate: '2024-05-10',
    status: FreshnessStatus.GOOD,
    thumbnail: 'https://picsum.photos/seed/yogurt/200/200',
    reorderThreshold: 25
  }
];

export const INITIAL_SENSORS: SensorData = {
  temperature: 3.8,
  humidity: 42,
  voc: 120,
  doorOpen: false,
  moistureAlert: false,
  lastUpdated: new Date().toISOString()
};

export const INITIAL_NOTIFICATIONS: Notification[] = [
  {
    id: 'n1',
    title: 'Low Stock Alert',
    message: 'Whole Milk is at 30%. Consider reordering.',
    type: 'warning',
    timestamp: new Date().toISOString(),
    isRead: false
  }
];

export const CATEGORIES = ['Dairy', 'Vegetables', 'Fruits', 'Meat', 'Beverages', 'Condiments', 'Others'];
