import React, { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";
import { ResponsiveContainer, YAxis, XAxis, Tooltip, AreaChart, Area, CartesianGrid } from 'recharts';
import { Thermometer, Droplets, Activity } from 'lucide-react';
import type { SensorData } from '../types';

interface FloatingSensorModalProps {
    modal: { active: boolean; type: 'temperature' | 'humidity' | null };
    history: SensorData[];
    theme: 'light' | 'dark';
}

const FloatingSensorModal: React.FC<FloatingSensorModalProps> = ({ modal, history, theme }) => {
    const { active, type } = modal;
    const modalContainer = useRef<HTMLDivElement>(null);

    const scaleAnimation = {
        initial: { scale: 0, x: "-50%", y: "-50%" },
        enter: {
            scale: 1,
            x: "-50%",
            y: "-50%",
            transition: { duration: 0.4, ease: [0.76, 0, 0.24, 1] as [number, number, number, number] },
        },
        closed: {
            scale: 0,
            x: "-50%",
            y: "-50%",
            transition: { duration: 0.4, ease: [0.32, 0, 0.67, 0] as [number, number, number, number] },
        },
    };

    useEffect(() => {
        if (!("ontouchstart" in window || navigator.maxTouchPoints)) {
            const xMoveContainer = gsap.quickTo(modalContainer.current, "left", {
                duration: 0.6,
                ease: "power3",
            });

            const yMoveContainer = gsap.quickTo(modalContainer.current, "top", {
                duration: 0.6,
                ease: "power3",
            });

            gsap.set(modalContainer.current, {
                left: window.innerWidth / 2,
                top: window.innerHeight / 2
            });

            const handleMouseMove = (e: MouseEvent) => {
                const { clientX, clientY } = e;
                const windowWidth = window.innerWidth;
                const windowHeight = window.innerHeight;
                const modalWidth = 400;
                const modalHeight = 280;

                // Clamp to viewport
                const clampedX = Math.max(modalWidth / 2 + 20, Math.min(clientX, windowWidth - modalWidth / 2 - 20));
                const clampedY = Math.max(modalHeight / 2 + 20, Math.min(clientY, windowHeight - modalHeight / 2 - 20));

                xMoveContainer(clampedX);
                yMoveContainer(clampedY);
            };

            window.addEventListener("mousemove", handleMouseMove);
            return () => window.removeEventListener("mousemove", handleMouseMove);
        }
    }, []);

    const isTemp = type === 'temperature';
    const color = isTemp ? "#641ae6" : "#00d7c0";
    const icon = isTemp ? <Thermometer size={20} className="text-primary" /> : <Droplets size={20} className="text-info" />;
    const label = isTemp ? "Temperature Analytics" : "Humidity Analytics";
    const unit = isTemp ? "°C" : "%";

    // Theme-aware colors
    const isDark = theme === 'dark';
    const borderColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
    const textColor = isDark ? "#ffffff" : "var(--color-base-content)";
    const subTextColor = isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.4)";
    const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)";
    const tooltipBg = isDark ? "#09090b" : "#ffffff";
    const tooltipBorder = isDark ? "#27272a" : "rgba(0,0,0,0.1)";

    return (
        <motion.div
            ref={modalContainer}
            variants={scaleAnimation}
            initial="initial"
            animate={active ? "enter" : "closed"}
            className="h-[300px] w-[400px] fixed top-1/2 left-1/2 overflow-hidden pointer-events-none z-[110] rounded-3xl bg-base-100/95 backdrop-blur-xl border border-base-content/10 shadow-2xl flex flex-col p-6"
            style={{ borderColor }}
        >
            <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-base-content/5 flex items-center justify-center">
                        {icon}
                    </div>
                    <div>
                        <h4 className="text-base-content font-black tracking-tight text-lg leading-tight">{label}</h4>
                        <p className="text-[10px] text-base-content/40 font-bold uppercase tracking-widest">Real-time History</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-[10px] text-base-content/40 font-black uppercase tracking-tighter">Current</p>
                    <p className="text-xl font-black text-base-content">{history.length > 0 ? history[history.length - 1][isTemp ? 'temperature' : 'humidity'] : '--'}{unit}</p>
                </div>
            </div>

            <div className="flex-1 w-full mt-4 pr-6 pb-2">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={history.slice(-30)} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={color} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                        <XAxis
                            dataKey="lastUpdated"
                            tick={{ fontSize: 10, fill: subTextColor, fontWeight: 'black' }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(time) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            minTickGap={30}
                            dy={10}
                            dx={-5}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fill: subTextColor, fontWeight: 'black' }}
                            axisLine={false}
                            tickLine={false}
                            domain={isTemp ? [0, 16] : [0, 100]}
                            ticks={isTemp ? [0, 4, 8, 12, 16, 20, 24, 28, 32] : [0, 25, 50, 75, 100]}
                            interval={0}
                            unit={unit}
                            dx={-5}
                        />
                        <Tooltip
                            contentStyle={{
                                background: tooltipBg,
                                border: `1px solid ${tooltipBorder}`,
                                borderRadius: '12px',
                                fontSize: '10px',
                                color: textColor
                            }}
                            itemStyle={{ color: textColor, fontWeight: 'bold' }}
                            labelStyle={{ display: 'none' }}
                        />
                        <Area
                            type="monotone"
                            dataKey={isTemp ? 'temperature' : 'humidity'}
                            stroke={color}
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorValue)"
                            isAnimationActive={true}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-4 flex justify-between items-center">
                <span className="text-[9px] font-bold text-base-content/20 uppercase tracking-widest">Temporal Accuracy: High</span>
                <div className="flex gap-1">
                    {[1, 2, 3].map(i => <div key={i} className="w-1 h-1 rounded-full bg-primary/40"></div>)}
                </div>
            </div>
        </motion.div>
    );
};

export default FloatingSensorModal;
