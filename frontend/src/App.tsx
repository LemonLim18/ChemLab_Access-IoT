import React, { useState, useEffect, useCallback } from 'react';
import Swal from 'sweetalert2';
import { LayoutDashboard, Search, ShoppingCart, ExternalLink, ChefHat, Plus, Map, Camera, Package, Activity, MapPin, DollarSign, User, LogOut, Send, ArrowLeft, BookOpen, Clock, Sparkles, Trash2, ListFilter, RefreshCw, Check, Milk, Carrot, Apple, Beef, CupSoda, Utensils, List, ChevronRight, Bell, Eye, X } from 'lucide-react';

import type { FridgeItem, SensorData, Notification, Recipe, StoreResult, BuyItem } from '../types';
import { FreshnessStatus } from '../types';
import { INITIAL_INVENTORY, INITIAL_SENSORS, INITIAL_NOTIFICATIONS } from '../constants';
import Navbar from '../components/Navbar';
import RealtimeStatusCard from '../components/RealtimeStatusCard';
import SlotCard from '../components/SlotCard';
import CameraModal from '../components/CameraModal';
import Auth from '../components/Auth';
import { supabase } from './lib/supabaseClient';
import {
  getRecipeSuggestions,
  getRecipeDetails,
  analyzeSnapshot,
  searchStores,
  getLocationName
} from '../services/geminiService';



const getCategoryIcon = (category: string) => {
  const size = 18;
  switch (category.toLowerCase()) {
    case 'dairy': return <Milk size={size} className="text-blue-500" />;
    case 'vegetables': return <Carrot size={size} className="text-orange-500" />;
    case 'fruits': return <Apple size={size} className="text-red-500" />;
    case 'meat': return <Beef size={size} className="text-red-700" />;
    case 'beverages': return <CupSoda size={size} className="text-cyan-500" />;
    default: return <Utensils size={size} className="text-gray-400" />;
  }
};

