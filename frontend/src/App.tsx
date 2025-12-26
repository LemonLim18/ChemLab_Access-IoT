import React, { useState, useEffect, useCallback } from 'react';
import Swal from 'sweetalert2';
import { LayoutDashboard, Search, ShoppingCart, ExternalLink, ChefHat, Settings, Plus, Camera, Package, Activity, MapPin, DollarSign, User, LogOut, Send, ArrowLeft, BookOpen, Clock, Sparkles, Trash2, ListFilter, RefreshCw, Check, Milk, Carrot, Apple, Beef, CupSoda, Utensils, List, ChevronRight } from 'lucide-react';

import type { FridgeItem, SensorData, Notification, Recipe, StoreResult, BuyItem } from '../types';
import { FreshnessStatus } from '../types';
import { INITIAL_INVENTORY, INITIAL_SENSORS, INITIAL_NOTIFICATIONS } from '../constants';
import Navbar from '../components/Navbar';
import RealtimeStatusCard from '../components/RealtimeStatusCard';
import SlotCard from '../components/SlotCard';
import CameraModal from '../components/CameraModal';
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

  const [buyList, setBuyList] = useState<BuyItem[]>([]);
  const [manualBuyInput, setManualBuyInput] = useState('');

  // IoT Internal Camera State
  const [fridgeSnapshot, setFridgeSnapshot] = useState<string>('https://images.unsplash.com/photo-1584269600464-37b1b58a9fe7?q=80&w=1000&auto=format&fit=crop');
  const [pendingSnapshot, setPendingSnapshot] = useState<string>('');
  const lastKnownCaptureTime = React.useRef<string>('');
  const [lastSnapshotTime, setLastSnapshotTime] = useState<string>('');
  const [isRefreshingSnapshot, setIsRefreshingSnapshot] = useState(false);
  const [activeStoreModal, setActiveStoreModal] = useState<StoreResult | null>(null);
  const [expandedHistoryItem, setExpandedHistoryItem] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Store Finder State
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [nearestStores, setNearestStores] = useState<StoreResult[]>([]);
  const [cheapestStores, setCheapestStores] = useState<StoreResult[]>([]);
  // Used in handleStoreSearch commented-out code
  void setNearestStores;
  void setCheapestStores;
  const [isSearchingStores, setIsSearchingStores] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [fullLocationName, setFullLocationName] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);

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
      } catch (error) {
        console.error('[Startup] Failed to fetch initial state:', error);
      }
    };

    fetchInitialState();
  }, []);

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

        setSensorHistory(prev => {
          const newHistory = [...prev, newData];
          if (newHistory.length > 30) return newHistory.slice(1);
          return newHistory;
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

        // 2. Auto-trigger search for low stock items if no query is set
        if (!storeSearchQuery.trim()) {
          const lowStock = inventory.filter(i => i.quantity <= i.reorderThreshold);
          if (lowStock.length > 0) {
            // Sort by lowest quantity first
            const mostUrgent = [...lowStock].sort((a, b) => a.quantity - b.quantity)[0];
            setStoreSearchQuery(mostUrgent.name);

            // Trigger search with the urgent item
            const results = await searchStores(mostUrgent.name, userLocation.lat, userLocation.lng);
            setNearestStores(results.slice(0, 5));
            setCheapestStores([...results].sort((a: any, b: any) => a.min_price - b.min_price).slice(0, 5));
          }
        }
      };
      fetchLocationAndInitialDeals();
    }
  }, [userLocation]); // Re-run when location is synced

  const requestLocation = useCallback((isManual: boolean = false) => {
    if (navigator.geolocation) {
      if (!isManual) setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          console.log("[Location Debug] Raw Coordinates:", {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: `${pos.coords.accuracy} meters`
          });
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
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
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    }
  }, []);

  const promptForLocation = async () => {
    const result = await Swal.fire({
      title: 'Find Local Deals?',
      text: "Grant location access to see the cheapest groceries and nearest stores synchronized with your fridge!",
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
      requestLocation(true);
    }
  };

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if ((tab === 'shop' || tab === 'search') && !userLocation) {
      promptForLocation();
    }
  };

  const handleStoreSearch = async () => {
    if (!storeSearchQuery.trim()) return;
    setIsSearchingStores(true);

    try {
      const results = await searchStores(
        storeSearchQuery,
        userLocation?.lat,
        userLocation?.lng
      );

      setNearestStores(results.slice(0, 5));
      setCheapestStores(results.sort((a: any, b: any) => a.min_price - b.min_price).slice(0, 5));

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
    const { value: newName } = await Swal.fire({
      title: 'Update Name',
      input: 'text',
      inputLabel: `Rename ${item.name}`,
      inputValue: item.name,
      showCancelButton: true,
      confirmButtonText: 'Save Changes',
      customClass: {
        popup: 'rounded-3xl p-6 border border-base-content/10 shadow-2xl',
        confirmButton: 'btn btn-primary px-8 rounded-xl mr-2',
        cancelButton: 'btn btn-ghost px-8 rounded-xl',
        input: 'input input-bordered w-full max-w-xs rounded-xl mt-4'
      },
      buttonsStyling: false,
      inputValidator: (value) => {
        if (!value) return 'Name cannot be empty!';
        return null;
      }
    });

    if (newName) {
      setInventory(prev => prev.map(i => i.id === item.id ? { ...i, name: newName } : i));
      Swal.fire({
        toast: true,
        position: 'top-end',
        icon: 'success',
        title: 'Name updated!',
        showConfirmButton: false,
        timer: 2000,
        timerProgressBar: true
      });
    }
  };

  const addToBuyList = (name: string, source: 'low-stock' | 'manual' = 'manual') => {
    if (!name.trim()) return;
    const newItem: BuyItem = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      source,
      completed: false
    };
    setBuyList(prev => [...prev, newItem]);
    if (source === 'manual') setManualBuyInput('');
  };

  const toggleBuyItem = (id: string) => {
    setBuyList(prev => prev.map(item => item.id === id ? { ...item, completed: !item.completed } : item));
  };

  const removeBuyItem = (id: string) => {
    setBuyList(prev => prev.filter(item => item.id !== id));
  };

  const lowStockItems = inventory.filter(i => i.quantity <= i.reorderThreshold);

  return (
    <div className="flex flex-col min-h-screen">
      <div className="fixed top-0 left-0 right-0 z-50">
        <Navbar
          onOpenSettings={() => handleTabChange('settings')}
          onOpenAlerts={() => handleTabChange('dashboard')}
          unreadCount={notifications.filter(n => !n.isRead).length}
          onToggleLocation={() => requestLocation(true)}
          userLocation={userLocation}
          isLocating={isLocating}
        />
      </div>

      <main
        // className="flex-1 overflow-hidden mt-16 pb-24"
        className="flex-1 overflow-hidden mt-16 pb-24"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex transition-transform duration-500 ease-in-out h-full items-start"
          style={{ transform: `translateX(-${TABS.indexOf(activeTab) * 100}%)` }}
        >
          {/* TAB 1: DASHBOARD */}
          <div className="w-full shrink-0 p-4 space-y-6">
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Premium Location Banner */}
              {fullLocationName && (
                <div className="card bg-gradient-to-br from-primary/10 to-base-100 border border-primary/20 shadow-xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-700">
                  <div className="card-body p-4 flex-row items-center gap-4">
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
                <div className="flex justify-between items-center mb-3">
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
                    <div className="mt-2 h-20 flex flex-col justify-center">
                      {cheapestStores.length > 0 ? (
                        <>
                          <p className="font-black text-xl text-base-content/90 line-clamp-1">{cheapestStores[0].premise}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
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
                    <div className="mt-2 h-20 flex flex-col justify-center">
                      {nearestStores.length > 0 ? (
                        <>
                          <p className="font-black text-xl text-base-content/90 line-clamp-1">{nearestStores[0].premise}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
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
          <div className="w-full shrink-0 p-4">
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Redesigned Search Header with Full Location */}
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
                    className={`btn btn-primary join-item px-8 ${isSearchingStores ? 'loading' : ''}`}
                    onClick={handleStoreSearch}
                    disabled={isSearchingStores}
                  >
                    {!isSearchingStores && <Send size={20} />}
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
                          setTimeout(() => handleStoreSearch(), 50);
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
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <MapPin size={20} className="text-secondary" /> Nearest Stores
                </h3>
                <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                  {nearestStores.length > 0 ? nearestStores.map((store, i) => (
                    <div
                      key={i}
                      className="card bg-base-100 shadow-md border border-base-200 min-w-[240px] max-w-[280px] shrink-0 hover:border-secondary transition-all cursor-pointer group active:scale-95"
                      onClick={() => setActiveStoreModal(store)}
                    >
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
                      {isSearchingStores ? <span className="loading loading-dots"></span> : "Search for something to see nearby stores."}
                    </div>
                  )}
                </div>
              </div>

              {/* Cheapest Stores Row */}
              <div className="space-y-3">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <DollarSign size={20} className="text-success" /> Best Deals & Cheapest
                </h3>
                <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                  {cheapestStores.length > 0 ? cheapestStores.map((store, i) => (
                    <div
                      key={i}
                      className="card bg-base-100 shadow-md border border-base-200 min-w-[240px] max-w-[280px] shrink-0 hover:border-success transition-all cursor-pointer group active:scale-95"
                      onClick={() => setActiveStoreModal(store)}
                    >
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
                      {isSearchingStores ? <span className="loading loading-dots"></span> : "Discover the best deals in your area."}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* TAB 3: INVENTORY */}
          <div className="w-full shrink-0 pt-0 px-4 pb-4">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="flex justify-between items-center bg-base-100/50 backdrop-blur shadow-sm p-4 rounded-2xl sticky top-0 z-40">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Package className="text-primary" /> Inventory
                </h2>
                <div className="flex gap-2">
                  <button
                    className={`btn btn-sm btn-ghost bg-base-100 border border-base-300 ${isRefreshingSnapshot ? 'opacity-50 cursor-not-allowed' : ''}`}
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
                  <button className="btn btn-sm btn-primary" onClick={() => setIsCameraOpen(true)}>
                    <Camera size={16} /> Scan
                  </button>
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
          <div className="w-full shrink-0 p-4">
            <div className="max-w-4xl mx-auto space-y-6">
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
                      <button className={`btn btn-primary join-item px-8 ${isLoadingRecipes ? 'loading' : ''}`} onClick={handleFetchRecipes} disabled={isLoadingRecipes}>
                        {!isLoadingRecipes && <Send size={20} />}
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
          <div className="w-full shrink-0 p-4">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="card bg-base-100 shadow-xl border border-base-200">
                <div className="card-body p-6">
                  <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                    <ShoppingCart className="text-primary" /> To-purchase List
                  </h2>
                  <div className="flex gap-2 mb-6">
                    <input
                      type="text"
                      placeholder="Add manual reminder..."
                      className="input input-bordered flex-1"
                      value={manualBuyInput}
                      onChange={(e) => setManualBuyInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addToBuyList(manualBuyInput)}
                    />
                    <button className="btn btn-primary" onClick={() => addToBuyList(manualBuyInput)}>
                      <Plus size={20} />
                    </button>
                  </div>
                  <div className="space-y-3">
                    {buyList.length > 0 ? (
                      buyList.map((item) => (
                        <div key={item.id} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${item.completed ? 'bg-base-200 border-transparent opacity-50' : 'bg-base-100 border-base-300 shadow-sm'}`}>
                          <div className="flex items-center gap-3">
                            <button className={`btn btn-circle btn-sm ${item.completed ? 'btn-success text-white border-none' : 'btn-ghost border-base-300'}`} onClick={() => toggleBuyItem(item.id)}>
                              {item.completed ? <Check size={16} /> : <div className="w-4 h-4 rounded-full border border-base-content/20"></div>}
                            </button>
                            <div>
                              <p className={`font-bold ${item.completed ? 'line-through' : ''}`}>{item.name}</p>
                              {item.source === 'low-stock' && (
                                <span className="text-[9px] font-black text-error uppercase">Stock Alert Item</span>
                              )}
                            </div>
                          </div>
                          <button className="btn btn-ghost btn-sm text-error btn-square" onClick={() => removeBuyItem(item.id)}>
                            <Trash2 size={18} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-20 opacity-30">
                        <ShoppingCart size={48} className="mx-auto mb-2" />
                        <p>No items in your shopping list.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* TAB 6: SETTINGS */}
          <div className="w-full shrink-0 p-4">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="card bg-base-100 shadow-xl overflow-hidden border border-base-200">
                <div className="bg-primary h-24 w-full"></div>
                <div className="card-body p-6 -mt-12">
                  <div className="flex flex-col items-center gap-2 mb-6">
                    <div className="avatar">
                      <div className="w-24 rounded-full border-4 border-base-100 shadow-xl">
                        <img src="https://picsum.photos/seed/user1/200/200" alt="Profile" />
                      </div>
                    </div>
                    <h2 className="text-2xl font-black">Family Admin</h2>
                    <p className="text-sm opacity-50">smart.home.user@gmail.com</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <button className="btn btn-ghost justify-start gap-4 h-14">
                      <User size={20} className="text-primary" /> Profile Settings
                    </button>
                    <button className="btn btn-ghost justify-start gap-4 h-14">
                      <Settings size={20} className="text-primary" /> Hub Configuration
                    </button>
                    <div className="divider"></div>
                    <button className="btn btn-error btn-outline gap-4 h-14">
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
            <div className="p-8 pb-4 relative overflow-hidden shrink-0">
              {/* Map Background Embed */}
              <div className="absolute inset-0 z-0 opacity-20 mask-mask-b-to-transparent">
                <iframe
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  style={{ border: 0 }}
                  src={`https://maps.google.com/maps?q=${activeStoreModal.lat},${activeStoreModal.lon}&z=14&output=embed`}
                  allowFullScreen
                ></iframe>
              </div>

              <div className="relative z-10 flex flex-col md:flex-row justify-between items-start gap-4">
                <div>
                  <div className="badge badge-primary badge-sm font-black uppercase tracking-widest mb-2">{activeStoreModal.premise_type}</div>
                  <h2 className="text-2xl font-black tracking-tight leading-tight">{activeStoreModal.premise}</h2>
                  <p className="text-[11px] opacity-60 mt-1 flex items-center gap-1.5 font-medium italic">
                    <MapPin size={10} /> {activeStoreModal.address}
                  </p>
                </div>
                <div className="bg-base-200/50 p-3 rounded-2xl flex items-center gap-3 border border-base-content/5 shrink-0">
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

            {/* Modal Body: Item List */}
            <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-4 no-scrollbar">
              <div className="sticky top-0 bg-base-100 pt-2 pb-4 z-20 border-b border-base-content/5 mb-4">
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