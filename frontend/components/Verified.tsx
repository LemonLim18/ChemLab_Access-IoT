import React from 'react';
import { Check } from 'lucide-react';

interface VerifiedProps {
    session?: any;
}

const Verified: React.FC<VerifiedProps> = ({ session }) => {
    return (
        <div className="min-h-screen bg-base-200 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Decorative background elements consistent with Auth page */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-success/10 blur-[100px] rounded-full animate-pulse"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[100px] rounded-full animate-pulse delay-700"></div>

            <div className="card w-full max-w-md bg-base-100/40 backdrop-blur-3xl border border-white/10 shadow-2xl relative z-10 overflow-hidden rounded-[2.5rem]">
                <div className="card-body p-12 text-center space-y-8">
                    <div className="flex flex-col items-center gap-6">
                        <div className="w-24 h-24 bg-success/10 rounded-[2rem] flex items-center justify-center text-success shadow-inner animate-bounce">
                            <Check size={48} strokeWidth={3} />
                        </div>

                        <div className="space-y-2">
                            <h1 className="text-4xl font-black tracking-tighter uppercase leading-none">
                                Email Activated
                            </h1>
                            <p className="text-sm opacity-50 font-bold uppercase tracking-widest text-success">
                                {session?.user?.email ? `Verified: ${session.user.email}` : 'Activation Successful'}
                            </p>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <p className="font-bold text-base-content/70">
                            Your account has been successfully verified. You can now return to the original window to access your dashboard.
                        </p>

                        <div className="p-5 bg-base-100/50 rounded-2xl border border-base-content/5 shadow-inner">
                            <p className="text-[10px] font-black uppercase tracking-widest opacity-60">
                                You may safely close this window
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={() => window.close()}
                        className="btn btn-primary btn-block h-16 rounded-2xl text-lg font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all border-none"
                    >
                        Close This Window
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Verified;
