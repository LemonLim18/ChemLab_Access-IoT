import React, { useState } from 'react';
import { supabase } from '../src/lib/supabaseClient';
import { Mail, Lock, User, ArrowRight, Sparkles, UserCircle, Phone } from 'lucide-react';
import Swal from 'sweetalert2';

interface AuthProps {
    onSessionChange: (session: any) => void;
}

const Auth: React.FC<AuthProps> = ({ onSessionChange }) => {
    const [loading, setLoading] = useState(false);
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            if (mode === 'signup') {
                if (password !== confirmPassword) {
                    throw new Error('Passwords do not match!');
                }
                const { error } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: window.location.origin + "/verified.html",
                        data: {
                            username,
                            display_name: username,
                            full_name: username,
                            phone,
                        }
                    }
                });
                if (error) throw error;
                Swal.fire({
                    icon: 'success',
                    title: 'Check your email!',
                    text: 'We sent a verification link to your inbox. Please check it to activate your account.',
                    customClass: { popup: 'rounded-3xl' }
                });
                setMode('signin');
                setPassword('');
                setConfirmPassword('');
            } else if (mode === 'signin') {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });
                if (error) throw error;
                onSessionChange(data.session);
            } else if (mode === 'forgot') {
                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin,
                });
                if (error) throw error;
                Swal.fire({
                    icon: 'info',
                    title: 'Reset Link Sent',
                    text: 'If that email exists, a password reset link has been sent.',
                    customClass: { popup: 'rounded-3xl' }
                });
                setMode('signin');
            }
        } catch (error: any) {
            Swal.fire({
                icon: 'error',
                title: 'Authentication Error',
                text: error.message,
                customClass: { popup: 'rounded-3xl' }
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-base-200 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Decorative background elements */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 blur-[100px] rounded-full animate-pulse"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-secondary/20 blur-[100px] rounded-full animate-pulse delay-700"></div>

            <div className="card w-full max-w-md bg-base-100/40 backdrop-blur-3xl border border-white/10 shadow-2xl relative z-10 overflow-hidden rounded-[2.5rem]">
                <div className="card-body p-8 sm:p-12">
                    <div className="flex flex-col items-center gap-4 mb-8">
                        <div className="w-20 h-20 bg-primary/10 rounded-[2rem] flex items-center justify-center text-primary shadow-inner">
                            <Sparkles size={40} className="animate-pulse" />
                        </div>
                        <div className="text-center">
                            <h1 className="text-3xl font-black tracking-tighter uppercase mb-1 drop-shadow-sm">
                                {mode === 'signin' ? 'Welcome Back' : mode === 'signup' ? 'Create Account' : 'Recover Access'}
                            </h1>
                            <p className="text-sm opacity-50 font-bold uppercase tracking-widest">
                                Smart Fridge AI Hub
                            </p>
                        </div>
                    </div>

                    <form onSubmit={handleAuth} className="space-y-6">
                        <div className="space-y-4">
                            <div className="relative group">
                                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-primary/40 group-focus-within:text-primary transition-colors">
                                    <Mail size={18} />
                                </div>
                                <input
                                    type="email"
                                    placeholder="Email Address"
                                    className="input input-bordered w-full pl-12 rounded-2xl h-14 bg-base-100/50 focus:bg-base-100 border-base-content/10 focus:border-primary transition-all font-bold"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                            </div>

                            {mode === 'signup' && (
                                <>
                                    <div className="relative group animate-in fade-in slide-in-from-top-2">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-primary/40 group-focus-within:text-primary transition-colors">
                                            <UserCircle size={18} />
                                        </div>
                                        <input
                                            type="text"
                                            placeholder="Username"
                                            className="input input-bordered w-full pl-12 rounded-2xl h-14 bg-base-100/50 focus:bg-base-100 border-base-content/10 focus:border-primary transition-all font-bold"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            required
                                        />
                                    </div>

                                    <div className="relative group animate-in fade-in slide-in-from-top-2">
                                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-primary/40 group-focus-within:text-primary transition-colors">
                                            <Phone size={18} />
                                        </div>
                                        <input
                                            type="tel"
                                            placeholder="Phone Number"
                                            className="input input-bordered w-full pl-12 rounded-2xl h-14 bg-base-100/50 focus:bg-base-100 border-base-content/10 focus:border-primary transition-all font-bold"
                                            value={phone}
                                            onChange={(e) => setPhone(e.target.value)}
                                            required
                                        />
                                    </div>
                                </>
                            )}

                            {mode !== 'forgot' && (
                                <div className="relative group">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-primary/40 group-focus-within:text-primary transition-colors">
                                        <Lock size={18} />
                                    </div>
                                    <input
                                        type="password"
                                        placeholder="Password"
                                        className="input input-bordered w-full pl-12 rounded-2xl h-14 bg-base-100/50 focus:bg-base-100 border-base-content/10 focus:border-primary transition-all font-bold"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                </div>
                            )}

                            {mode === 'signup' && (
                                <div className="relative group animate-in fade-in slide-in-from-top-2">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-primary/40 group-focus-within:text-primary transition-colors">
                                        <Lock size={18} />
                                    </div>
                                    <input
                                        type="password"
                                        placeholder="Confirm Password"
                                        className="input input-bordered w-full pl-12 rounded-2xl h-14 bg-base-100/50 focus:bg-base-100 border-base-content/10 focus:border-primary transition-all font-bold"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        required
                                    />
                                </div>
                            )}
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn btn-primary w-full h-14 rounded-2xl text-lg font-black uppercase tracking-widest shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all border-none"
                        >
                            {loading ? (
                                <span className="loading loading-spinner"></span>
                            ) : (
                                <div className="flex items-center gap-2">
                                    {mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Sign Up' : 'Send Link'}
                                    <ArrowRight size={20} />
                                </div>
                            )}
                        </button>
                    </form>

                    <div className="divider opacity-10 my-8 uppercase text-[10px] font-black tracking-widest">Or continue with</div>

                    <div className="space-y-4">
                        {mode === 'signin' ? (
                            <>
                                <button
                                    onClick={() => {
                                        setMode('signup');
                                        setPassword('');
                                        setConfirmPassword('');
                                        setUsername('');
                                        setPhone('');
                                    }}
                                    className="btn btn-ghost w-full rounded-2xl h-14 font-black uppercase tracking-tighter gap-2"
                                >
                                    <User size={18} /> Create New Account
                                </button>
                                <button
                                    onClick={() => {
                                        setMode('forgot');
                                        setPassword('');
                                        setConfirmPassword('');
                                    }}
                                    className="btn btn-link btn-xs w-full text-primary opacity-50 font-black uppercase tracking-widest no-underline hover:opacity-100"
                                >
                                    Forgot Password?
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => {
                                    setMode('signin');
                                    setPassword('');
                                    setConfirmPassword('');
                                    setUsername('');
                                    setPhone('');
                                }}
                                className="btn btn-ghost w-full rounded-2xl h-14 font-black uppercase tracking-tighter gap-2"
                            >
                                <ArrowRight size={18} className="rotate-180" /> Back to Sign In
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Auth;
