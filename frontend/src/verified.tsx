import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import Verified from '../components/Verified';
import { supabase } from './lib/supabaseClient';
import './index.css';

const VerifiedEntry = () => {
    const [session, setSession] = useState<any>(null);
    const [isChecking, setIsChecking] = useState(true);

    useEffect(() => {
        const authChannel = new BroadcastChannel('supabase_auth_sync');

        // Detect and handle the session from the redirect URL
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            if (session) {
                // Broadcast success to the main tab
                authChannel.postMessage({ type: 'AUTH_SUCCESS', session });
            }
            setIsChecking(false);
        });

        return () => authChannel.close();
    }, []);

    if (isChecking) {
        return (
            <div className="min-h-screen bg-base-200 flex items-center justify-center">
                <span className="loading loading-infinity loading-lg text-primary"></span>
            </div>
        );
    }

    return <Verified session={session} />;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <VerifiedEntry />
    </React.StrictMode>
);
