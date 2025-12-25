// enum is the runtime value, not a type
// import type removes it from JS
import React, { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Search, ShoppingCart, ExternalLink, ChefHat, Settings, Plus, Camera, Package, Activity, MapPin, DollarSign, User, LogOut, Send, ArrowLeft, BookOpen, Clock, Sparkles, Trash2, ListFilter, RefreshCw, Check, Milk, Carrot, Apple, Beef, CupSoda, Utensils } from 'lucide-react';

import type { FridgeItem, SensorData, Notification, Recipe, StoreResult, BuyItem } from '../types';
import { FreshnessStatus } from '../types';
import { INITIAL_INVENTORY, INITIAL_SENSORS, INITIAL_NOTIFICATIONS } from '../constants';
import Navbar from '../components/Navbar';
import RealtimeStatusCard from '../components/RealtimeStatusCard';
import SlotCard from '../components/SlotCard';
import CameraModal from '../components/CameraModal';
import { getRecipeSuggestions, getRecipeDetails, analyzeSnapshot } from '../services/geminiService';



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
        setActiveTab(TABS[currentIndex + 1]);
      } else if (isRightSwipe && currentIndex > 0) {
        setActiveTab(TABS[currentIndex - 1]);
      }
    }
  };

  const getFreshUrl = (url: string) => {
    if (!url) return '';
    // Remove old cache busters if present
    const cleanUrl = url.split('?')[0];
    return `${cleanUrl}?t=${Date.now()}`;
  };

  const handleRefreshSnapshot = useCallback(() => {
    setIsRefreshingSnapshot(true);
    setPendingSnapshot(getFreshUrl(fridgeSnapshot));

    setTimeout(() => {
      setNotifications(prev => [{
        id: Date.now().toString(),
        title: 'IoT Cam Status',
        message: 'Manual refresh triggered. Checking latest view...',
        type: 'info',
        timestamp: new Date().toISOString(),
        isRead: false
      }, ...prev]);
    }, 1000);
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

  const requestLocation = useCallback(() => {
    if (navigator.geolocation) {
      setIsLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setIsLocating(false);
          setNotifications(prev => [{
            id: Date.now().toString(),
            title: 'Location Found',
            message: `Lat: ${pos.coords.latitude.toFixed(4)}, Lng: ${pos.coords.longitude.toFixed(4)}`,
            type: 'success',
            timestamp: new Date().toISOString(),
            isRead: false
          }, ...prev]);
        },
        (err) => {
          console.error("Location error", err);
          setIsLocating(false);
          alert("Could not access your location. Please check your browser permissions.");
        },
        { timeout: 10000 }
      );
    } else {
      alert("Geolocation is not supported by your browser.");
    }
  }, []);

  const handleStoreSearch = async () => {
    if (!storeSearchQuery.trim()) return;
    setIsSearchingStores(true);

    // Ensure we have location
    if (!userLocation) {
      requestLocation();
    }

    // API Call to Uvicorn Backend
    // const { nearest, cheapest } = await searchStores(storeSearchQuery, userLocation?.lat, userLocation?.lng);
    // setNearestStores(nearest);
    // setCheapestStores(cheapest);
    setIsSearchingStores(false);
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
        thumbnail: `https://picsum.photos/seed/${item.name}/200/200`,
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
    alert("Consumption updated! Stock levels for ingredients have been reduced.");
  };

  const removeItem = (id: string) => {
    setInventory(prev => prev.filter(i => i.id !== id));
  };

  const editItem = (item: FridgeItem) => {
    const newName = prompt("Update item name:", item.name);
    if (newName) {
      setInventory(prev => prev.map(i => i.id === item.id ? { ...i, name: newName } : i));
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
          onOpenSettings={() => setActiveTab('settings')}
          onOpenAlerts={() => setActiveTab('dashboard')}
          unreadCount={notifications.filter(n => !n.isRead).length}
          onToggleLocation={requestLocation}
          userLocation={userLocation}
          isLocating={isLocating}
        />
      </div>

      <main
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
          <div className="w-full shrink-0 p-4">
            <div className="max-w-4xl mx-auto space-y-6">
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
                          <span className="text-[10px] text-error font-bold uppercase">{item.quantity}{item.unit === 'percent' ? '%' : ''} left</span>
                        </div>
                        <button
                          className="btn btn-sm btn-primary gap-1"
                          onClick={() => {
                            addToBuyList(item.name, 'low-stock');
                            setActiveTab('shop'); // Direct navigation to the To-buy tab
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
                <div className="card bg-primary/5 border border-primary/20 shadow-sm">
                  <div className="card-body p-4">
                    <h3 className="card-title text-sm text-primary uppercase flex items-center gap-2">
                      <DollarSign size={16} /> Cheapest Nearby
                    </h3>
                    <div className="mt-2">
                      <p className="font-bold text-lg">Walmart Supercenter</p>
                      <button className="btn btn-primary btn-sm btn-block mt-4" onClick={() => setActiveTab('shop')}>Open Smart List</button>
                    </div>
                  </div>
                </div>

                <div className="card bg-secondary/5 border border-secondary/20 shadow-sm">
                  <div className="card-body p-4">
                    <h3 className="card-title text-sm text-secondary uppercase flex items-center gap-2">
                      <MapPin size={16} /> Nearest Store
                    </h3>
                    <div className="mt-2 text-center">
                      <p className="font-bold text-lg">7-Eleven Local</p>
                      <button className="btn btn-secondary btn-sm btn-block mt-4">Get Directions</button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          {/* TAB 2: STORE FINDER */}
          <div className="w-full shrink-0 p-4">
            <div className="max-w-4xl mx-auto space-y-6">
              <div className="card bg-base-100 shadow-xl p-6 border border-base-200">
                <h2 className="text-2xl font-black mb-4 flex items-center gap-2">
                  <Search className="text-primary" /> Store Finder
                </h2>
                <p className="text-sm opacity-60 mb-6">Search for food items to find the best local places to shop.</p>

                <div className="join w-full shadow-lg rounded-full">
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

                {!userLocation && (
                  <button
                    className="btn btn-ghost btn-xs mt-2 gap-2 text-primary"
                    onClick={requestLocation}
                  >
                    <MapPin size={12} /> Enable Location for better results
                  </button>
                )}
              </div>

              {/* Nearest Stores Row */}
              <div className="space-y-3">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <MapPin size={20} className="text-secondary" /> Nearest Stores
                </h3>
                <div className="flex gap-4 overflow-x-auto pb-4 no-scrollbar">
                  {nearestStores.length > 0 ? nearestStores.map((store, i) => (
                    <div key={i} className="card bg-base-100 shadow-md border border-base-200 min-w-[240px] shrink-0 hover:border-secondary transition-colors">
                      <div className="card-body p-4">
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-sm leading-tight line-clamp-2">{store.name}</h4>
                          <span className="badge badge-secondary badge-xs shrink-0">{store.distance}</span>
                        </div>
                        <p className="text-[10px] opacity-60">{store.address}</p>
                        <div className="card-actions justify-end mt-4">
                          <a href={store.uri} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline btn-secondary gap-1">
                            <ExternalLink size={10} /> View Map
                          </a>
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
                    <div key={i} className="card bg-base-100 shadow-md border border-base-200 min-w-[240px] shrink-0 hover:border-success transition-colors">
                      <div className="card-body p-4">
                        <div className="flex justify-between items-start">
                          <h4 className="font-bold text-sm leading-tight line-clamp-2">{store.name}</h4>
                          <span className="badge badge-success badge-xs shrink-0 text-white">{store.priceLevel}</span>
                        </div>
                        <p className="text-[10px] opacity-60">High Savings Potential</p>
                        <div className="card-actions justify-end mt-4">
                          <a href={store.uri} target="_blank" rel="noopener noreferrer" className="btn btn-xs btn-outline btn-success gap-1">
                            <ExternalLink size={10} /> Check Prices
                          </a>
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
        <button className={activeTab === 'dashboard' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => setActiveTab('dashboard')}>
          <LayoutDashboard size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Home</span>
        </button>
        <button className={activeTab === 'search' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => setActiveTab('search')}>
          <Search size={20} />
          <span className="btm-nav-label text-[9px] uppercase font-black">Stores</span>
        </button>
        <button className={activeTab === 'inventory' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => setActiveTab('inventory')}>
          <Package size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Fridge</span>
        </button>
        <button className={activeTab === 'recipes' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => setActiveTab('recipes')}>
          <ChefHat size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Chef AI</span>
        </button>
        <button className={activeTab === 'shop' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => setActiveTab('shop')}>
          <ShoppingCart size={20} />
          <span className="dock-label text-[9px] uppercase font-black">To-buy</span>
        </button>
        <button className={activeTab === 'settings' ? 'active text-primary font-bold' : 'opacity-40'} onClick={() => setActiveTab('settings')}>
          <Settings size={20} />
          <span className="dock-label text-[9px] uppercase font-black">Settings</span>
        </button>
      </div>
    </div>
  );
};

export default App;