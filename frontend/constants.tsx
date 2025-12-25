
import { FreshnessStatus } from './types';
import type { FridgeItem, SensorData, Notification } from './types';

export const INITIAL_INVENTORY: FridgeItem[] = [
  {
    id: '1',
    name: 'Milk',
    category: 'Dairy',
    quantity: 1,
    status: FreshnessStatus.NEAR_EXPIRY,
    reorderThreshold: 2
  },
  {
    id: '2',
    name: 'Spinach',
    category: 'Vegetables',
    quantity: 1,
    status: FreshnessStatus.GOOD,
    reorderThreshold: 1
  },
  {
    id: '3',
    name: 'Chicken',
    category: 'Meat',
    quantity: 1,
    status: FreshnessStatus.GOOD,
    reorderThreshold: 1
  },
  {
    id: '4',
    name: 'Yogurt',
    category: 'Dairy',
    quantity: 1,
    status: FreshnessStatus.GOOD,
    reorderThreshold: 1
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
