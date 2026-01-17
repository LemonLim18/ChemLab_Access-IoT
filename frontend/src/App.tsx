// Chemical Lab Storage Container System - Main Application
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import Swal from 'sweetalert2';
import { 
  FlaskConicalIcon, 
  History, 
  Users, 
  Settings, 
  Thermometer, 
  Droplets, 
  Lock, 
  Unlock, 
  AlertTriangle, 
  Camera, 
  CheckCircle, 
  XCircle,
  Bell,
  RefreshCw,
  User,
  LogOut,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

import type { 
  StorageState, 
  Notification, 
  AccessAttempt, 
  RegisteredUser,
  SecurityAlert,
  WebSocketMessage
} from '../types';
import { INITIAL_STORAGE_STATE, INITIAL_NOTIFICATIONS, DEFAULT_THRESHOLDS, TABS } from '../constants';
import { WS_URL, api } from './config';
import type { TabType } from '../constants';
import { supabase } from './lib/supabaseClient';

// ========== COMPONENTS ==========
// HoverModal removed as it is no longer used



const App: React.FC = () => {
  // ========== STATE ==========
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const saved = localStorage.getItem('chemlab_active_tab');
    return (saved as TabType) || 'dashboard';
  });
  
  const [storageState, setStorageState] = useState<StorageState>(INITIAL_STORAGE_STATE);
  const [notifications, setNotifications] = useState<Notification[]>(INITIAL_NOTIFICATIONS);
  const [accessLog, setAccessLog] = useState<AccessAttempt[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [securityAlerts, setSecurityAlerts] = useState<SecurityAlert[]>([]);
  
  const [session, setSession] = useState<any>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  
  const [isCapturing, setIsCapturing] = useState(false);
  const [toasts, setToasts] = useState<{ id: string, title: string, message: string, type: string }[]>([]);
  
  const [theme] = useState<'dark'>('dark'); // Chemical lab uses dark theme
  
  // Temperature history for chart
  const [tempHistory, setTempHistory] = useState<{ time: string, temp: number, humidity: number, timestamp?: string }[]>([]);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  
  // Login form states
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginName, setLoginName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  
  // Environment Thresholds
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS);
  
  // Face registration status for current user
  const [userHasFace, setUserHasFace] = useState(false);
  const [userFaceData, setUserFaceData] = useState<any>(null);
  
  // Auto-lock countdown
  const [autoLockCountdown, setAutoLockCountdown] = useState<number | null>(null);
  
  // Multi-cabinet demo (proof of concept)
  const [selectedCabinet, setSelectedCabinet] = useState<number>(1);
  
  // Fake data for demo cabinets
  const FAKE_CABINETS = [
    { 
      id: 2, 
      name: 'Cabinet 2', 
      status: 'offline' as const,  // Static demo data 
      temperature: 19.5, 
      humidity: 42, 
      door_locked: true, 
      last_access_by: 'Dr. Williams', 
      last_access_time: '2026-01-14T10:30:00',
      accessLog: [
        { id: 'a1', timestamp: '2026-01-14T10:30:00', person_name: 'Dr. Williams', authorized: true },
        { id: 'a2', timestamp: '2026-01-14T08:15:00', person_name: 'Dr. Park', authorized: true },
        { id: 'a3', timestamp: '2026-01-13T16:45:00', person_name: 'Lab Tech Sarah', authorized: true },
      ],
      tempHistory: [
        { time: '10:00', temp: 19.2, humidity: 41 },
        { time: '10:15', temp: 19.4, humidity: 42 },
        { time: '10:30', temp: 19.5, humidity: 42 },
        { time: '10:45', temp: 19.3, humidity: 43 },
        { time: '11:00', temp: 19.5, humidity: 42 },
      ],
      registeredUsers: [
        { id: 'u1', name: 'Dr. Williams', registered_at: '2026-01-01' },
        { id: 'u2', name: 'Dr. Park', registered_at: '2026-01-02' },
        { id: 'u3', name: 'Lab Tech Sarah', registered_at: '2026-01-05' },
      ],
      thresholds: { temperature_min: 18.0, temperature_max: 24.0, humidity_min: 30, humidity_max: 60 },
    },
    { 
      id: 3, 
      name: 'Cabinet 3', 
      status: 'alert' as const,  // RED status - intrusion!
      temperature: 28.5,  // High temp - door was left open
      humidity: 72,  // High humidity
      door_locked: false,  // UNLOCKED - security breach!
      last_access_by: 'Unknown Person', 
      last_access_time: '2026-01-14T13:15:00',
      accessLog: [
        { id: 'b1', timestamp: '2026-01-14T13:15:00', person_name: 'Unknown Person', authorized: false },  // INTRUSION!
        { id: 'b2', timestamp: '2026-01-14T09:00:00', person_name: 'Dr. Chen', authorized: true },
        { id: 'b3', timestamp: '2026-01-13T17:30:00', person_name: 'Dr. Chen', authorized: true },
      ],
      tempHistory: [
        { time: '12:00', temp: 21.5, humidity: 55 },
        { time: '12:30', temp: 23.2, humidity: 60 },
        { time: '13:00', temp: 25.8, humidity: 65 },
        { time: '13:15', temp: 28.5, humidity: 72 },  // Spike after intrusion
      ],
      registeredUsers: [
        { id: 'u4', name: 'Dr. Chen', registered_at: '2026-01-01' },
        { id: 'u5', name: 'Prof. Kim', registered_at: '2026-01-03' },
      ],
      thresholds: { temperature_min: 15.0, temperature_max: 25.0, humidity_min: 35, humidity_max: 65 },
    },
  ];
  // Get current cabinet data (real for Cabinet 1, fake for others)
  const cabinetData = selectedCabinet === 1 
    ? { ...storageState, name: 'Cabinet 1', status: 'online' as const }
    : FAKE_CABINETS.find(c => c.id === selectedCabinet) || { ...storageState, name: 'Cabinet 1', status: 'online' as const };
  
  // Get cabinet-specific chart data (fake for demo cabinets)
  const cabinetChartData = selectedCabinet === 1 
    ? tempHistory 
    : FAKE_CABINETS.find(c => c.id === selectedCabinet)?.tempHistory || [];
  
  // Get cabinet-specific access logs (fake for demo cabinets)
  const cabinetAccessLog = selectedCabinet === 1 
    ? accessLog 
    : FAKE_CABINETS.find(c => c.id === selectedCabinet)?.accessLog || [];
  
  // Get cabinet-specific registered users (fake for demo cabinets)
  const cabinetPersonnel = selectedCabinet === 1 
    ? registeredUsers 
    : FAKE_CABINETS.find(c => c.id === selectedCabinet)?.registeredUsers || [];
  
  const notifRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // Close notifications on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isNotifOpen && 
        notifRef.current && 
        !notifRef.current.contains(event.target as Node) &&
        bellRef.current && 
        !bellRef.current.contains(event.target as Node)
      ) {
        setIsNotifOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isNotifOpen]);
  
  // Auto-lock countdown timer
  useEffect(() => {
    if (autoLockCountdown === null || autoLockCountdown <= 0) return;
    
    const interval = setInterval(() => {
      setAutoLockCountdown(prev => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return null;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [autoLockCountdown]);
  
  // ========== TOAST MANAGEMENT ==========
  const addToast = useCallback((toast: { title: string, message: string, type?: string }) => {
    const id = Date.now().toString();
    const newToast = { ...toast, id, type: toast.type || 'info' };
    
    setToasts(prev => {
      const updated = [...prev, newToast];
      return updated.slice(-3); // Keep only last 3 toasts
    });
    
    setNotifications(prev => [{
      id: `toast-${id}`,
      title: toast.title,
      message: toast.message,
      type: (toast.type || 'info') as any,
      timestamp: new Date().toISOString(),
      isRead: false
    }, ...prev]);
    
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 5000);
  }, []);
  
  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };
  
  // ========== AUTHENTICATION ==========
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        const name = session.user.user_metadata?.username || 
                     session.user.user_metadata?.display_name || 
                     session.user.user_metadata?.full_name || 'Lab Admin';
        setUserName(name);
        setUserEmail(session.user.email || '');
        
        // Check if user has registered face
        fetch(api.userFaceStatus(session.user.id))
          .then(res => res.json())
          .then(data => {
            setUserHasFace(data.has_face);
            setUserFaceData(data.user);
          })
          .catch(() => {});
      }
      setIsAuthChecking(false);
    });
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session?.user) {
        const name = session.user.user_metadata?.username || 
                     session.user.user_metadata?.display_name || 'Lab Admin';
        setUserName(name);
        setUserEmail(session.user.email || '');
        
        // Check if user has registered face
        fetch(api.userFaceStatus(session.user.id))
          .then(res => res.json())
          .then(data => {
            setUserHasFace(data.has_face);
            setUserFaceData(data.user);
          })
          .catch(() => {});
      }
    });
    
    return () => subscription.unsubscribe();
  }, []);
  
  // ========== THEME ==========
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  
  // ========== DATA FETCHING ==========
  const fetchInitialData = useCallback(async () => {
    try {
      // Fetch current state
      const stateRes = await fetch(api.state);
      if (stateRes.ok) {
        const state = await stateRes.json();
        setStorageState(state);
      }
      
      // Fetch access logs
      const logsRes = await fetch(api.accessLogs);
      if (logsRes.ok) {
        const logs = await logsRes.json();
        setAccessLog(logs);
      }
      
      // Fetch registered users

      const usersRes = await fetch(api.registeredUsers);
      if (usersRes.ok) {
        const users = await usersRes.json();
        setRegisteredUsers(users);
      }
      
      // Fetch thresholds
      const threshRes = await fetch(api.thresholds);
      if (threshRes.ok) {
        const data = await threshRes.json();
        setThresholds(data);
      }

      // Fetch history
      const historyRes = await fetch(api.history);
      if (historyRes.ok) {
        const historyData = await historyRes.json();
        // Convert to chart format (reverse to have oldest first)
        const formattedHistory = historyData.reverse().map((item: any) => {
           // Parse timestamp to readable time
           const date = new Date(item.timestamp);
           const timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
           return {
             time: timeLabel,
             temp: item.temperature_celsius || item.temp,
             humidity: item.humidity_percent || item.humidity,
             timestamp: item.timestamp
           };
        });
        setTempHistory(formattedHistory);
      }
    } catch (error) {
      console.error('[App] Error fetching initial data:', error);
    }
  }, []);
  
  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);
  
  // ========== WEBSOCKET ==========
  useEffect(() => {
    const wsUrl = WS_URL;
    const ws = new WebSocket(wsUrl);
    
    ws.onmessage = (event) => {
      const message: WebSocketMessage = JSON.parse(event.data);
      console.log('[WebSocket] Received:', message);
      
      switch (message.type) {
        case 'state_update':
          setStorageState(message.data);
          
          // Handle auto-lock countdown
          if (message.data.auto_lock_at && !message.data.door_locked) {
            const lockTime = new Date(message.data.auto_lock_at).getTime();
            const now = Date.now();
            const remaining = Math.max(0, Math.floor((lockTime - now) / 1000));
            setAutoLockCountdown(remaining > 0 ? remaining : null);
          } else {
            setAutoLockCountdown(null);
          }
          
          // Track temperature history for chart
          setTempHistory(prev => {
            // Use server timestamp if available, otherwise browser time
            const serverTimestamp = message.data.timestamp || message.data.last_update;
            const date = serverTimestamp ? new Date(serverTimestamp) : new Date();
            const timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            
            // Avoid duplicate entries (same timestamp)
            const lastEntry = prev[prev.length - 1];
            if (lastEntry && lastEntry.time === timeLabel) {
              // Update the last entry instead of adding duplicate
              const updated = [...prev.slice(0, -1), { 
                time: timeLabel, 
                temp: message.data.temperature, 
                humidity: message.data.humidity,
                timestamp: serverTimestamp
              }];
              return updated;
            }
            
            const updated = [...prev, { 
              time: timeLabel, 
              temp: message.data.temperature, 
              humidity: message.data.humidity,
              timestamp: serverTimestamp
            }];
            return updated.slice(-50); // Keep last 50 readings for better history
          });
          break;
          
        case 'access_granted':
          addToast({
            title: 'Access Granted',
            message: `Welcome, ${message.data.person_name}!`,
            type: 'success'
          });
          setAccessLog(prev => [message.data, ...prev]);
          setIsCapturing(false);
          break;
          
        case 'access_denied':
          addToast({
            title: 'Access Denied',
            message: message.data.person_name || 'Unauthorized person detected',
            type: 'error'
          });
          setAccessLog(prev => [message.data, ...prev]);
          setIsCapturing(false);
          break;
          
        case 'security_alert':
          addToast({
            title: 'Security Alert',
            message: message.data.message,
            type: 'error'
          });
          setSecurityAlerts(prev => [message.data, ...prev]);
          break;
          
        case 'env_warning':
          addToast({
            title: message.data.title,
            message: message.data.message,
            type: 'warning'
          });
          break;
          
        case 'anomaly_resolved':
          addToast({
            title: 'Issue Resolved',
            message: `${message.data.alert_type} returned to normal after ${message.data.duration_mins} minutes`,
            type: 'success'
          });
          break;
      }
    };
    
    ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
    };
    
    ws.onclose = () => {
      console.log('[WebSocket] Disconnected. Reconnecting in 5s...');
      setTimeout(() => {
        // Reconnect logic handled by re-mounting
      }, 5000);
    };
    
    return () => ws.close();
  }, [addToast]);
  
  // ========== ACTIONS ==========
  const handleCapture = async () => {
    setIsCapturing(true);
    try {
      const res = await fetch(api.trigger, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'capture' })
      });
      
      if (res.ok) {
        addToast({ title: 'Capture Triggered', message: 'Camera is capturing...', type: 'info' });
      }
    } catch (error) {
      console.error('[App] Error triggering capture:', error);
      setIsCapturing(false);
      addToast({ title: 'Error', message: 'Failed to trigger capture', type: 'error' });
    }
  };
  
  const handleLock = async () => {
    try {
      await fetch(api.trigger, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'lock' })
      });
      addToast({ title: 'Door Locked', message: 'Container secured', type: 'success' });
    } catch (error) {
      addToast({ title: 'Error', message: 'Failed to lock door', type: 'error' });
    }
  };
  
  const handleUnlock = async () => {
    try {
      await fetch(api.trigger, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'unlock' })
      });
      addToast({ title: 'Door Unlocked', message: 'Container accessible', type: 'info' });
    } catch (error) {
      addToast({ title: 'Error', message: 'Failed to unlock door', type: 'error' });
    }
  };
  
  const handleRegisterUser = async () => {
    const { value: formValues } = await Swal.fire({
      title: 'Register New User',
      html: `
        <div class="flex flex-col gap-4 text-left">
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1">Full Name</label>
            <input id="swal-name" class="w-full px-4 py-3 rounded-xl bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none transition" placeholder="e.g. Dr. Freeman">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1">Face Recognition Photo</label>
            <div class="relative group">
              <label for="swal-image" class="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer bg-slate-700/30 hover:bg-slate-700/50 hover:border-cyan-500/50 transition group-hover:text-cyan-400">
                <div class="flex flex-col items-center justify-center pt-5 pb-6">
                  <svg class="w-8 h-8 mb-3 text-slate-400 group-hover:text-cyan-400 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  <p class="text-sm text-slate-400" id="file-label-text"><span class="font-semibold">Click to upload</span> or drag and drop</p>
                  <p class="text-xs text-slate-500">SVG, PNG, JPG, JPEG or GIF</p>
                </div>
                <input type="file" id="swal-image" accept="image/png, image/jpeg, image/jpg, image/gif, image/svg+xml" multiple class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
              </label>
            </div>
            <div id="preview-container" class="flex gap-2 mt-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent h-24 empty:hidden"></div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Register',
      didOpen: () => {
        const fileInput = document.getElementById('swal-image') as HTMLInputElement;
        const labelText = document.getElementById('file-label-text');
        const container = document.getElementById('preview-container');

        fileInput.addEventListener('change', () => {
          const files = fileInput.files;
          if (files && files.length > 0) {
            const count = files.length;
            if (labelText) labelText.innerHTML = `<span class='font-semibold text-cyan-400'>${count} images selected</span>`;
            if (container) {
              container.innerHTML = '';
              Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                  if (e.target?.result) {
                    const img = document.createElement('img');
                    img.src = e.target.result as string;
                    img.className = 'w-20 h-20 object-cover rounded-lg border border-slate-500 shadow-md shrink-0';
                    container.appendChild(img);
                  }
                };
                reader.readAsDataURL(file);
              });
            }
          } else {
            if (labelText) labelText.innerHTML = `<span class='font-semibold'>Click to upload</span> or drag and drop`;
            if (container) container.innerHTML = '';
          }
        });
      },
      preConfirm: async () => {
        const name = (document.getElementById('swal-name') as HTMLInputElement).value;
        const fileInput = document.getElementById('swal-image') as HTMLInputElement;
        
        if (!name || !fileInput.files?.length) {
          Swal.showValidationMessage('Please provide name and at least one face image');
          return false;
        }
        
        const files = Array.from(fileInput.files);
        const images: string[] = [];
        
        // Process all images
        for (const file of files) {
          try {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve((reader.result as string).split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            images.push(base64);
          } catch (err) {
            console.error('Error reading file:', err);
          }
        }
        
        return { name, images };
      }
    });
    
    if (formValues) {
      try {
        const res = await fetch(api.registerFace, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formValues)
        });
        
        if (res.ok) {
          const data = await res.json();
          setRegisteredUsers(prev => [...prev, data.user]);
          addToast({ title: 'User Registered', message: `${formValues.name} can now access the storage`, type: 'success' });
        } else {
          const error = await res.json();
          addToast({ title: 'Registration Failed', message: error.detail, type: 'error' });
        }
      } catch (error) {
        addToast({ title: 'Error', message: 'Failed to register user', type: 'error' });
      }
    }
  };
  
  const handleDeleteUser = async (userId: string, userName: string) => {
    const result = await Swal.fire({
      title: 'Remove User?',
      text: `${userName} will no longer have access`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      confirmButtonText: 'Remove'
    });
    
    if (result.isConfirmed) {
      try {
        await fetch(api.deleteUser(userId), {
          method: 'DELETE'
        });
        setRegisteredUsers(prev => prev.filter(u => u.id !== userId));
        addToast({ title: 'User Removed', message: `${userName} removed from system`, type: 'info' });
      } catch (error) {
        addToast({ title: 'Error', message: 'Failed to remove user', type: 'error' });
      }
    }
  };
  
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };
  
  const handleSaveProfile = async () => {
    try {
      const { error } = await supabase.auth.updateUser({
        data: { 
          full_name: userName,
          display_name: userName
        }
      });
      if (error) throw error;
      addToast({ title: 'Profile Saved', message: 'Your profile has been updated successfully.', type: 'success' });
    } catch (error: any) {
      addToast({ title: 'Error', message: error.message || 'Failed to save profile', type: 'error' });
    }
  };

  const handleSaveThresholds = async () => {
    try {
      const res = await fetch(api.thresholds, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thresholds)
      });
      
      if (res.ok) {
        addToast({ title: 'Settings Saved', message: 'Environment thresholds updated successfully.', type: 'success' });
      } else {
        throw new Error('Failed to update thresholds');
      }
    } catch (error) {
      addToast({ title: 'Error', message: 'Failed to save settings', type: 'error' });
    }
  };
  
  const handleLogin = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      addToast({ title: 'Welcome!', message: 'You have successfully logged in.', type: 'success' });
    } catch (error: any) {
      addToast({ title: 'Login Failed', message: error.message || 'Invalid credentials', type: 'error' });
    }
  };
  
  const handleRegister = async (email: string, password: string, name: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({ 
        email, 
        password,
        options: { data: { full_name: name, display_name: name } }
      });
      if (error) throw error;
      addToast({ title: 'Account Created', message: 'Please check your email to verify your account.', type: 'success' });
      
      // Prompt to register face after account creation
      if (data.user) {
        const result = await Swal.fire({
          title: 'Enable Face Access?',
          text: 'Would you like to register your face for door access now?',
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: 'Yes, register my face',
          cancelButtonText: 'Skip for now',
          confirmButtonColor: '#06b6d4'
        });
        
        if (result.isConfirmed) {
          await handleRegisterMyFace(data.user.id, name);
        }
      }
    } catch (error: any) {
      addToast({ title: 'Registration Failed', message: error.message || 'Could not create account', type: 'error' });
    }
  };
  
  const handleRegisterMyFace = async (authUserId?: string, userName?: string) => {
    const userId = authUserId || session?.user?.id;
    const name = userName || session?.user?.user_metadata?.full_name || session?.user?.user_metadata?.display_name || 'User';
    
    if (!userId) {
      addToast({ title: 'Error', message: 'You must be logged in to register your face', type: 'error' });
      return;
    }
    
    const { value: formValues } = await Swal.fire({
      title: 'Register Your Face',
      html: `
        <div class="flex flex-col gap-4 text-left">
          <p class="text-sm text-slate-400">Upload clear photos of your face for door access recognition.</p>
          <div>
            <label class="block text-sm font-medium text-slate-400 mb-1">Face Recognition Photos</label>
            <div class="relative group">
              <label for="swal-face-image" class="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-600 rounded-xl cursor-pointer bg-slate-700/30 hover:bg-slate-700/50 hover:border-cyan-500/50 transition">
                <div class="flex flex-col items-center justify-center pt-5 pb-6">
                  <svg class="w-8 h-8 mb-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                  <p class="text-sm text-slate-400" id="face-file-label"><span class="font-semibold">Click to upload</span> photos</p>
                  <p class="text-xs text-slate-500">PNG, JPG or JPEG</p>
                </div>
                <input type="file" id="swal-face-image" accept="image/png, image/jpeg, image/jpg" multiple class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
              </label>
            </div>
            <div id="face-preview-container" class="flex gap-2 mt-3 overflow-x-auto pb-2 h-24 empty:hidden"></div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Register Face',
      confirmButtonColor: '#06b6d4',
      didOpen: () => {
        const fileInput = document.getElementById('swal-face-image') as HTMLInputElement;
        const labelText = document.getElementById('face-file-label');
        const container = document.getElementById('face-preview-container');

        fileInput?.addEventListener('change', () => {
          const files = fileInput.files;
          if (files && files.length > 0) {
            if (labelText) labelText.innerHTML = `<span class='font-semibold text-cyan-400'>${files.length} images selected</span>`;
            if (container) {
              container.innerHTML = '';
              Array.from(files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (e) => {
                  if (e.target?.result) {
                    const img = document.createElement('img');
                    img.src = e.target.result as string;
                    img.className = 'w-20 h-20 object-cover rounded-lg border border-slate-500 shadow-md shrink-0';
                    container.appendChild(img);
                  }
                };
                reader.readAsDataURL(file);
              });
            }
          }
        });
      },
      preConfirm: async () => {
        const fileInput = document.getElementById('swal-face-image') as HTMLInputElement;
        
        if (!fileInput.files?.length) {
          Swal.showValidationMessage('Please provide at least one face image');
          return false;
        }
        
        const files = Array.from(fileInput.files);
        const images: string[] = [];
        
        for (const file of files) {
          try {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve((reader.result as string).split(',')[1]);
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            images.push(base64);
          } catch (err) {
            console.error('Error reading file:', err);
          }
        }
        
        return { images };
      }
    });
    
    if (formValues) {
      // Show loading indicator
      Swal.fire({
        title: 'Processing...',
        html: '<p class="text-slate-400">Registering your face. Please wait...</p>',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => {
          Swal.showLoading();
        }
      });
      
      try {
        const res = await fetch(api.registerFace, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name,
            images: formValues.images,
            auth_user_id: userId
          })
        });
        
        Swal.close(); // Close loading indicator
        
        if (res.ok) {
          const data = await res.json();
          setUserHasFace(true);
          setUserFaceData(data.user);
          setRegisteredUsers(prev => [...prev, data.user]);
          Swal.fire({
            icon: 'success',
            title: 'Face Registered!',
            text: 'You can now unlock the door with your face.',
            confirmButtonColor: '#06b6d4'
          });
        } else {
          const error = await res.json();
          Swal.fire({
            icon: 'error',
            title: 'Registration Failed',
            text: error.detail || 'Could not register your face.',
            confirmButtonColor: '#ef4444'
          });
        }
      } catch (error) {
        Swal.close();
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: 'Failed to register face. Please try again.',
          confirmButtonColor: '#ef4444'
        });
      }
    }
  };
  
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    localStorage.setItem('chemlab_active_tab', tab);
  };
  
  // ========== HELPER FUNCTIONS ==========
  const getTempStatus = () => {
    const temperature = cabinetData.temperature;
    if (temperature > thresholds.temperature_max) return 'danger';
    if (temperature < thresholds.temperature_min) return 'danger';
    return 'normal';
  };
  
  const getHumidityStatus = () => {
    const humidity = cabinetData.humidity;
    if (humidity > thresholds.humidity_max) return 'danger';
    if (humidity < thresholds.humidity_min) return 'danger';
    return 'normal';
  };
  
  const formatTime = (isoString: string | null | undefined) => {
    if (!isoString) return 'Never';
    return new Date(isoString).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  const timeAgo = (isoString: string | null | undefined) => {
    if (!isoString) return 'Unknown';
    const seconds = Math.floor((new Date().getTime() - new Date(isoString).getTime()) / 1000);
    
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + "y ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + "mo ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + "d ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + "m ago";
    if (seconds < 10) return "Just now";
    return Math.floor(seconds) + "s ago";
  };

  // ========== AUTH CHECK ==========
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-pulse flex flex-col items-center gap-4">
          <FlaskConicalIcon className="w-16 h-16 text-cyan-500" />
          <p className="text-cyan-300">Loading ChemLab Access Control...</p>
        </div>
      </div>
    );
  }

  // ========== LOGIN PAGE (if not authenticated) ==========
  if (!session) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex p-4 rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 shadow-lg shadow-cyan-500/20 mb-4">
              <FlaskConicalIcon className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">ChemLab Access</h1>
            <p className="text-slate-400">Secure Storage Container System</p>
          </div>
          
          <div className="bg-slate-800/50 backdrop-blur-xl rounded-2xl border border-slate-700/50 p-6 shadow-2xl">
            <h2 className="text-xl font-semibold text-white mb-6">
              {isRegistering ? 'Create Account' : 'Sign In'}
            </h2>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              if (isRegistering) {
                handleRegister(loginEmail, loginPassword, loginName);
              } else {
                handleLogin(loginEmail, loginPassword);
              }
            }} className="space-y-4">
              {isRegistering && (
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Full Name</label>
                  <input 
                    type="text" 
                    value={loginName}
                    onChange={(e) => setLoginName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none transition"
                    placeholder="Dr. Freeman"
                    required
                  />
                </div>
              )}
              
              <div>
                <label className="block text-sm text-slate-400 mb-1">Email</label>
                <input 
                  type="email" 
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none transition"
                  placeholder="admin@chemlab.com"
                  required
                />
              </div>
              
              <div>
                <label className="block text-sm text-slate-400 mb-1">Password</label>
                <input 
                  type="password" 
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl bg-slate-700/50 border border-slate-600 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none transition"
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>
              
              <button
                type="submit"
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-semibold hover:from-cyan-600 hover:to-teal-700 transition-all shadow-lg shadow-cyan-500/20"
              >
                {isRegistering ? 'Create Account' : 'Sign In'}
              </button>
            </form>
            
            <div className="mt-6 text-center">
              <button 
                onClick={() => setIsRegistering(!isRegistering)}
                className="text-sm text-cyan-400 hover:text-cyan-300 transition"
              >
                {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Register"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== RENDER ==========
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-100">
      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map(toast => (
          <div 
            key={toast.id}
            className={`
              flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg backdrop-blur-md
              ${toast.type === 'error' ? 'bg-red-500/90' : ''}
              ${toast.type === 'success' ? 'bg-green-500/90' : ''}
              ${toast.type === 'warning' ? 'bg-amber-500/90' : ''}
              ${toast.type === 'info' ? 'bg-cyan-500/90' : ''}
              animate-slide-in
            `}
          >
            <div className="flex-1">
              <p className="font-semibold text-white">{toast.title}</p>
              <p className="text-sm text-white/80">{toast.message}</p>
            </div>
            <button onClick={() => removeToast(toast.id)} className="text-white/60 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-slate-900/80 border-b border-slate-700/50">
        <div className="max-w-7xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg sm:rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 shadow-lg shadow-cyan-500/20">
              <FlaskConicalIcon className="w-7 h-7 text-white" />
            </div>
            <div className="flex flex-col gap-0.5">
              <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-teal-300 bg-clip-text text-transparent">
                ChemLab
              </h1>
              <p className="text-[10px] sm:text-xs text-slate-400">Storage Container System</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 md:gap-7">
            {/* Door Status Badge - Icon only on mobile */}
            <div className={`
              flex items-center gap-2 px-2 sm:px-3 py-2 rounded-full text-xs sm:text-sm font-medium
              ${storageState.door_locked 
                ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}
            `}>
              {storageState.door_locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
              <span className="inline">{storageState.door_locked ? 'Secured' : 'Unlocked'}</span>
            </div>
            
            {/* Notifications Toggle */}
            <button 
              ref={bellRef}
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className={`relative p-2 rounded-xl transition ${isNotifOpen ? 'bg-white text-cyan-400 z-50' : 'hover:bg-white/50 text-white'}`}
            >
              <Bell className="w-5 h-5" />
              {notifications.filter(n => !n.isRead).length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center animate-bounce">
                  {notifications.filter(n => !n.isRead).length}
                </span>
              )}
            </button>
            
            {/* Notification Center Panel */}
            {isNotifOpen && (
              <div 
                ref={notifRef}
                className="absolute top-16 right-4 w-96 max-w-[calc(100vw-2rem)] max-h-[80vh] bg-slate-800/95 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col z-50 animate-slide-in-top"
              >
                  <div className="p-5 border-b border-slate-700/50 flex justify-between items-center bg-slate-900/50">
                    <h3 className="font-semibold text-white flex items-center gap-2">
                    <Bell className="w-4 h-4 text-cyan-400" />
                    Notifications
                  </h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setNotifications(prev => prev.map(n => ({...n, isRead: true})))}
                      className="text-xs text-cyan-400 hover:text-cyan-300"
                      title="Mark all as read"
                    >
                      Mark all read
                    </button>
                    <span className="text-slate-600">|</span>
                    <button 
                      onClick={() => setNotifications([])}
                      className="text-xs text-red-400 hover:text-red-300"
                      title="Clear all notifications"
                    >
                      Delete All
                    </button>
                  </div>
                </div>
                <div className="overflow-y-auto p-3 space-y-3 flex-1 scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-transparent">
                  {notifications.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                      <Bell className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No notifications yet</p>
                    </div>
                  ) : (
                    notifications.map(notif => (
                      <div key={notif.id} className={`p-4 rounded-xl border transition-all relative group ${notif.isRead ? 'bg-slate-800/50 border-transparent opacity-70' : 'bg-slate-700/30 border-slate-600'}`}>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setNotifications(prev => prev.filter(n => n.id !== notif.id));
                          }}
                          className="absolute top-2 right-2 p-1 rounded-full text-slate-500 hover:bg-red-500/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                          title="Delete"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="flex justify-between items-start mb-2 pr-6">
                          <h4 className={`text-sm font-medium ${notif.type === 'error' ? 'text-red-400' : notif.type === 'warning' ? 'text-amber-400' : 'text-cyan-400'}`}>{notif.title}</h4>
                          <span className="text-[10px] text-slate-500 whitespace-nowrap ml-2">{timeAgo(notif.timestamp)}</span>
                        </div>
                        <p className="text-xs text-slate-300 pr-2">{notif.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
            
            {/* User Menu */}
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center">
                <User className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm text-slate-300 hidden sm:block">{userName || 'Admin'}</span>
              <button onClick={handleSignOut} className="ml-2 md:ml-4 p-2 md:p-3 rounded-full border border-red-400/50 hover:bg-red-600/20 hover:border-red-400 transition" title="Sign Out">
                <LogOut className="w-4 h-4 text-red-400" />
              </button>
            </div>
          </div>
        </div>
      </header>
      
      {/* Main Content - Added pb-20 for bottom nav spacing */}
      <main className="max-w-7xl mx-auto px-4 py-6 pb-24">
        {activeTab === 'dashboard' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Status Cards */}
            <div className="lg:col-span-2 space-y-6">
              {/* Cabinet Selector Tabs */}
              <div className="flex items-center gap-2 mb-4 p-1 bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-x-auto">
                {[
                  { id: 1, name: 'Cabinet 1', status: 'online', isStatic: false },
                  { id: 2, name: 'Cabinet 2', status: 'offline', isStatic: true },
                  { id: 3, name: 'Cabinet 3', status: 'alert', isStatic: true },
                ].map(cabinet => (
                  <button
                    key={cabinet.id}
                    onClick={() => setSelectedCabinet(cabinet.id)}
                    className={`
                      flex items-center gap-2 px-4 py-2.5 rounded-lg transition-all duration-200 whitespace-nowrap
                      ${selectedCabinet === cabinet.id 
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-lg shadow-cyan-500/10' 
                        : 'text-slate-400 hover:text-white hover:bg-slate-700/50'}
                    `}
                  >
                    <FlaskConicalIcon className="w-4 h-4" />
                    <span className="font-medium text-sm">{cabinet.name}</span>
                    {cabinet.isStatic && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-600/50 text-slate-400 font-medium">Static</span>
                    )}
                    <span className={`w-2 h-2 rounded-full ${
                      cabinet.status === 'online' ? 'bg-emerald-400' : 
                      cabinet.status === 'alert' ? 'bg-red-500 animate-pulse' : 
                      'bg-slate-500'
                    }`} />
                  </button>
                ))}
              </div>
              
              {/* Environment Monitoring - Responsive Grid: 1 col mobile, 2 cols tablet (Door spans full width) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Temperature */}
                <div className={`
                  p-5 rounded-2xl border backdrop-blur-md transition-all duration-300
                  ${getTempStatus() === 'danger' 
                    ? 'bg-red-500/10 border-red-500/30 shadow-[0_0_30px_-10px_rgba(239,68,68,0.3)]' 
                    : 'bg-slate-800/50 border-slate-700/50 hover:border-cyan-500/30'}
                `}>
                  <div className="flex items-center gap-4 mb-2">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 shadow-lg shadow-orange-500/20">
                      <Thermometer className="w-6 h-6 text-white" />
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Temperature</span>
                      <span className="text-2xl font-bold font-mono text-white leading-none mt-1">{cabinetData.temperature.toFixed(1)}°C</span>
                    </div>

                    <div className={`ml-auto px-2.5 py-1 rounded-full text-xs font-semibold border ${
                      getTempStatus() === 'danger' 
                        ? 'bg-red-500/20 text-red-300 border-red-500/30' 
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    }`}>
                      {getTempStatus() === 'danger' ? 'Critical' : 'Optimal'}
                    </div>
                  </div>
                  
                  {/* Inline Threshold Info */}
                  <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Safe Range:</span>
                      <span className="text-slate-300">{thresholds.temperature_min}°C - {thresholds.temperature_max}°C</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      Updated: {formatTime(storageState.lastTemperatureUpdate)}
                    </div>
                  </div>
                </div>
                
                {/* Humidity */}
                <div className={`
                  p-5 rounded-2xl border backdrop-blur-md transition-all duration-300
                  ${getHumidityStatus() === 'danger' 
                    ? 'bg-red-500/10 border-red-500/30 shadow-[0_0_30px_-10px_rgba(239,68,68,0.3)]' 
                    : 'bg-slate-800/50 border-slate-700/50 hover:border-cyan-500/30'}
                `}>
                  <div className="flex items-center gap-4 mb-2">
                    <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 shadow-lg shadow-blue-500/20">
                      <Droplets className="w-6 h-6 text-white" />
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Humidity</span>
                      <span className="text-2xl font-bold font-mono text-white leading-none mt-1">{cabinetData.humidity}%</span>
                    </div>

                     {/* Status Badge */}
                    <div className={`ml-auto px-2.5 py-1 rounded-full text-xs font-semibold border ${
                      getHumidityStatus() === 'danger' 
                        ? 'bg-red-500/20 text-red-300 border-red-500/30' 
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    }`}>
                      {getHumidityStatus() === 'danger' ? 'Critical' : 'Optimal'}
                    </div>
                  </div>
                  
                  {/* Inline Threshold Info */}
                  <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Safe Range:</span>
                      <span className="text-slate-300">{thresholds.humidity_min}% - {thresholds.humidity_max}%</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      Updated: {formatTime(storageState.lastHumidityUpdate)}
                    </div>
                  </div>
                </div>




                {/* Door Status */}
                <div className={`
                  md:col-span-2
                  p-5 rounded-2xl border backdrop-blur-md transition-all duration-300
                  ${cabinetData.door_locked 
                    ? 'bg-green-500/10 border-green-500/30' 
                    : 'bg-red-500/10 border-red-500/30 shadow-[0_0_30px_-10px_rgba(239,68,68,0.3)]'}
                `}>
                  <div className="flex items-center gap-4 mb-2">
                    <div className={`p-3 rounded-xl ${cabinetData.door_locked ? 'bg-gradient-to-br from-green-500 to-emerald-600' : 'bg-gradient-to-br from-red-500 to-orange-500'} shadow-lg`}>
                      {cabinetData.door_locked ? <Lock className="w-6 h-6 text-white" /> : <Unlock className="w-6 h-6 text-white" />}
                    </div>
                    
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-400 font-medium uppercase tracking-wider">Door Status</span>
                      <span className={`text-2xl font-bold font-mono leading-none mt-1 ${cabinetData.door_locked ? 'text-green-400' : 'text-red-400'}`}>
                        {cabinetData.door_locked ? 'CLOSED' : 'OPEN'}
                      </span>
                      {/* Auto-lock Countdown */}
                      {selectedCabinet === 1 && autoLockCountdown !== null && autoLockCountdown > 0 && (
                        <span className="text-sm text-amber-300 mt-1 animate-pulse">
                          Auto-lock in {autoLockCountdown}s
                        </span>
                      )}
                      {/* Intrusion Alert for Cabinet 3 */}
                      {!cabinetData.door_locked && 'status' in cabinetData && cabinetData.status === 'alert' && (
                        <span className="text-sm text-red-400 mt-1 animate-pulse font-semibold">
                          ⚠️ SECURITY BREACH DETECTED
                        </span>
                      )}
                    </div>

                    <div className={`ml-auto px-2.5 py-1 rounded-full text-xs font-semibold border ${
                      cabinetData.door_locked 
                        ? 'bg-green-500/20 text-green-300 border-green-500/30' 
                        : 'bg-red-500/20 text-red-300 border-red-500/30'
                    }`}>
                      {cabinetData.door_locked ? 'Secure' : 'BREACH!'}
                    </div>
                  </div>
                  
                  {/* Inline Status Info */}
                  <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Policy:</span>
                      <span className="text-slate-300">Auto-lock 15s</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {cabinetData.door_locked 
                        ? `Secured` 
                        : "⚠️ Unauthorized access detected"
                      }
                    </div>
                  </div>
                </div>

              </div>
              
              {/* Environment Trend Charts - Split */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Temperature Chart */}
                <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Thermometer className="w-5 h-5 text-orange-400" />
                    Temperature History
                  </h3>
                  {cabinetChartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={cabinetChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis 
                          dataKey="time" 
                          tick={{ fill: '#94a3b8', fontSize: 10 }} 
                          minTickGap={30}
                        />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} domain={['auto', 'auto']} unit="°C" />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                          labelStyle={{ color: '#94a3b8' }}
                        />
                        <Line type="monotone" dataKey="temp" stroke="#f97316" strokeWidth={2} dot={false} name="Temp" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-44 flex items-center justify-center text-slate-500 text-sm">
                      Waiting for data...
                    </div>
                  )}
                </div>

                {/* Humidity Chart */}
                <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Droplets className="w-5 h-5 text-cyan-400" />
                    Humidity History
                  </h3>
                  {cabinetChartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={cabinetChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis 
                          dataKey="time" 
                          tick={{ fill: '#94a3b8', fontSize: 10 }} 
                          minTickGap={30}
                        />
                        <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} domain={[0, 100]} unit="%" />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: '8px' }}
                          labelStyle={{ color: '#94a3b8' }}
                        />
                        <Line type="monotone" dataKey="humidity" stroke="#06b6d4" strokeWidth={2} dot={false} name="Humidity" />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-44 flex items-center justify-center text-slate-500 text-sm">
                      Waiting for data...
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md hover:border-cyan-500/30 transition-all duration-300">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  {storageState.door_locked ? <Lock className="w-5 h-5 text-green-400" /> : <Unlock className="w-5 h-5 text-amber-400" />}
                  Door Control
                </h3>
                
                {/* Security Status Info */}
                <div className="mb-4 p-3 rounded-xl bg-slate-700/30 space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Auto-lock:</span>
                    <span className="text-slate-300">15 seconds</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Status:</span>
                    <span className={storageState.door_locked ? "text-green-400" : "text-amber-400"}>
                      {storageState.door_locked && storageState.door_closed_since 
                        ? `Secured for ${timeAgo(storageState.door_closed_since).replace(' ago', '')}` 
                        : storageState.door_locked 
                          ? "Door secured"
                          : "Door currently open"
                      }
                    </span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={handleLock}
                    disabled={storageState.door_locked}
                    className={`
                      flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all
                      ${storageState.door_locked 
                        ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed' 
                        : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30'}
                    `}
                  >
                    <Lock className="w-5 h-5" />
                    Lock Door
                  </button>
                  <button
                    onClick={handleUnlock}
                    disabled={!storageState.door_locked}
                    className={`
                      flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition-all
                      ${!storageState.door_locked 
                        ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed' 
                        : 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30'}
                    `}
                  >
                    <Unlock className="w-5 h-5" />
                    Unlock Door
                  </button>
                </div>
                
                {storageState.last_access_by && (
                  <div className="mt-4 p-3 rounded-xl bg-slate-700/30">
                    <p className="text-sm text-slate-400">
                      Last accessed by <span className="text-cyan-400 font-medium">{storageState.last_access_by}</span>
                    </p>
                    <p className="text-xs text-slate-500">{formatTime(storageState.last_access_time)}</p>
                  </div>
                )}
              </div>

              
              {/* Recent Access Log */}
              <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <History className="w-5 h-5 text-cyan-400" />
                  Recent Access
                </h3>
                <div className="space-y-3">
                  {cabinetAccessLog.slice(0, 5).map(log => (
                    <div 
                      key={log.id}
                      className={`
                        flex items-center gap-4 p-3 rounded-xl
                        ${log.authorized ? 'bg-green-500/10' : 'bg-red-500/10'}
                      `}
                    >
                      <div className={`
                        p-2 rounded-full
                        ${log.authorized ? 'bg-green-500/20' : 'bg-red-500/20'}
                      `}>
                        {log.authorized 
                          ? <CheckCircle className="w-5 h-5 text-green-400" />
                          : <XCircle className="w-5 h-5 text-red-400" />
                        }
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{log.person_name || 'Unknown'}</p>
                        <p className="text-xs text-slate-400">{formatTime(log.timestamp)}</p>
                      </div>
                      <span className={`
                        px-2 py-1 text-xs rounded-full
                        ${log.authorized 
                          ? 'bg-green-500/20 text-green-400' 
                          : 'bg-red-500/20 text-red-400'}
                      `}>
                        {log.authorized ? 'Granted' : 'Denied'}
                      </span>
                    </div>
                  ))}
                  {cabinetAccessLog.length === 0 && (
                    <p className="text-center text-slate-500 py-8">No access attempts yet</p>
                  )}
                </div>
              </div>
            </div>
            
            {/* Right Column - Access Panel */}
            <div className="space-y-6">
              {/* Access Request Panel */}
              <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-cyan-500/30 backdrop-blur-md">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Camera className="w-5 h-5 text-cyan-400" />
                  Face Access
                </h3>
                <p className="text-sm text-slate-400 mb-6">
                  Press the physical button on the device or click below to capture and verify your identity.
                </p>
                <button
                  onClick={handleCapture}
                  disabled={isCapturing}
                  className={`
                    w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-md transition-all
                    ${isCapturing 
                      ? 'bg-slate-700 text-slate-400 cursor-wait' 
                      : 'bg-gradient-to-r from-cyan-500 to-teal-500 text-white hover:shadow-lg hover:shadow-cyan-500/30'}
                  `}
                >
                  {isCapturing ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Camera className="w-5 h-5" />
                      Request Access
                    </>
                  )}
                </button>
              </div>
              
              {/* Registered Users Quick View */}
              <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Users className="w-5 h-5 text-cyan-400" />
                  Authorized Personnel
                </h3>
                <div className="space-y-2">
                  {cabinetPersonnel.slice(0, 4).map(user => (
                    <div key={user.id} className="flex items-center gap-3 p-2 md:py-5 md:px-5 rounded-full bg-slate-700/30 hover:bg-slate-600/30 transition">
                      {(user as any).face_image_url ? (
                        <img 
                          src={(user as any).face_image_url} 
                          alt={user.name}
                          className="w-10 h-10 rounded-full object-cover border-2 border-cyan-500/30"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://via.placeholder.com/40?text=?';
                          }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-500/30 to-teal-500/30 border-2 border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold text-sm">
                          {user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="text-sm font-medium">{user.name}</p>
                        <p className="text-xs text-slate-400">Authorized</p>
                      </div>
                      <CheckCircle className="w-4 h-4 text-green-400" />
                    </div>
                  ))}
                  {cabinetPersonnel.length === 0 && (
                    <p className="text-center text-slate-500 py-4">No users registered</p>
                  )}
                </div>
                <button 
                  onClick={() => handleTabChange('users')}
                  className="w-full mt-4 py-2 text-sm text-cyan-400 hover:text-cyan-300 transition"
                >
                  View All →
                </button>
              </div>
              
              {/* Security Alerts */}
              {securityAlerts.length > 0 && (
                <div className="p-6 rounded-2xl bg-red-500/10 border border-red-500/30 backdrop-blur-md">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-red-400">
                    <AlertTriangle className="w-5 h-5" />
                    Security Alerts
                  </h3>
                  <div className="space-y-2">
                    {securityAlerts.slice(0, 3).map(alert => (
                      <div key={alert.id} className="p-3 rounded-lg bg-red-500/10">
                        <p className="text-sm font-medium text-red-300">{alert.message}</p>
                        <p className="text-xs text-red-400/60">{formatTime(alert.timestamp)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        
        {activeTab === 'access-log' && (
          <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <History className="w-6 h-6 text-cyan-400" />
                Access History
              </h2>
              <button 
                onClick={fetchInitialData}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-slate-400 border-b border-slate-700">
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium">Person</th>
                    <th className="pb-3 font-medium">Time</th>
                    <th className="pb-3 font-medium">Image</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {accessLog.map(log => (
                    <tr key={log.id} className="hover:bg-slate-700/30">
                      <td className="py-4">
                        <span className={`
                          inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium
                          ${log.authorized 
                            ? 'bg-green-500/20 text-green-400' 
                            : 'bg-red-500/20 text-red-400'}
                        `}>
                          {log.authorized ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {log.authorized ? 'Granted' : 'Denied'}
                        </span>
                      </td>
                      <td className="py-4 font-medium">{log.person_name || 'Unknown'}</td>
                      <td className="py-4 text-slate-400">{formatTime(log.timestamp)}</td>
                      <td className="py-4">
                        <img 
                          src={log.image_url} 
                          alt="Capture"
                          className="w-12 h-12 rounded-lg object-cover cursor-pointer hover:scale-110 transition"
                          onClick={() => window.open(log.image_url, '_blank')}
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {accessLog.length === 0 && (
                <p className="text-center text-slate-500 py-12">No access records found</p>
              )}
            </div>
          </div>
        )}
        
        {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Users className="w-6 h-6 text-cyan-400" />
                Registered Users
              </h2>
              <button 
                onClick={handleRegisterUser}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 text-white font-medium hover:shadow-lg hover:shadow-cyan-500/30 transition"
              >
                <Plus className="w-5 h-5" />
                Add User
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {registeredUsers.map(user => (
                <div 
                  key={user.id}
                  className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md group hover:border-cyan-500/30 transition"
                >
                  <div className="flex items-start gap-4">
                    <img 
                      src={user.face_image_url} 
                      alt={user.name}
                      className="w-16 h-16 rounded-xl object-cover border-2 border-cyan-500/30"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://via.placeholder.com/64?text=?';
                      }}
                    />
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{user.name}</h3>
                      <p className="text-sm text-slate-400">Registered</p>
                      <p className="text-xs text-slate-500">{formatTime(user.registered_at)}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteUser(user.id, user.name)}
                      className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-red-400 transition"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-700/50">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-500/20 text-green-400 text-xs">
                      <CheckCircle className="w-3 h-3" />
                      Authorized
                    </span>
                  </div>
                </div>
              ))}
            </div>
            
            {registeredUsers.length === 0 && (
              <div className="p-12 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center">
                <Users className="w-16 h-16 text-slate-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-400">No Users Registered</h3>
                <p className="text-slate-500 mb-6">Add authorized personnel to enable face recognition access</p>
                <button 
                  onClick={handleRegisterUser}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 text-white font-medium hover:shadow-lg hover:shadow-cyan-500/30 transition"
                >
                  <Plus className="w-5 h-5" />
                  Register First User
                </button>
              </div>
            )}
          </div>
        )}
        
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Settings className="w-6 h-6 text-cyan-400" />
              System Settings
            </h2>
            
            {/* User Profile */}
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md">
              <h3 className="font-semibold mb-4">Profile</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Name</label>
                  <input 
                    type="text" 
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Email</label>
                  <input 
                    type="email" 
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    className="w-full px-4 py-2 rounded-lg bg-slate-700/50 border border-slate-600 focus:border-cyan-500 focus:outline-none"
                    disabled
                  />
                  <p className="text-xs text-slate-500 mt-1">Email cannot be changed</p>
                </div>
                <button
                  onClick={handleSaveProfile}
                  className="mt-4 w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-medium hover:from-cyan-600 hover:to-teal-700 transition-all shadow-lg shadow-cyan-500/20"
                >
                  Save Profile
                </button>
              </div>
            </div>
            
            {/* Face Access */}
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md">
              <h3 className="font-semibold mb-4 flex items-center gap-2">
                <Camera className="w-5 h-5 text-cyan-400" />
                Face Access
              </h3>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {userHasFace && userFaceData?.face_image_url ? (
                    <img 
                      src={userFaceData.face_image_url} 
                      alt="Your face"
                      className="w-16 h-16 rounded-xl object-cover border-2 border-cyan-500/30"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://via.placeholder.com/64?text=?';
                      }}
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-slate-700/50 border-2 border-dashed border-slate-600 flex items-center justify-center">
                      <Camera className="w-6 h-6 text-slate-500" />
                    </div>
                  )}
                  <div>
                    <p className={`font-medium ${userHasFace ? 'text-green-400' : 'text-amber-400'}`}>
                      {userHasFace ? 'Face Registered ✓' : 'Not Registered'}
                    </p>
                    <p className="text-sm text-slate-400">
                      {userHasFace ? 'You can unlock the door with your face' : 'Register your face to enable door access'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleRegisterMyFace()}
                  className={`px-4 py-2 rounded-xl font-medium transition-all ${
                    userHasFace 
                      ? 'bg-slate-700/50 text-slate-300 hover:bg-slate-700' 
                      : 'bg-gradient-to-r from-cyan-500 to-teal-600 text-white hover:shadow-lg hover:shadow-cyan-500/20'
                  }`}
                >
                  {userHasFace ? 'Update Face' : 'Register Face'}
                </button>
              </div>
            </div>

            {/* Environment Thresholds */}
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md">
              <h3 className="font-semibold mb-4">Environment Thresholds</h3>
              
              {/* Cabinet Selector Tabs */}
              <div className="flex items-center gap-2 mb-4 p-1 bg-slate-700/30 rounded-xl overflow-x-auto">
                {[
                  { id: 1, name: 'Cabinet 1', status: 'online', isStatic: false },
                  { id: 2, name: 'Cabinet 2', status: 'offline', isStatic: true },
                  { id: 3, name: 'Cabinet 3', status: 'alert', isStatic: true },
                ].map(cabinet => (
                  <button
                    key={cabinet.id}
                    onClick={() => setSelectedCabinet(cabinet.id)}
                    className={`
                      flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200 whitespace-nowrap text-sm
                      ${selectedCabinet === cabinet.id 
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' 
                        : 'text-slate-400 hover:text-white hover:bg-slate-600/50'}
                    `}
                  >
                    <FlaskConicalIcon className="w-4 h-4" />
                    <span className="font-medium">{cabinet.name}</span>
                    {cabinet.isStatic && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-600/50 text-slate-400 font-medium">Static</span>
                    )}
                  </button>
                ))}
              </div>
              
              {/* Threshold Inputs */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Min Temp (°C)</label>
                  <input 
                    type="number" 
                    value={selectedCabinet === 1 ? thresholds.temperature_min : (FAKE_CABINETS.find(c => c.id === selectedCabinet)?.thresholds?.temperature_min || 18)}
                    onChange={(e) => selectedCabinet === 1 && setThresholds({...thresholds, temperature_min: parseFloat(e.target.value)})}
                    disabled={selectedCabinet !== 1}
                    className={`w-full px-4 py-2 rounded-lg border focus:outline-none ${selectedCabinet === 1 ? 'bg-slate-700/50 border-slate-600 focus:border-cyan-500' : 'bg-slate-700/30 border-slate-700 text-slate-400 cursor-not-allowed'}`}
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Max Temp (°C)</label>
                  <input 
                    type="number" 
                    value={selectedCabinet === 1 ? thresholds.temperature_max : (FAKE_CABINETS.find(c => c.id === selectedCabinet)?.thresholds?.temperature_max || 25)}
                    onChange={(e) => selectedCabinet === 1 && setThresholds({...thresholds, temperature_max: parseFloat(e.target.value)})}
                    disabled={selectedCabinet !== 1}
                    className={`w-full px-4 py-2 rounded-lg border focus:outline-none ${selectedCabinet === 1 ? 'bg-slate-700/50 border-slate-600 focus:border-cyan-500' : 'bg-slate-700/30 border-slate-700 text-slate-400 cursor-not-allowed'}`}
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Min Humidity (%)</label>
                  <input 
                    type="number" 
                    value={selectedCabinet === 1 ? thresholds.humidity_min : (FAKE_CABINETS.find(c => c.id === selectedCabinet)?.thresholds?.humidity_min || 30)}
                    onChange={(e) => selectedCabinet === 1 && setThresholds({...thresholds, humidity_min: parseFloat(e.target.value)})}
                    disabled={selectedCabinet !== 1}
                    className={`w-full px-4 py-2 rounded-lg border focus:outline-none ${selectedCabinet === 1 ? 'bg-slate-700/50 border-slate-600 focus:border-cyan-500' : 'bg-slate-700/30 border-slate-700 text-slate-400 cursor-not-allowed'}`}
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Max Humidity (%)</label>
                  <input 
                    type="number" 
                    value={selectedCabinet === 1 ? thresholds.humidity_max : (FAKE_CABINETS.find(c => c.id === selectedCabinet)?.thresholds?.humidity_max || 60)}
                    onChange={(e) => selectedCabinet === 1 && setThresholds({...thresholds, humidity_max: parseFloat(e.target.value)})}
                    disabled={selectedCabinet !== 1}
                    className={`w-full px-4 py-2 rounded-lg border focus:outline-none ${selectedCabinet === 1 ? 'bg-slate-700/50 border-slate-600 focus:border-cyan-500' : 'bg-slate-700/30 border-slate-700 text-slate-400 cursor-not-allowed'}`}
                  />
                </div>
              </div>
              
              {selectedCabinet === 1 ? (
                <button
                  onClick={handleSaveThresholds}
                  className="mt-4 w-full py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-600 text-white font-medium hover:from-cyan-600 hover:to-teal-700 transition-all shadow-lg shadow-cyan-500/20"
                >
                  Save Thresholds
                </button>
              ) : (
                <p className="mt-4 text-center text-sm text-slate-500">Static demo data - thresholds are read-only</p>
              )}
            </div>
            
            {/* System Info */}
            <div className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-md">
              <h3 className="font-semibold mb-4">System Information</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Registered Users</span>
                  <span>{registeredUsers.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Access Logs</span>
                  <span>{accessLog.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Last Updated</span>
                  <span>{formatTime(storageState.lastUpdated)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      
      {/* Footer - Hidden on mobile due to bottom nav */}
      <footer className="hidden md:block border-t border-slate-700/30 mt-12 py-6 mb-20">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-slate-500">
          <p>ChemLab Access Control System • Powered by Face Recognition AI</p>
          <p className="text-xs mt-1">Last sync: {formatTime(storageState.lastUpdated)}</p>
        </div>
      </footer>
      
      {/* Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 backdrop-blur-xl bg-slate-900/95 border-t border-slate-700/50 safe-area-pb">
        <div className="max-w-lg md:max-w-7xl mx-auto px-2">
          <div className="flex justify-around items-center py-2">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`
                  flex flex-col items-center justify-center gap-1 px-4 py-2 rounded-xl transition-all min-w-[70px]
                  ${activeTab === tab 
                    ? 'text-cyan-400 bg-cyan-500/10' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}
                `}
              >
                {tab === 'dashboard' && <FlaskConicalIcon className="w-5 h-5" />}
                {tab === 'access-log' && <History className="w-5 h-5" />}
                {tab === 'users' && <Users className="w-5 h-5" />}
                {tab === 'settings' && <Settings className="w-5 h-5" />}
                <span className="text-[10px] font-medium capitalize">{tab.replace('-', ' ')}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>
      
      <style>{`
        @keyframes slide-in {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default App;