const TABS = ['dashboard', 'search', 'inventory', 'recipes', 'shop', 'settings'];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [inventory, setInventory] = useState<FridgeItem[]>(INITIAL_INVENTORY);
  const [sensors, setSensors] = useState<SensorData>(INITIAL_SENSORS);
  const [notifications, setNotifications] = useState<Notification[]>(INITIAL_NOTIFICATIONS);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [chefPrompt, setChefPrompt] = useState('');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isLoadingRecipes, setIsLoadingRecipes] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  const [buyList, setBuyList] = useState<BuyItem[]>([]);
  const [manualBuyInput, setManualBuyInput] = useState('');

  // IoT Internal Camera State
  const [fridgeSnapshot, setFridgeSnapshot] = useState<string>('https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?q=80&w=1000&auto=format&fit=crop');
  const [pendingSnapshot, setPendingSnapshot] = useState<string>('');
  const lastKnownCaptureTime = React.useRef<string>('');
  const [lastSnapshotTime, setLastSnapshotTime] = useState<string>('');
  const [isRefreshingSnapshot, setIsRefreshingSnapshot] = useState(false);
  const [activeStoreModal, setActiveStoreModal] = useState<StoreResult | null>(null);
  const [isMapExpanded, setIsMapExpanded] = useState(true);
  const [expandedHistoryItem, setExpandedHistoryItem] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [anomalyStartTimes, setAnomalyStartTimes] = useState<Record<string, string>>({});

  // Store Finder State
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [nearestStores, setNearestStores] = useState<StoreResult[]>([]);
  const [cheapestStores, setCheapestStores] = useState<StoreResult[]>([]);
  // Used in handleStoreSearch commented-out code
  void setNearestStores;
  void setCheapestStores;
  const [isSearchingStores, setIsSearchingStores] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(() => {
    const cached = localStorage.getItem('smart_fridge_user_location');
    return cached ? JSON.parse(cached) : null;
  });
  const [fullLocationName, setFullLocationName] = useState<string | null>(() => {
    return localStorage.getItem('smart_fridge_full_location_name');
  });
  const [isLocating, setIsLocating] = useState(false);
  const [searchCache, setSearchCache] = useState<Record<string, {
    results: StoreResult[],
    location: { lat: number, lng: number } | null,
    timestamp: number
  }>>(() => {
    const saved = localStorage.getItem('smart_fridge_search_cache');
    try {
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.warn('[Cache] Failed to parse saved search cache:', e);
      return {};
    }
  });

  // Profile / Settings State
  const [userEmail, setUserEmail] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [userPhone, setUserPhone] = useState<string>('');
  const [toasts, setToasts] = useState<{ id: string, title: string, message: string, alert_category: 'info' | 'warning' | 'error' | 'success' }[]>([]);
  const [anomalyEvents, setAnomalyEvents] = useState<any[]>([]);

  const fetchAnomalyEvents = async () => {
    try {
      const res = await fetch(`http://${window.location.hostname}:8000/api/anomaly-events`);
      const data = await res.json();
      setAnomalyEvents(data);
    } catch (e) {
      console.error('[Anomalies] Failed to fetch events:', e);
    }
  };

  const addToast = (toast: any) => {
    const id = Math.random().toString(36).substring(7);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  };

  const syncUserConfig = useCallback(async (name: string, email: string, enabled: boolean) => {
    try {
      await fetch(`http://${window.location.hostname}:8000/api/user-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, email_enabled: enabled })
      });
      console.log('[Config] User settings synced to backend.');
    } catch (e) {
      console.error('[Config] Failed to sync settings:', e);
    }
  }, []);
  const [emailNotifications, setEmailNotifications] = useState<boolean>(() => {
    return localStorage.getItem('smart_fridge_email_enabled') !== 'false';
  });

  useEffect(() => {
    // Background Lock Logic
    const shouldLock = activeStoreModal || isCameraOpen || isAnalyzing || isLoadingDetails || selectedRecipe;
    if (shouldLock) {
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }
  }, [activeStoreModal, isCameraOpen, isAnalyzing, isLoadingDetails, selectedRecipe]);

  useEffect(() => {
    localStorage.setItem('smart_fridge_search_cache', JSON.stringify(searchCache));
  }, [searchCache]);

  useEffect(() => {
    const authChannel = new BroadcastChannel('supabase_auth_sync');

    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        const email = session.user.email || '';
        const name = session.user.user_metadata?.username || session.user.user_metadata?.display_name || session.user.user_metadata?.full_name || 'User';

        setUserEmail(email);
        setUserName(name);
        if (session.user.user_metadata?.phone) setUserPhone(session.user.user_metadata.phone);

        // Auto-sync to backend on load
        const storedEmail = localStorage.getItem('smart_fridge_email') || email;
        const enabled = localStorage.getItem('smart_fridge_email_enabled') !== 'false'; // Default true
        syncUserConfig(name, storedEmail, enabled);
      }
      setIsAuthChecking(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      setSession(session);
      if (session?.user) {
        const email = session.user.email || '';
        const name = session.user.user_metadata?.username || session.user.user_metadata?.display_name || session.user.user_metadata?.full_name || 'User';

        setUserEmail(email);
        setUserName(name);
        if (session.user.user_metadata?.phone) setUserPhone(session.user.user_metadata.phone);

        // Sync on auth change
        const storedEmail = localStorage.getItem('smart_fridge_email') || email;
        const enabled = localStorage.getItem('smart_fridge_email_enabled') !== 'false';
        syncUserConfig(name, storedEmail, enabled);

        // Notify other tabs if this was a login event (like from email confirmation)
        if (_event === 'SIGNED_IN') {
          authChannel.postMessage({ type: 'AUTH_SUCCESS', session });
        }
      }
    });

    // Listen for messages from other tabs
    authChannel.onmessage = (event) => {
      if (event.data.type === 'AUTH_SUCCESS') {
        setSession(event.data.session);
        // Clean up the URL if we were on a redirect
        if (window.location.hash || window.location.search) {
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    };

    return () => {
      subscription.unsubscribe();
      authChannel.close();
    };
  }, []);

  // Swipe Gesture State
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);

  // Sensor History for Charts
  const [sensorHistory, setSensorHistory] = useState<SensorData[]>(
    Array.from({ length: 20 }, (_, i) => ({
      ...INITIAL_SENSORS,
      temperature: INITIAL_SENSORS.temperature + (Math.random() - 0.5),
      humidity: INITIAL_SENSORS.humidity + (Math.random() - 0.5),
      lastUpdated: new Date(Date.now() - (20 - i) * 5000).toISOString()
    }))
  );

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe || isRightSwipe) {
      const currentIndex = TABS.indexOf(activeTab);
      if (isLeftSwipe && currentIndex < TABS.length - 1) {
        handleTabChange(TABS[currentIndex + 1]);
      } else if (isRightSwipe && currentIndex > 0) {
        handleTabChange(TABS[currentIndex - 1]);
      }
    }
  };

  const getFreshUrl = (url: string) => {
    if (!url) return '';
    // Remove old cache busters if present
    const cleanUrl = url.split('?')[0];
    return `${cleanUrl}?t=${Date.now()}`;
  };

  const handleRefreshSnapshot = useCallback(async () => {
    setIsRefreshingSnapshot(true);
    setIsCapturing(true); // Show the "Capturing..." status

    try {
      const response = await fetch(`http://${window.location.hostname}:8000/api/snapshot/trigger`, {
        method: 'POST',
      });
      const data = await response.json();
      console.log('[API] Snapshot trigger response:', data);

      setNotifications(prev => [{
        id: Date.now().toString(),
        title: 'IoT Cam Status',
        message: 'Manual snapshot triggered. Hardware is capturing...',
        type: 'info',
        timestamp: new Date().toISOString(),
        isRead: false
      }, ...prev]);
    } catch (error) {
      console.error('[API] Error triggering snapshot:', error);
      setIsRefreshingSnapshot(false);
      setIsCapturing(false);
      Swal.fire({
        title: 'Connection Error',
        text: 'Failed to reach the fridge camera. Please check your backend connection.',
        icon: 'error',
        confirmButtonText: 'Try Again',
        customClass: {
          popup: 'rounded-2xl border border-base-content/10 shadow-2xl',
          confirmButton: 'btn btn-error text-white'
        },
        buttonsStyling: false
      });
    }
  }, []);

  // Initial Load Trigger: Fetch latest state from backend
  useEffect(() => {
    const fetchInitialState = async () => {
      try {
        console.log('[Startup] Triggering initial state fetch...');
        const response = await fetch(`http://${window.location.hostname}:8000/api/initial-state`);
        const data = await response.json();

        if (data.inventory) {
          console.log('[Startup] Hydrating inventory:', data.inventory.length, 'items');
          setInventory(data.inventory);
        }

        if (data.latest_image_url) {
          console.log('[Startup] Hydrating last snapshot:', data.latest_image_url);
          setFridgeSnapshot(getFreshUrl(data.latest_image_url));
          if (data.lastCaptureTime) {
            setLastSnapshotTime(data.lastCaptureTime);
            lastKnownCaptureTime.current = data.lastCaptureTime;
          }
        }

        if (data.temperature !== undefined) {
          setSensors(data);
        }

        if (data.shopping_list) {
          console.log('[Startup] Hydrating shopping list:', data.shopping_list.length, 'items');
          setBuyList(data.shopping_list);
        }
      } catch (error) {
        console.error('[Startup] Failed to fetch initial state:', error);
      }
    };

    fetchInitialState();
    fetchAnomalyEvents();
  }, [syncUserConfig]);

  useEffect(() => {
    const wsUrl = `ws://${window.location.hostname}:8000/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      console.log('WebSocket Message Received:', message);
      if (message.type === 'sensor_update') {
        const newData = message.data;
        // Detect door state changes for "Capturing" status
        setSensors(prev => {
          if (prev.doorOpen && !newData.doorOpen) {
            console.log('[IoT] Door closed, starting capture countdown...');
            setIsCapturing(true);
          } else if (!prev.doorOpen && newData.doorOpen) {
            console.log('[IoT] Door re-opened, cancelling capture status...');
            setIsCapturing(false);
          }
          return newData;
        });

        // Only trigger image update if the capture time is actually new
        if (newData.latest_image_url && newData.lastCaptureTime && newData.lastCaptureTime !== lastKnownCaptureTime.current) {
          console.log('[WebSocket] Preparing seamless persisted snapshot:', newData.latest_image_url);
          setPendingSnapshot(getFreshUrl(newData.latest_image_url));
          setLastSnapshotTime(newData.lastCaptureTime);
          setIsCapturing(false); // Image received, stop capturing status
        }

        // Initial load hydration: if message contains inventory, use it
        if (newData.inventory && Array.isArray(newData.inventory)) {
          setInventory(newData.inventory);
        }

        if (newData.shopping_list && Array.isArray(newData.shopping_list)) {
          setBuyList(newData.shopping_list);
        }

        // Advanced Anomaly Detection
        const now = new Date();
        const timestamp = now.toISOString();

        // 1. Temperature Alert (> 5C is unsafe)
        if (newData.temperature > 5) {
          if (!anomalyStartTimes['temperature']) {
            setAnomalyStartTimes(prev => ({ ...prev, temperature: timestamp }));
          }
        } else if (anomalyStartTimes['temperature']) {
          // Temperature back to normal, record the "Unsafe" range
          const startTime = new Date(anomalyStartTimes['temperature']);
          const timeRange = `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${startTime.toLocaleDateString()} to ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, ${now.toLocaleDateString()}`;

          setNotifications(prev => [{
            id: `temp-${Date.now()}`,
            title: 'Critical Temperature Alert',
            message: `Fridge Temperature was ${newData.temperature}°C (Unsafe) from ${timeRange}.`,
            type: 'error',
            timestamp: timestamp,
            isRead: false
          }, ...prev]);
          setAnomalyStartTimes(prev => {
            const clone = { ...prev };
            delete clone.temperature;
            return clone;
          });
        }

        // 2. Humidity Alert (> 60% is high)
        if (newData.humidity > 60) {
          if (!anomalyStartTimes['humidity']) {
            setAnomalyStartTimes(prev => ({ ...prev, humidity: timestamp }));
            setNotifications(prev => [{
              id: `hum-${Date.now()}`,
              title: 'Humidity Anomaly',
              message: `Air Humidity is high (${newData.humidity}%) as of ${now.toLocaleTimeString()}.`,
              type: 'warning',
              timestamp: timestamp,
              isRead: false
            }, ...prev]);
          }
        } else {
          setAnomalyStartTimes(prev => {
            const clone = { ...prev };
            delete clone.humidity;
            return clone;
          });
        }

        // 3. Freezer Defrost Alert
        if (newData.freezerStatus === 'Defreeze' || newData.moistureAlert) {
          if (!anomalyStartTimes['defrost']) {
            setAnomalyStartTimes(prev => ({ ...prev, defrost: timestamp }));
            setNotifications(prev => [{
              id: `defrost-${Date.now()}`,
              title: 'Freezer Alert',
              message: `Top Freezer Defrosted/Moisture detected at ${now.toLocaleTimeString()}.`,
              type: 'error',
              timestamp: timestamp,
              isRead: false
            }, ...prev]);
          }
        } else {
          setAnomalyStartTimes(prev => {
            const clone = { ...prev };
            delete clone.defrost;
            return clone;
          });
        }

        // 4. Door Left Open Reminder (> 5 minutes)
        if (newData.doorOpen) {
          if (!anomalyStartTimes['door']) {
            setAnomalyStartTimes(prev => ({ ...prev, door: timestamp }));
          } else {
            const startTime = new Date(anomalyStartTimes['door']);
            const durationMs = now.getTime() - startTime.getTime();
            const durationMins = Math.floor(durationMs / 60000);

            if (durationMins >= 5 && !anomalyStartTimes['door_alert_sent']) {
              setNotifications(prev => [{
                id: `door-${Date.now()}`,
                title: 'Personalized Reminder',
                message: `${userName || 'User'}, the door has been opened for ${durationMins} minutes. Please remember to close the door.`,
                type: 'warning',
                timestamp: timestamp,
                isRead: false
              }, ...prev]);
              setAnomalyStartTimes(prev => ({ ...prev, door_alert_sent: 'true' }));
            }
          }
        } else if (anomalyStartTimes['door']) {
          // Door closed, record range if it was open for a while
          const startTime = new Date(anomalyStartTimes['door']);
          const durationMins = Math.floor((now.getTime() - startTime.getTime()) / 60000);

          if (durationMins >= 1) {
            const timeRange = `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} to ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            setNotifications(prev => [{
              id: `door-range-${Date.now()}`,
              title: 'Door Access Log',
              message: `The door was left opened from ${timeRange}.`,
              type: 'info',
              timestamp: timestamp,
              isRead: false
            }, ...prev]);
          }

          setAnomalyStartTimes(prev => {
            const clone = { ...prev };
            delete clone.door;
            delete clone.door_alert_sent;
            return clone;
          });
        }

        setSensorHistory(prev => {
          const newHistory = [...prev, newData];
          if (newHistory.length > 30) return newHistory.slice(1);
          return newHistory;
        });
      } else if (message.type === 'reminder_toast') {
        console.log('DEBUG: [WebSocket] Received reminder_toast:', message.data);
        addToast(message.data);
      } else if (message.type === 'notification_refresh') {
        console.log('DEBUG: [WebSocket] Received notification_refresh:', message.data);
        const event = message.data;
        fetchAnomalyEvents();
        setNotifications(prev => [{
          id: `resolved-${Date.now()}`,
          title: `${event.type.toUpperCase()} ALERT RESOLVED`,
          message: `${event.info} lasted for ${event.duration_mins} minutes.`,
          type: 'success',
          timestamp: new Date().toISOString(),
          isRead: false
        }, ...prev]);
        addToast({
          title: "Anomaly Resolved",
          message: `${event.alert_category} issue has been fixed after ${event.duration_mins}m.`,
          type: "success"
        });
      } else if (message.type === 'capture_update') {
        if (message.data.image_url) {
          console.log('[WebSocket] Preparing seamless real-time capture:', message.data.image_url);
          setPendingSnapshot(getFreshUrl(message.data.image_url));
          if (message.data.timestamp) setLastSnapshotTime(message.data.timestamp);
          setIsCapturing(false); // Image received, stop capturing status
        }
        setNotifications(prev => [{
          id: Date.now().toString(),
          title: 'New Snapshot',
          message: 'Fridge camera captured a new image.',
          type: 'info',
          timestamp: new Date().toISOString(),
          isRead: false
        }, ...prev]);
      } else if (message.type === 'inventory_update') {
        const enrichedItems = message.data.items;
        console.log('[WebSocket] Inventory update received:', enrichedItems);
        setInventory(enrichedItems);
        setNotifications(prev => [{
          id: Date.now().toString(),
          title: 'Stock Updated',
          message: `Smart scan complete: ${enrichedItems.length} items identified.`,
          type: 'success',
          timestamp: new Date().toISOString(),
          isRead: false
        }, ...prev]);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected. Retrying in 5s...');
      // Simple reconnect logic
      setTimeout(() => {
        // This will trigger the effect again if we used a ref or state, 
        // but for now, we'll keep it simple.
      }, 5000);
    };

    return () => {
      ws.close();
    };
  }, []);

  // Effect to fetch location name and auto-recommend stores whenever coordinates change
  useEffect(() => {
    if (userLocation) {
      const fetchLocationAndInitialDeals = async () => {
        // 1. Get readable address
        const result = await getLocationName(userLocation.lat, userLocation.lng);
        console.log("[Location Debug] FULL ADDRESS:", result.fullAddress);
        setFullLocationName(result.fullAddress);
        localStorage.setItem('smart_fridge_full_location_name', result.fullAddress);

        // 2. Auto-trigger search for low stock items if no query is set
        if (!storeSearchQuery.trim()) {
          const lowStock = inventory.filter(i => i.quantity <= i.reorderThreshold);
          if (lowStock.length > 0) {
            // Sort by lowest quantity first
            const mostUrgent = [...lowStock].sort((a, b) => a.quantity - b.quantity)[0];
            setStoreSearchQuery(mostUrgent.name);

            // Trigger search with the urgent item
            const results = await searchStores(mostUrgent.name, userLocation.lat, userLocation.lng);
            const filtered = results.filter((s: any) => !s.premise.toLowerCase().includes('99 speedmart 2403'));
            setNearestStores(filtered.slice(0, 5));
            setCheapestStores([...filtered].sort((a: any, b: any) => a.min_price - b.min_price).slice(0, 5));
          }
        }
      };
      fetchLocationAndInitialDeals();
    }
  }, [userLocation]); // Re-run when location is synced

  const requestLocation = useCallback((isManual: boolean = false): Promise<{ lat: number, lng: number } | null> => {
    return new Promise((resolve) => {
      if (navigator.geolocation) {
        if (!isManual) setIsLocating(true);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            console.log("[Location Debug] Raw Coordinates:", {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: `${pos.coords.accuracy} meters`
            });
            setUserLocation(loc);
            localStorage.setItem('smart_fridge_user_location', JSON.stringify(loc));
            setIsLocating(false);
            // Toast for success
            Swal.fire({
              toast: true,
              position: 'top-end',
              icon: 'success',
              title: 'Location sync complete',
              showConfirmButton: false,
              timer: 2000
            });
            resolve(loc);
          },
          (err) => {
            console.error("Location error", err);
            setIsLocating(false);
            if (isManual) {
              Swal.fire({
                title: 'Access Denied',
                text: "We couldn't get your location. Please check your browser permissions.",
                icon: 'error',
                customClass: { popup: 'rounded-2xl border border-base-content/10' }
              });
            }
            resolve(null);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          }
        );
      } else {
        resolve(null);
      }
    });
  }, []);

  const promptForLocation = async (): Promise<{ lat: number, lng: number } | null> => {
    const result = await Swal.fire({
      title: 'Find Local Deals?',
      text: "Grant location access to see store recommendations!",
      icon: 'question',
      iconColor: 'var(--color-primary)',
      showCancelButton: true,
      confirmButtonText: 'Enable Now',
      cancelButtonText: 'Later',
      customClass: {
        popup: 'rounded-3xl p-6 border border-base-content/10 shadow-2xl',
        confirmButton: 'btn btn-primary px-8 rounded-xl mr-2',
        cancelButton: 'btn btn-ghost px-8 rounded-xl'
      },
      buttonsStyling: false,
      backdrop: 'blur(4px)'
    });

    if (result.isConfirmed) {
      return await requestLocation(true);
    }
    return null;
  };

  const markNotificationAsRead = (id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  };

  const markAllNotificationsAsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
  };

  const handleTabChange = (tab: string, skipLocationPrompt: boolean = false) => {
    setActiveTab(tab);
    // if ((tab === 'shop' || tab === 'search') && !userLocation) {
    if (tab === 'search' && !userLocation && !skipLocationPrompt) {
      promptForLocation();
    }
  };

  const handleStoreSearch = async (overrideQuery?: string) => {
    const query = overrideQuery || storeSearchQuery;
    if (!query.trim()) return;

    // 1. Check Cache FIRST before clearing anything to ensure "Instant" feel
    const cacheKey = query.trim().toLowerCase();
    const cached = searchCache[cacheKey];
    if (cached) {
      const locMatch = !userLocation || (
        cached.location &&
        Math.abs(cached.location.lat - userLocation.lat) < 0.0045 && // ~500m (0.0045 deg)
        Math.abs(cached.location.lng - userLocation.lng) < 0.0045
      );

      if (locMatch) {
        console.log(`[Search] Cache hit for "${query}"`);
        const results = cached.results;
        const filtered = results.filter((s: any) => !s.premise.toLowerCase().includes('99 speedmart 2403'));
        setNearestStores(filtered.slice(0, 5));
        setCheapestStores([...filtered].sort((a, b) => a.min_price - b.min_price).slice(0, 5));
        setIsSearchingStores(false); // Ensure loader is hidden
        return;
      }
    }

    // 2. Cache Miss: Clear old results immediately to prevent "ghost" data
    setNearestStores([]);
    setCheapestStores([]);
    setIsSearchingStores(true);

    try {
      const results = await searchStores(
        query,
        userLocation?.lat,
        userLocation?.lng
      );

      const filtered = results.filter((s: any) => !s.premise.toLowerCase().includes('99 speedmart 2403'));
      setNearestStores(filtered.slice(0, 5));
      setCheapestStores(filtered.sort((a: any, b: any) => a.min_price - b.min_price).slice(0, 5));

      // 2. Save to Cache
      setSearchCache(prev => ({
        ...prev,
        [cacheKey]: {
          results,
          location: userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null,
          timestamp: Date.now()
        }
      }));

      if (results.length === 0) {
        Swal.fire({
          toast: true,
          position: 'top-end',
          icon: 'info',
          title: 'No local results found',
          showConfirmButton: false,
          timer: 3000
        });
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsSearchingStores(false);
    }
  };

  const handleQuickSearch = async (itemName: string) => {
    setStoreSearchQuery(itemName);

    // 1. Check location first (STAY ON SHOP TAB)
    let currentLoc = userLocation;
    if (!currentLoc) {
      currentLoc = await promptForLocation();
      if (!currentLoc) return; // User cancelled or denied
    }

    // 2. Only after location is READY, transition to search
    handleTabChange('search', true);

    // 3. Perform search after tab slide starts
    setTimeout(() => {
      handleStoreSearch(itemName);
    }, 600);
  };

  const handleCapture = async (base64: string) => {
    setIsAnalyzing(true);
    const result = await analyzeSnapshot(base64);
    if (result && result.items) {
      const newItems: FridgeItem[] = result.items.map((item: any) => ({
        id: Math.random().toString(36).substring(7),
        name: item.name,
        category: item.category || 'Others',
        quantity: item.quantity || 100,
        unit: 'percent',
        addedDate: new Date().toISOString().split('T')[0],
        expiryDate: new Date(Date.now() + (item.estimatedExpiryDays || 7) * 86400000).toISOString().split('T')[0],
        status: FreshnessStatus.GOOD,
        // thumbnail: `https://picsum.photos/seed/${item.name}/200/200`,
        reorderThreshold: 20
      }));
      setInventory(prev => [...prev, ...newItems]);
    }
    setIsAnalyzing(false);
  };

  const handleFetchRecipes = async () => {
    setIsLoadingRecipes(true);
    setSelectedRecipe(null);
    const suggestions = await getRecipeSuggestions(inventory, chefPrompt);
    setRecipes(suggestions);
    setIsLoadingRecipes(false);
  };

  const handleOpenCookbook = async (recipe: Recipe) => {
    setIsLoadingDetails(true);
    const details = await getRecipeDetails(recipe.name, inventory);
    setSelectedRecipe({ ...recipe, ...details });
    setIsLoadingDetails(false);
  };

  const handleFinishCooking = () => {
    if (!selectedRecipe) return;

    setInventory(prev => prev.map(item => {
      const isUsed = selectedRecipe.fullIngredients?.some(ing =>
        ing.toLowerCase().includes(item.name.toLowerCase())
      );
      if (isUsed) {
        return { ...item, quantity: Math.max(0, item.quantity - 30) };
      }
      return item;
    }));

    setNotifications(prev => [{
      id: Date.now().toString(),
      title: 'Meal Cooked!',
      message: `Inventory updated after preparing ${selectedRecipe.name}.`,
      type: 'success',
      timestamp: new Date().toISOString(),
      isRead: false
    }, ...prev]);

    setSelectedRecipe(null);
    Swal.fire({
      title: 'Meal Prepared!',
      text: 'Inventory levels updated automatically.',
      icon: 'success',
      confirmButtonText: 'Great!',
      customClass: {
        popup: 'rounded-2xl border border-base-content/10 shadow-2xl',
        confirmButton: 'btn btn-success text-white'
      },
      buttonsStyling: false
    });
  };

  const removeItem = async (id: string) => {
    const result = await Swal.fire({
      title: 'Remove Item?',
      text: "This item will be permanently removed from inventory.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Delete',
      cancelButtonText: 'Keep it',
      customClass: {
        popup: 'rounded-3xl p-6 border border-base-content/10 shadow-2xl',
        confirmButton: 'btn btn-error px-8 rounded-xl mr-2',
        cancelButton: 'btn btn-ghost px-8 rounded-xl'
      },
      buttonsStyling: false,
      backdrop: 'blur(4px)'
    });

    if (result.isConfirmed) {
      setInventory(prev => prev.filter(i => i.id !== id));
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Item removed',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true
      });
    }
  };

  const editItem = async (item: FridgeItem) => {
    const { value: formValues } = await Swal.fire({
      title: 'Edit Item',
      html: `
        <div class="flex flex-col gap-4 text-left px-2">
          <div>
            <label class="text-[10px] font-black uppercase tracking-widest opacity-40 ml-1">Item Name</label>
            <input id="swal-input1" class="input input-bordered w-full rounded-xl mt-1 font-bold" value="${item.name}">
          </div>
          <div>
            <label class="text-[10px] font-black uppercase tracking-widest opacity-40 ml-1">Reorder Threshold (Detect low stock below this)</label>
            <input id="swal-input2" type="number" class="input input-bordered w-full rounded-xl mt-1 font-black tabular-nums" value="${item.reorderThreshold}">
          </div>
        </div>
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Update Stock info',
      customClass: {
        popup: 'rounded-3xl p-8 border border-base-content/10 shadow-3xl bg-base-100',
        confirmButton: 'btn btn-primary px-10 rounded-2xl mr-2 shadow-lg shadow-primary/20',
        cancelButton: 'btn btn-ghost px-8 rounded-2xl'
      },
      buttonsStyling: false,
      preConfirm: () => {
        const name = (document.getElementById('swal-input1') as HTMLInputElement).value;
        const threshold = parseInt((document.getElementById('swal-input2') as HTMLInputElement).value);

        if (!name) {
          Swal.showValidationMessage('Item name is required!');
          return false;
        }
        if (isNaN(threshold) || threshold < 0) {
          Swal.showValidationMessage('Please enter a valid threshold number!');
          return false;
        }

        return { name, threshold };
      }
    });

    if (formValues) {
      setInventory(prev => prev.map(i => i.id === item.id ? {
        ...i,
        name: formValues.name,
        reorderThreshold: formValues.threshold
      } : i));

      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Inventory updated!',
        showConfirmButton: false,
        timer: 1500,
        timerProgressBar: true
      });
    }
  };

  const handleBindEmail = async () => {
    const { value: email } = await Swal.fire({
      title: 'Bind Email Address',
      text: 'Enter your email to receive low stock and freshness alerts.',
      input: 'email',
      inputPlaceholder: 'user@example.com',
      inputValue: userEmail === 'smart.home.user@gmail.com' ? '' : userEmail,
      showCancelButton: true,
      confirmButtonText: 'Bind Email',
      customClass: {
        popup: 'rounded-3xl p-8 border border-base-content/10 shadow-2xl',
        confirmButton: 'btn btn-primary px-10 rounded-2xl mr-2',
        cancelButton: 'btn btn-ghost px-8 rounded-2xl',
        input: 'input input-bordered w-full rounded-xl mt-4 font-bold'
      },
      buttonsStyling: false,
      inputValidator: (value) => {
        if (!value) return 'Email is required!';
        return null;
      }
    });

    if (email) {
      setUserEmail(email);
      localStorage.setItem('smart_fridge_email', email);
      syncUserConfig(userName, email, emailNotifications);
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Email bound successfully!',
        showConfirmButton: false,
        timer: 2000
      });
    }
  };

  const toggleEmailNotifications = (enabled: boolean) => {
    setEmailNotifications(enabled);
    localStorage.setItem('smart_fridge_email_enabled', String(enabled));
    syncUserConfig(userName, userEmail, enabled);
  };

  const addToBuyList = async (name: string, source: 'low-stock' | 'manual' = 'manual') => {
    if (!name.trim()) return;
    const newItem: BuyItem = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      source,
      completed: false
    };

    // Optimistic update
    setBuyList(prev => [...prev, newItem]);
    if (source === 'manual') setManualBuyInput('');

    try {
      const response = await fetch(`http://${window.location.hostname}:8000/api/shopping-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem)
      });

      const result = await response.json();
      if (result.status === 'success' && result.data && result.data.id) {
        // Replace temp ID with real DB ID
        setBuyList(prev => prev.map(i => String(i.id) === String(newItem.id) ? { ...i, id: result.data.id } : i));
      } else {
        console.warn('[API] Failed to get real ID for new item:', result);
      }
    } catch (error) {
      console.error('[API] Error adding to buy list:', error);
    }
  };

  const toggleBuyItem = async (id: string | number) => {
    const item = buyList.find(i => String(i.id) === String(id));
    if (!item) return;

    const updatedItem = { ...item, completed: !item.completed };

    // Optimistic update
    setBuyList(prev => prev.map(i => String(i.id) === String(id) ? updatedItem : i));

    try {
      const response = await fetch(`http://${window.location.hostname}:8000/api/shopping-list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedItem)
      });

      const result = await response.json();
      if (result.status === 'success' && result.data && result.data.id && String(result.data.id) !== String(id)) {
        // If the server returned a numeric ID and we were using a temp string, update it now
        setBuyList(prev => prev.map(i => String(i.id) === String(id) ? { ...i, id: result.data.id } : i));
      }
    } catch (error) {
      console.error('[API] Error toggling buy item:', error);
    }
  };

  const removeBuyItem = async (id: string | number) => {
    // Optimistic update
    setBuyList(prev => prev.filter(item => String(item.id) !== String(id)));

    try {
      await fetch(`http://${window.location.hostname}:8000/api/shopping-list/${id}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('[API] Error removing buy item:', error);
    }
  };

  const lowStockItems = inventory.filter(i => i.quantity <= i.reorderThreshold);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <span className="loading loading-infinity loading-lg text-primary"></span>
      </div>
    );
  }

  if (!session) {
    return <Auth onSessionChange={setSession} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Navbar
        onOpenSettings={() => handleTabChange('settings')}
        notifications={notifications}
        anomalyEvents={anomalyEvents}
        onFetchEvents={fetchAnomalyEvents}
        onMarkAsRead={markNotificationAsRead}
        onClearAll={clearAllNotifications}
        onMarkAllAsRead={markAllNotificationsAsRead}
        unreadCount={notifications.filter(n => !n.isRead).length}
        onToggleLocation={() => requestLocation(true)}
        userLocation={userLocation}
        isLocating={isLocating}
        userName={userName || 'User'}
      />

      {/* Persistent Toasts (Fade In/Out) */}
      <div className="fixed bottom-24 left-0 right-0 z-[60] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map(toast => (
          <div key={toast.id} className={`alert ${toast.alert_category === 'error' ? 'alert-error' :
            toast.alert_category === 'warning' ? 'alert-warning' :
              toast.alert_category === 'success' ? 'alert-success' : 'alert-info'
            } shadow-lg w-[90%] max-w-md animate-in fade-in slide-in-from-bottom-5 duration-500 rounded-2xl border-none text-white pointer-events-auto`}>
            <div>
              <h3 className="font-bold text-xs uppercase tracking-widest opacity-80">{toast.title}</h3>
              <p className="text-sm font-medium">{toast.message}</p>
            </div>
          </div>
        ))}
      </div>

      <main
        className="flex-1 overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex transition-transform duration-500 ease-in-out h-full"
          style={{ transform: `translateX(-${TABS.indexOf(activeTab) * 100}%)` }}
        >
          {/* TAB 1: DASHBOARD */}
          <div className="w-full shrink-0 h-full overflow-y-auto no-scrollbar pt-4 px-4 pb-4 space-y-6">
            <div className="max-w-4xl mx-auto space-y-6 pb-24">
              {/* Premium Location Banner */}
              {fullLocationName && (
                <div className="card mx-2 bg-gradient-to-br from-primary/10 to-base-100 border border-primary/20 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-700">
                  <div className="card-body py-3 px-2 flex-row items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary shadow-inner">
                      <MapPin size={24} className="fill-primary/20" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] font-black uppercase tracking-widest text-primary/60 mb-0.5">CURRENTLY AT</p>
                      <h3 className="font-bold text-sm leading-tight text-base-content/80 line-clamp-2">{fullLocationName}</h3>
                    </div>
                    <button
                      className="btn btn-ghost btn-circle btn-sm text-primary/40 hover:text-primary"
                      onClick={() => requestLocation(true)}
                    >
                      <RefreshCw size={16} />
                    </button>
                  </div>
                </div>
              )}
              <RealtimeStatusCard data={sensors} history={sensorHistory} />

              <section>
                <div className="flex justify-between items-center mx-3 mb-3">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    <Activity size={20} className="text-error" />
                    Stock Running Low
                  </h2>
                  <span className="badge badge-error badge-outline">{lowStockItems.length} items</span>
                </div>
                {lowStockItems.length > 0 ? (
                  <div className="flex flex-col bg-base-100 rounded-2xl shadow-sm border border-base-200 overflow-hidden">
                    {lowStockItems.slice(0, 5).map(item => (
                      <div key={item.id} className="flex items-center gap-3 p-3 border-b border-base-200 last:border-b-0 hover:bg-base-200/30 transition-colors">
                        <div className="w-10 h-10 rounded-xl bg-base-200 flex items-center justify-center shrink-0">
                          {getCategoryIcon(item.category)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-sm truncate">{item.name}</h3>
                          <span className="text-[10px] text-error font-bold uppercase">{item.quantity} units left</span>
                        </div>
                        <button
                          className="btn btn-sm btn-primary gap-1"
                          onClick={() => {
                            addToBuyList(item.name, 'low-stock');
                            handleTabChange('shop'); // Standardized navigation
                          }}
                        >
                          <ShoppingCart size={14} /> Check into To-buy
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="alert bg-base-100 border border-dashed border-base-300 text-center justify-center p-8">
                    <p className="text-base-content/50">Your fridge is well stocked!</p>
                  </div>
                )}
              </section>

              <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Cheapest Nearby Card */}
                <div className="card bg-primary/5 border border-primary/20 shadow-sm relative overflow-hidden group">
                  <div className="card-body p-4 transition-all group-hover:bg-primary/5">
                    <h3 className="card-title text-[10px] text-primary font-black uppercase tracking-widest flex items-center gap-2">
                      <DollarSign size={14} /> Best Local Deal
                    </h3>
                    <div className="mt-2 flex flex-col gap-3">
                      {cheapestStores.length > 0 ? (
                        <>
                          <p className="font-black text-xl text-base-content/90 line-clamp-1">{cheapestStores[0].premise}</p>

                          <div className="h-32 w-full rounded-2xl overflow-hidden border border-primary/10 shadow-inner relative group/map">
                            <iframe
                              width="100%"
                              height="100%"
                              frameBorder="0"
                              style={{ border: 0 }}
                              src={`https://maps.google.com/maps?q=${encodeURIComponent(cheapestStores[0].premise + ' ' + cheapestStores[0].address)}&t=&z=14&ie=UTF8&iwloc=&output=embed`}
                              allowFullScreen
                              className="opacity-80 group-hover/map:opacity-100 transition-opacity"
                            ></iframe>
                            <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5 rounded-2xl"></div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="badge badge-primary badge-sm font-bold">RM {cheapestStores[0].min_price.toFixed(2)}</span>
                            <span className="text-[10px] font-black text-primary/60">{cheapestStores[0].distance_km?.toFixed(1) || '?'} km away</span>
                          </div>
                        </>
                      ) : (
                        <div className="opacity-30 flex flex-col items-center">
                          <ShoppingCart size={24} className="mb-1" />
                          <p className="text-[10px] font-bold uppercase tracking-tighter">No deals found</p>
                        </div>
                      )}
                    </div>
                    <button className="btn btn-primary btn-sm btn-block mt-4 rounded-xl normal-case font-bold" onClick={() => handleTabChange('shop')}>View Smart List</button>
                  </div>
                </div>

                {/* Nearest Store Card */}
                <div className="card bg-secondary/5 border border-secondary/20 shadow-sm relative overflow-hidden group">
                  <div className="card-body p-4 transition-all group-hover:bg-secondary/5">
                    <h3 className="card-title text-[10px] text-secondary font-black uppercase tracking-widest flex items-center gap-2">
                      <MapPin size={14} /> Nearest Option
                    </h3>
                    <div className="mt-2 flex flex-col gap-3">
                      {nearestStores.length > 0 ? (
                        <>
                          <p className="font-black text-xl text-base-content/90 line-clamp-1">{nearestStores[0].premise}</p>

                          <div className="h-32 w-full rounded-2xl overflow-hidden border border-secondary/10 shadow-inner relative group/map">
                            <iframe
                              width="100%"
                              height="100%"
                              frameBorder="0"
                              style={{ border: 0 }}
                              src={`https://maps.google.com/maps?q=${encodeURIComponent(nearestStores[0].premise + ' ' + nearestStores[0].address)}&t=&z=14&ie=UTF8&iwloc=&output=embed`}
                              allowFullScreen
                              className="opacity-80 group-hover/map:opacity-100 transition-opacity"
                            ></iframe>
                            <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5 rounded-2xl"></div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="badge badge-secondary badge-sm font-bold">{nearestStores[0].distance_km?.toFixed(1) || '?'} km</span>
                            <span className="text-[10px] font-black text-secondary/60">RM {nearestStores[0].min_price.toFixed(2)}</span>
                          </div>
                        </>
                      ) : (
                        <div className="opacity-30 flex flex-col items-center">
                          <MapPin size={24} className="mb-1" />
                          <p className="text-[10px] font-bold uppercase tracking-tighter">Sync location</p>
                        </div>
                      )}
                    </div>
                    <button className="btn btn-secondary btn-sm btn-block mt-4 rounded-xl normal-case font-bold" onClick={() => handleTabChange('search')}>Find More Stores</button>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* TAB 2: STORE FINDER */}
          <div className="w-full shrink-0 h-full overflow-y-auto no-scrollbar pt-4 px-4 pb-4">
            <div className="max-w-4xl mx-auto space-y-6 pb-20">
              <div className="card bg-base-100 shadow-xl p-6 border border-base-200 overflow-hidden relative">
                {/* Visual Accent */}
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl"></div>

                <div className="relative z-10">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-6">
                    <div>
                      <h2 className="text-3xl font-black flex items-center gap-3 tracking-tighter">
                        <Search className="text-primary" size={32} /> STORE FINDER
                      </h2>
                      <p className="text-sm opacity-60 mt-1 max-w-md">Find the best local prices synchronized with your real-time fridge inventory.</p>
                    </div>

                    {fullLocationName ? (
                      <div
                        className="bg-primary/10 pl-3 pr-4 py-2.5 rounded-2xl flex items-center gap-3 border border-primary/20 cursor-pointer hover:bg-primary/15 transition-all group animate-in zoom-in-95 duration-500"
                        onClick={() => requestLocation(true)}
                      >
                        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition-transform">
                          <MapPin size={18} />
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-wider text-primary/60 mb-0.5">YOUR LOCATION</p>
                          <p className="text-[11px] font-bold text-primary leading-tight max-w-[180px] line-clamp-1">{fullLocationName}</p>
                        </div>
                      </div>
                    ) : (
                      <button
                        className="btn btn-primary btn-outline border-dashed rounded-2xl gap-2 h-auto py-2 px-4 normal-case"
                        onClick={() => requestLocation(true)}
                      >
                        <MapPin size={16} />
                        <div className="text-left">
                          <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Sync Location</p>
                          <p className="text-xs font-bold">Find Stores Nearby</p>
                        </div>
                      </button>
                    )}
                  </div>

                </div>

                <div className="join w-full shadow-lg rounded-full mb-4 relative z-10">
                  <input
                    type="text"
                    placeholder="Search food (e.g. Milk, Salmon, Eggs)..."
                    className="input join-item w-full bg-base-200"
                    value={storeSearchQuery}
                    onChange={(e) => setStoreSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleStoreSearch()}
                  />
                  <button
                    className="btn btn-primary join-item px-8"
                    onClick={() => handleStoreSearch()}
                    disabled={isSearchingStores}
                  >
                    {isSearchingStores ? (
                      <span className="loading loading-spinner loading-sm"></span>
                    ) : (
                      <Send size={20} />
                    )}
                  </button>
                </div>

                {/* Urgent Need Pills */}
                {lowStockItems.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-4 relative z-10">
                    <span className="text-[10px] font-black uppercase tracking-widest text-error/60 w-full mb-1">Items running low:</span>
                    {lowStockItems.map(item => (
                      <button
                        key={item.id}
                        className={`btn btn-xs rounded-full border-dashed normal-case font-bold transition-all ${storeSearchQuery.toLowerCase() === item.name.toLowerCase() ? 'btn-error text-white border-solid shadow-md' : 'btn-ghost bg-error/5 text-error border-error/20 hover:bg-error/10'}`}
                        onClick={() => {
                          setStoreSearchQuery(item.name);
                          handleStoreSearch(item.name);
                        }}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                )}

                {!userLocation && (
                  <div className="bg-primary/5 rounded-2xl p-4 border border-primary/20 flex flex-col items-center text-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      <MapPin size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold">Personalize your results</h4>
                      <p className="text-xs opacity-60">Enable location to see store distances and travel times.</p>
                    </div>
                    <button
                      className="btn btn-primary btn-sm rounded-xl px-6"
                      onClick={() => requestLocation(true)}
                    >
                      Enable Location
                    </button>
                  </div>
                )}
              </div>

              {/* Nearest Stores Row */}
              <div className="space-y-3">
                <h3 className="font-bold text-lg flex items-center gap-2 px-6">
                  <MapPin size={20} className="text-secondary" /> Nearest Stores
                </h3>
                <div className="flex gap-4 ml-4 overflow-x-auto pb-4 no-scrollbar min-h-[160px] relative">
                  {isSearchingStores ? (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-base-100/60 backdrop-blur-[2px] rounded-3xl animate-in fade-in duration-300">
                      <div className="flex flex-col items-center gap-3">
                        <span className="loading loading-ring loading-lg text-primary"></span>
                        <p className="text-xs font-black uppercase tracking-widest text-primary animate-pulse">Scanning store prices...</p>
                      </div>
                    </div>
                  ) : null}

                  {nearestStores.length > 0 ? nearestStores.map((store, i) => (
                    <div
                      key={i}
                      className="card bg-base-100 shadow-md border border-base-200 min-w-[240px] max-w-[280px] shrink-0 hover:border-secondary transition-all cursor-pointer group active:scale-95 overflow-hidden"
                      onClick={() => setActiveStoreModal(store)}
                    >
                      {store.thumbnail_url && (
                        <div className="h-24 w-full relative overflow-hidden">
                          <img
                            src={store.thumbnail_url}
                            alt={store.premise}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
                        </div>
                      )}
                      <div className="card-body p-4">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <span className="text-[9px] font-black tracking-widest text-secondary/60 uppercase block mb-1">{store.premise_type}</span>
                            <h4 className="font-bold text-sm leading-tight line-clamp-2 group-hover:text-secondary transition-colors">{store.premise}</h4>
                          </div>
                          <span className="badge badge-secondary badge-xs shrink-0 font-bold">{store.distance_km?.toFixed(1) || '?'} km</span>
                        </div>
                        <p className="text-[10px] opacity-60 mt-1 line-clamp-2 leading-relaxed">{store.address}</p>
                        <div className="flex items-center justify-between mt-4">
                          <div className="text-[11px] font-black text-secondary">
                            RM {store.min_price.toFixed(2)}
                            <span className="text-[8px] opacity-50 block font-bold mt-0.5">{store.items.length} OPTIONS</span>
                          </div>
                          <div className="w-6 h-6 rounded-full bg-secondary/10 flex items-center justify-center text-secondary group-hover:bg-secondary group-hover:text-white transition-all">
                            <ChevronRight size={14} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="p-10 bg-base-100 rounded-3xl border border-dashed border-base-300 w-full text-center opacity-40">
                      {isSearchingStores ? `Finding nearest ${storeSearchQuery || 'options'}...` : "Search for something to see nearby stores."}
                    </div>
                  )}
                </div>
              </div>

              {/* Cheapest Stores Row */}
              <div className="space-y-3">
                <h3 className="font-bold text-lg flex items-center gap-2 px-6">
                  <DollarSign size={20} className="text-success" /> Best Deals & Cheapest
                </h3>
                <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar px-6 min-h-[160px] relative">
                  {isSearchingStores ? (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-base-100/60 backdrop-blur-[2px] rounded-3xl animate-in fade-in duration-300">
                      <div className="flex flex-col items-center gap-3">
                        <span className="loading loading-ring loading-lg text-success"></span>
                        <p className="text-xs font-black uppercase tracking-widest text-success animate-pulse">Comparing local deals...</p>
                      </div>
                    </div>
                  ) : null}

                  {cheapestStores.length > 0 ? cheapestStores.map((store, i) => (
                    <div
                      key={i}
                      className="card bg-base-100 shadow-md border border-base-200 min-w-[240px] max-w-[280px] shrink-0 hover:border-success transition-all cursor-pointer group active:scale-95 overflow-hidden"
                      onClick={() => setActiveStoreModal(store)}
                    >
                      {store.thumbnail_url && (
                        <div className="h-24 w-full relative overflow-hidden">
                          <img
                            src={store.thumbnail_url}
                            alt={store.premise}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent"></div>
                        </div>
                      )}
                      <div className="card-body p-4">
                        <div className="flex justify-between items-start gap-2">
                          <div>
                            <span className="text-[9px] font-black tracking-widest text-success/60 uppercase block mb-1">{store.premise_type}</span>
                            <h4 className="font-bold text-sm leading-tight line-clamp-2 group-hover:text-success transition-colors">{store.premise}</h4>
                          </div>
                          <span className="badge badge-success badge-xs shrink-0 text-white font-bold">RM {store.min_price.toFixed(2)}</span>
                        </div>
                        <p className="text-[10px] opacity-60 mt-1 line-clamp-1 italic">Located {store.distance_km?.toFixed(1) || '?'} km away</p>
                        <div className="flex items-center justify-between mt-4 text-[10px] font-black text-success/70">
                          <div>{store.items.length} VARIATIONS AVAILABLE</div>
                          <div className="w-6 h-6 rounded-full bg-success/10 flex items-center justify-center text-success group-hover:bg-success group-hover:text-white transition-all">
                            <ChevronRight size={14} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="p-10 bg-base-100 rounded-3xl border border-dashed border-base-300 w-full text-center opacity-40">
                      {isSearchingStores ? `Finding best deals for ${storeSearchQuery || 'items'}...` : "Discover the best deals in your area."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* TAB 3: INVENTORY */}
          <div className="w-full shrink-0 h-full overflow-y-auto no-scrollbar pt-4 px-4 pb-4">
            <div className="max-w-4xl mx-auto space-y-6 pb-10">
              <div className="flex justify-between items-center bg-base-100/50 backdrop-blur shadow-sm p-4 rounded-2xl sticky top-0 z-40">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Package className="text-primary" /> Inventory
                </h2>
                <div className="flex gap-2">
                  <button
                    className={`btn btn-sm btn-primary ${isRefreshingSnapshot ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={handleRefreshSnapshot}
                    disabled={isRefreshingSnapshot} // This provides the "gray out" effect and prevents clicks
                  >
                    {isRefreshingSnapshot ? (
                      <span className="loading loading-spinner loading-xs"></span>
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    <span className={isRefreshingSnapshot ? 'opacity-70' : ''}>Refresh View</span>
                  </button>
                  {/* <button className="btn btn-sm btn-primary" onClick={() => setIsCameraOpen(true)}>
                    <Camera size={16} /> Scan
                  </button> */}
                </div>
              </div>

              {/* IoT Snapshot View */}
              <div className="card bg-base-100 shadow-xl overflow-hidden border border-base-200">
                <div className="relative aspect-video">
                  <img
                    key={fridgeSnapshot}
                    src={fridgeSnapshot}
                    alt="Inside Fridge"
                    className="w-full h-full object-cover transition-opacity duration-700"
                  />

                  {/* Hidden pre-loader (Buffer) */}
                  {pendingSnapshot && (
                    <img
                      src={pendingSnapshot}
                      className="hidden"
                      onLoad={() => {
                        console.log('[Buffer] Snapshot pre-loaded, swapping...');
                        setFridgeSnapshot(pendingSnapshot);
                        lastKnownCaptureTime.current = lastSnapshotTime;
                        setPendingSnapshot('');
                        setIsRefreshingSnapshot(false);
                      }}
                      onError={() => {
                        setPendingSnapshot('');
                        setIsRefreshingSnapshot(false);
                      }}
                    />
                  )}

                  {isRefreshingSnapshot && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="loading loading-spinner loading-lg text-primary"></span>
                    </div>
                  )}
                  <div className="absolute top-4 left-4">
                    <div className="badge badge-neutral bg-black/50 backdrop-blur border-none flex gap-2 p-3">
                      <span className={`w-2 h-2 rounded-full ${sensors.doorOpen ? 'bg-error animate-pulse' : 'bg-success'}`}></span>
                      <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase tracking-widest leading-none">IoT Live Interior</span>
                        {(isCapturing || isRefreshingSnapshot) ? (
                          <span className="text-[8px] text-warning font-bold animate-pulse">Capturing image...</span>
                        ) : lastSnapshotTime ? (
                          <span className="text-[8px] opacity-70 font-medium">
                            Last capture: {new Date(lastSnapshotTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col bg-base-100 rounded-3xl shadow-xl overflow-hidden border border-base-200">
                <div className="p-4 bg-base-200/50 border-b border-base-200 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <ListFilter size={16} className="opacity-50" />
                    <span className="text-xs font-bold uppercase tracking-wider opacity-50">Stock List</span>
                  </div>
                  <div className="badge badge-sm badge-primary">{inventory.length} Items</div>
                </div>
                <div className="flex flex-col">
                  {inventory.map(item => (
                    <SlotCard key={item.id} item={item} onEdit={editItem} onRemove={removeItem} />
                  ))}
                  {inventory.length === 0 && (
                    <div className="p-12 text-center opacity-30">
                      <Package size={48} className="mx-auto mb-2" />
                      <p>Fridge is empty.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* TAB 4: CHEF AI */}
          <div className="w-full shrink-0 h-full overflow-y-auto no-scrollbar pt-4 px-4 pb-4">
            <div className="max-w-4xl mx-auto space-y-6 pb-10">
              {selectedRecipe ? (
                <div className="card bg-base-100 shadow-2xl border border-base-200 animate-in zoom-in duration-300">
                  <div className="card-body p-4 sm:p-8">
                    <button className="btn btn-sm btn-ghost gap-2 mb-4" onClick={() => setSelectedRecipe(null)}>
                      <ArrowLeft size={16} /> Back to Suggestions
                    </button>
                    <div className="flex flex-col md:flex-row gap-8">
                      <div className="w-full md:w-1/3">
                        <div className="aspect-square bg-base-200 rounded-3xl flex items-center justify-center mb-4">
                          <ChefHat size={80} className="text-primary opacity-20" />
                        </div>
                        <div className="flex flex-col gap-2 p-4 bg-base-200/50 rounded-2xl">
                          <h4 className="font-bold flex items-center gap-2 text-primary">
                            <ShoppingCart size={18} /> Ingredients
                          </h4>
                          <ul className="text-sm space-y-2 mt-2">
                            {selectedRecipe.fullIngredients?.map((ing, i) => (
                              <li key={i} className="flex gap-2 items-start">
                                <input type="checkbox" className="checkbox checkbox-xs checkbox-primary mt-1" defaultChecked />
                                <span className="text-xs">{ing}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <div className="flex-1">
                        <div className="flex justify-between items-start">
                          <div>
                            <h2 className="text-3xl font-black mb-1">{selectedRecipe.name}</h2>
                            <p className="opacity-60 text-sm">{selectedRecipe.description}</p>
                          </div>
                          <div className="badge badge-primary">{selectedRecipe.difficulty}</div>
                        </div>
                        <div className="flex gap-4 my-6 text-sm font-semibold opacity-70">
                          <div className="flex items-center gap-2"><Clock size={16} /> {selectedRecipe.cookTime}</div>
                          <div className="flex items-center gap-2"><BookOpen size={16} /> Official Cookbook</div>
                        </div>
                        <div className="space-y-6">
                          <h4 className="font-bold text-xl flex items-center gap-2">
                            <Sparkles size={20} className="text-warning" /> Instructions
                          </h4>
                          <div className="space-y-4">
                            {selectedRecipe.instructions?.map((step, i) => (
                              <div key={i} className="flex gap-4">
                                <div className="w-8 h-8 rounded-full bg-primary text-primary-content flex items-center justify-center font-bold shrink-0 shadow-md">
                                  {i + 1}
                                </div>
                                <p className="text-sm pt-1 leading-relaxed opacity-80">{step}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                        <button className="btn btn-primary btn-block mt-10 shadow-lg" onClick={handleFinishCooking}>
                          <Check size={20} /> Finish Cooking & Update Stocks
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="card bg-base-100 shadow-xl border border-base-200 p-8 text-center">
                    <ChefHat size={64} className="mx-auto text-primary mb-4 animate-bounce" />
                    <h2 className="text-3xl font-black mb-2">Chef AI</h2>
                    <p className="opacity-60 text-sm mb-8">Suggest a cuisine or diet and I'll find a match!</p>
                    <div className="join w-full max-w-xl mx-auto shadow-lg rounded-full">
                      <input
                        type="text"
                        placeholder="e.g. 'Low carb dinner', 'Asian style'..."
                        className="input join-item w-full bg-base-200"
                        value={chefPrompt}
                        onChange={(e) => setChefPrompt(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleFetchRecipes()}
                      />
                      <button
                        className="btn btn-primary join-item px-8"
                        onClick={handleFetchRecipes}
                        disabled={isLoadingRecipes}
                      >
                        {isLoadingRecipes ? (
                          <span className="loading loading-spinner loading-sm"></span>
                        ) : (
                          <Send size={20} />
                        )}
                      </button>
                    </div>
                  </div>
                  {recipes.length > 0 && !isLoadingRecipes && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {recipes.map((recipe, idx) => (
                        <div key={idx} className="card bg-base-100 shadow-md border border-base-200 p-4 hover:border-primary transition-all">
                          <h3 className="font-bold text-base mb-1">{recipe.name}</h3>
                          <p className="text-xs opacity-60 line-clamp-2 mb-3">{recipe.description}</p>
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold opacity-30 uppercase tracking-widest">{recipe.cookTime} • {recipe.difficulty}</span>
                            <button className="btn btn-xs btn-primary gap-1" onClick={() => handleOpenCookbook(recipe)}>
                              <BookOpen size={12} /> Cookbook
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* TAB 5: TO-PURCHASE */}
          <div className="w-full shrink-0 h-full overflow-y-auto no-scrollbar pt-4 px-4 pb-4">
            <div className="max-w-4xl mx-auto space-y-6 pb-10">
              <div className="card bg-base-100 shadow-xl border border-base-200">
                <div className="card-body p-6">
                  <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                    <ShoppingCart className="text-primary" /> To-Purchase List
                  </h2>
                  <div className="flex gap-2 mb-8 bg-base-200/50 p-2 rounded-2xl border border-base-content/5">
                    <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none opacity-40">
                        <Plus size={18} />
                      </div>
                      <input
                        type="text"
                        placeholder="Add items-to-buy ..."
                        className="input input-ghost w-full pl-12 bg-transparent focus:bg-base-100/50 transition-all font-medium"
                        value={manualBuyInput}
                        onChange={(e) => setManualBuyInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && addToBuyList(manualBuyInput)}
                      />
                    </div>
                    <button className="btn btn-primary btn-md px-6 rounded-xl shadow-lg shadow-primary/20" onClick={() => addToBuyList(manualBuyInput)}>
                      Add
                    </button>
                  </div>
                  {buyList.length > 0 ? (
                    buyList.map((item) => (
                      <div
                        key={item.id}
                        className={`group flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 hover:scale-[1.01] ${item.completed
                          ? 'bg-base-200/40 border-transparent opacity-60 grayscale'
                          : 'bg-base-100 border-base-content/5 shadow-sm hover:shadow-xl hover:border-primary/20'
                          }`}
                      >
                        <div className="flex items-center gap-4">
                          <button
                            className={`btn btn-circle btn-sm shadow-sm transition-all ${item.completed
                              ? 'btn-success text-white border-none'
                              : 'btn-ghost border-base-content/10 bg-base-200/50 hover:bg-primary/10 hover:border-primary/30'
                              }`}
                            onClick={() => toggleBuyItem(item.id)}
                          >
                            {item.completed ? <Check size={16} /> : <div className="w-4 h-4 rounded-full border-2 border-base-content/10"></div>}
                          </button>
                          <div>
                            <p className={`font-bold text-base tracking-tight ${item.completed ? 'line-through opacity-40' : 'text-base-content/90'}`}>
                              {item.name}
                            </p>
                            <div className="flex gap-2 items-center mt-1">
                              {item.source === 'low-stock' ? (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-error/10 text-[10px] font-black text-error uppercase tracking-tighter border border-error/5">
                                  <div className="w-1 h-1 rounded-full bg-error animate-pulse"></div>
                                  Stock Alert
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-md bg-primary/10 text-[10px] font-black text-primary uppercase tracking-tighter border border-primary/5">
                                  Manual Note
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            className="btn btn-ghost btn-circle btn-sm text-primary/60 hover:text-primary hover:bg-primary/10 transition-all duration-200"
                            title="Search deals for this item"
                            onClick={() => handleQuickSearch(item.name)}
                          >
                            <Search size={18} />
                          </button>
                          <button
                            className="btn btn-ghost btn-circle btn-sm text-error/60 hover:text-error hover:bg-error/10 transition-all duration-200"
                            onClick={() => removeBuyItem(item.id)}
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-20 bg-base-200/30 rounded-3xl border border-dashed border-base-content/10">
                      <div className="bg-base-100 w-16 h-16 rounded-2xl shadow-xl flex items-center justify-center mx-auto mb-4 border border-base-content/5">
                        <ShoppingCart className="text-primary opacity-40" size={32} />
                      </div>
                      <p className="font-bold text-base-content/30 italic">No reminders for your next grocery run.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* TAB 6: SETTINGS */}
          <div className="w-full shrink-0 h-full overflow-y-auto no-scrollbar pt-4 px-4 pb-4">
            <div className="max-w-4xl mx-auto space-y-6 pb-10">
              <div className="card bg-base-100 shadow-xl overflow-hidden border border-base-200">
                <div className="bg-primary h-24 w-full"></div>
                <div className="card-body p-6 -mt-12">
                  <div className="flex flex-col items-center gap-2 mb-6">
                    <div className="avatar">
                      <div className="w-24 rounded-full border-4 border-base-100 shadow-xl">
                        <img src="https://picsum.photos/seed/user1/200/200" alt="Profile" />
                      </div>
                    </div>
                    <h2 className="text-2xl font-black">{userName || 'Family Member'}</h2>
                    <div className="flex flex-col items-center gap-1">
                      <p className="text-xs opacity-50 font-bold uppercase tracking-widest">{userEmail}</p>
                      {userPhone && <p className="text-[10px] opacity-40 font-black tracking-tighter">{userPhone}</p>}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="bg-base-200/50 rounded-3xl p-6 border border-base-content/5">
                      <h3 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-4 flex items-center gap-2">
                        <User size={12} /> Contact Information
                      </h3>
                      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-base-100 p-4 rounded-2xl border border-base-content/5 shadow-sm overflow-hidden">
                        <div className="flex items-center gap-4 w-full sm:w-auto min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                            <Send size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-black opacity-40 uppercase tracking-tighter">Notification Email</p>
                            <p className="text-sm font-bold truncate">{userEmail}</p>
                          </div>
                        </div>
                        <button className="btn btn-primary btn-sm rounded-xl px-6 w-full sm:w-auto shrink-0" onClick={handleBindEmail}>
                          Change
                        </button>
                      </div>
                    </div>

                    <div className="bg-base-200/50 rounded-3xl p-6 border border-base-content/5">
                      <h3 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-4 flex items-center gap-2">
                        <Activity size={12} /> Privacy & Alerts
                      </h3>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center p-4 bg-base-100 rounded-2xl border border-base-content/5 shadow-sm">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-secondary/10 flex items-center justify-center text-secondary">
                              <Bell size={18} />
                            </div>
                            <span className="font-bold text-sm">Email Notifications</span>
                          </div>
                          <input
                            type="checkbox"
                            className="toggle toggle-primary"
                            checked={emailNotifications}
                            onChange={(e) => toggleEmailNotifications(e.target.checked)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="divider opacity-10"></div>

                    <button
                      onClick={async () => {
                        await supabase.auth.signOut();
                        setSession(null);
                      }}
                      className="btn btn-error btn-outline btn-block gap-4 h-14 rounded-2xl font-black uppercase tracking-tighter"
                    >
                      <LogOut size={20} /> Sign Out
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Loading Overlays */}
      {isAnalyzing && (
        <div className="fixed inset-0 z-100 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center text-white p-6 text-center">
          <span className="loading loading-infinity loading-lg text-primary scale-150"></span>
          <p className="font-black text-2xl mt-4 tracking-tighter uppercase">AI Scanning Inventory</p>
        </div>
      )}

      {isLoadingDetails && (
        <div className="fixed inset-0 z-100 bg-base-100/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
          <BookOpen size={48} className="text-primary animate-bounce mb-4" />
          <h3 className="text-xl font-bold">Chef AI is preparing your Cookbook...</h3>
        </div>
      )}

      <CameraModal
        isOpen={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCapture={handleCapture}
      />

      {/* Bottom navbar */}
      <div className="dock dock-md bg-base-100 border-t border-base-300 z-60 shadow-2xl">
        <button className={activeTab === 'dashboard' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => handleTabChange('dashboard')}>
          <LayoutDashboard size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Home</span>
        </button>
        <button className={activeTab === 'search' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => handleTabChange('search')}>
          <Search size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Search</span>
        </button>
        <button className={activeTab === 'inventory' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => handleTabChange('inventory')}>
          <Package size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Fridge</span>
        </button>
        <button className={activeTab === 'recipes' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => handleTabChange('recipes')}>
          <ChefHat size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Chef AI</span>
        </button>
        <button className={activeTab === 'shop' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => handleTabChange('shop')}>
          <ShoppingCart size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Shop</span>
        </button>
        <button className={activeTab === 'settings' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => handleTabChange('settings')}>
          <User size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Me</span>
        </button>
      </div>

      {/* STORE DETAILS MODAL */}
      {activeStoreModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={() => setActiveStoreModal(null)}></div>
          <div className="bg-base-100 w-full max-w-2xl max-h-[85vh] rounded-[2rem] shadow-2xl relative z-10 overflow-hidden flex flex-col animate-in zoom-in-95 slide-in-from-bottom-8 duration-500 border border-base-content/10">
            {/* Modal Header */}
            {/* Map top */}
            <div className="p-8 pb-4 mb-4 relative overflow-hidden shrink-0">
              {/* Header Visual: Permanent Interior Image */}
              <div className="absolute inset-0 z-0 bg-base-300">
                {activeStoreModal.thumbnail_url ? (
                  <div className="w-full h-full relative animate-in fade-in duration-300">
                    <img
                      src={activeStoreModal.thumbnail_url}
                      alt={activeStoreModal.premise}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-base-100 via-base-100/40 to-transparent"></div>
                  </div>
                ) : (
                  <div className="w-full h-full bg-primary/5 flex items-center justify-center">
                    <Package size={48} className="opacity-10" />
                  </div>
                )}
              </div>

              <div className="absolute top-4 right-4 z-20">
                <button className="btn btn-sm btn-circle bg-base-100/80 backdrop-blur border-none shadow-lg hover:bg-base-100" onClick={() => setActiveStoreModal(null)}>
                  <X size={18} />
                </button>
              </div>

              <div className="relative z-10 flex flex-col md:flex-row justify-between items-start gap-4">
                <div>
                  <div className="badge badge-primary badge-sm font-black uppercase tracking-widest mb-2">{activeStoreModal.premise_type}</div>
                  <h2 className="text-2xl font-black tracking-tight leading-tight">{activeStoreModal.premise}</h2>
                  <p className="text-[11px] opacity-60 mt-1 flex items-center gap-1.5 font-medium italic">
                    <MapPin size={10} /> {activeStoreModal.address}
                  </p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <div className="bg-base-200/50 p-3 rounded-2xl flex items-center gap-3 border border-base-content/5">
                    <div className="text-right">
                      <p className="text-[9px] font-black opacity-40 uppercase tracking-tighter">Proximity</p>
                      <p className="text-sm font-black">{activeStoreModal.distance_km?.toFixed(1) || '?'} KM</p>
                    </div>
                    <div className="divider divider-horizontal m-0 opacity-10"></div>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${activeStoreModal.lat},${activeStoreModal.lon}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-circle btn-primary btn-sm shadow-lg shadow-primary/30"
                    >
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Body: Scrollable Content */}
            <div className="flex-1 overflow-y-auto mt-2 px-8 pb-8 no-scrollbar">
              {/* Integrated Mini Map */}
              {/* Map Bottom */}
              <div
                className="top-0 bg-base-100 pt-2 pb-4 z-20 border-b border-base-content/5 mb-4 flex justify-between items-center cursor-pointer hover:bg-base-200/50 transition-colors px-2 -mx-2 rounded-xl"
                onClick={() => setIsMapExpanded(!isMapExpanded)}
              >
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-base-content/40 flex items-center gap-2">
                  <Map size={12} /> Map Location
                </h3>
                <div className={`transition-transform duration-300 text-base-content/20 ${isMapExpanded ? 'rotate-180' : ''}`}>
                  <ChevronRight size={14} className="rotate-90" />
                </div>
              </div>

              <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isMapExpanded ? 'max-h-[500px] mb-8 opacity-100 scale-100' : 'max-h-0 mb-0 opacity-0 scale-95'}`}>
                <div className="h-64 rounded-xl overflow-hidden border border-base-content/10 relative group/map">
                  <iframe
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    style={{ border: 0 }}
                    src={`https://maps.google.com/maps?q=${encodeURIComponent(activeStoreModal.premise + ' ' + activeStoreModal.address)}&t=&z=14&ie=UTF8&iwloc=&output=embed`}
                    allowFullScreen
                    className="opacity-70 group-hover/map:opacity-100 transition-opacity w-full h-full"
                  ></iframe>
                  <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-black/5"></div>
                </div>
              </div>

              {/* Product Alternatives Header */}
              <div className="sticky top-0 bg-base-100 pt-1 pb-4 z-20 border-b border-base-content/5 mb-4">
                <h3 className="text-xs font-black uppercase tracking-[0.2em] text-base-content/40 flex items-center gap-2">
                  <List size={12} /> Product Alternatives ({activeStoreModal.items.length})
                </h3>
              </div>

              <div className="grid gap-3">
                {activeStoreModal.items.map((item, idx) => (
                  <div
                    key={idx}
                    className={`bg-base-200/40 rounded-2xl border border-base-content/5 transition-all overflow-hidden ${expandedHistoryItem === item.item_code ? 'ring-2 ring-primary/30 bg-base-100' : 'hover:border-primary/20'}`}
                  >
                    <div
                      className="p-4 cursor-pointer flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
                      onClick={() => setExpandedHistoryItem(expandedHistoryItem === item.item_code ? null : item.item_code)}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-primary/10 text-primary uppercase">{item.item_category}</span>
                          <span className="text-[10px] opacity-40 font-bold">#{item.item_code}</span>
                        </div>
                        <h4 className="font-bold text-sm leading-tight text-base-content/80">{item.item}</h4>
                        <div className="flex gap-3 mt-1.5 opacity-50 text-[10px] font-bold">
                          <span>{item.unit}</span>
                          <span>•</span>
                          <span className="italic">Latest Check: {new Date(item.date).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 w-full md:w-auto">
                        <div className="text-lg font-black text-primary bg-primary/5 px-4 py-2 rounded-xl border border-primary/10 flex-1 md:flex-none text-center">
                          RM {item.price.toFixed(2)}
                        </div>
                        <div className={`transition-transform duration-300 ${expandedHistoryItem === item.item_code ? 'rotate-180 text-primary' : 'opacity-20'}`}>
                          <ChevronRight size={16} />
                        </div>
                      </div>
                    </div>

                    {/* PRICE HISTORY SECTION */}
                    {expandedHistoryItem === item.item_code && (
                      <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-300">
                        <div className="bg-base-300/30 rounded-xl p-4 border border-base-content/5">
                          <h5 className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-3 flex items-center gap-1.5">
                            <Clock size={10} /> Price Journey (History)
                          </h5>
                          <div className="space-y-2">
                            {item.history.map((h, hIdx) => (
                              <div key={hIdx} className="flex justify-between items-center text-xs">
                                <span className="opacity-60 font-medium">{new Date(h.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                                <div className="flex items-center gap-2">
                                  {hIdx < item.history.length - 1 && (
                                    <span className={`text-[9px] font-bold ${h.price < item.history[hIdx + 1].price ? 'text-success' : h.price > item.history[hIdx + 1].price ? 'text-error' : 'opacity-20'}`}>
                                      {h.price < item.history[hIdx + 1].price ? '↓' : h.price > item.history[hIdx + 1].price ? '↑' : '='}
                                    </span>
                                  )}
                                  <span className="font-black">RM {h.price.toFixed(2)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-[9px] text-center opacity-30 mt-4 font-bold italic">Prices tracked by government transparency initiatives.</p>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 bg-base-200/30 border-t border-base-content/5 flex justify-between items-center shrink-0">
              <button className="btn btn-ghost btn-sm normal-case font-bold" onClick={() => setActiveStoreModal(null)}>Close</button>
              <p className="text-[10px] opacity-40 font-bold">Price Catcher API Sync • {activeStoreModal.last_date}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;