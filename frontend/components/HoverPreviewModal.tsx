import { useRef, useEffect } from "react";
import { motion } from "framer-motion";
import gsap from "gsap";

interface HoverPreviewItem {
    name: string;
    thumbnail: string;
    short_name?: string;
}

interface HoverPreviewModalProps {
    modal: { active: boolean; index: number };
    items: HoverPreviewItem[];
}

const HoverPreviewModal: React.FC<HoverPreviewModalProps> = ({ modal, items }) => {
    const { active, index } = modal;

    // Framer motion for modal entering and exiting animation
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

    const modalContainer = useRef<HTMLDivElement>(null);
    // GSAP for moving the Modal
    useEffect(() => {
        if (!("ontouchstart" in window || navigator.maxTouchPoints)) {
            const xMoveContainer = gsap.quickTo(modalContainer.current, "left", {
                duration: 0.8,
                ease: "power3",
            });

            const yMoveContainer = gsap.quickTo(modalContainer.current, "top", {
                duration: 0.8,
                ease: "power3",
            });

            // Initialize to screen center
            gsap.set(modalContainer.current, {
                left: window.innerWidth / 2,
                top: window.innerHeight / 2
            });

            const handleMouseMove = (e: MouseEvent) => {
                const { clientX, clientY } = e;
                const windowWidth = window.innerWidth;
                const windowHeight = window.innerHeight;
                const modalWidth = 450;
                const modalHeight = 350;

                // Clamp to viewport
                const clampedX = Math.max(modalWidth / 2 + 10, Math.min(clientX, windowWidth - modalWidth / 2 - 10));
                const clampedY = Math.max(modalHeight / 2 + 10, Math.min(clientY, windowHeight - modalHeight / 2 - 10));

                xMoveContainer(clampedX);
                yMoveContainer(clampedY);
            };

            window.addEventListener("mousemove", handleMouseMove);
            return () => window.removeEventListener("mousemove", handleMouseMove);
        }
    }, []);

    return (
        <>
            {/* modal container - Now follows cursor again with clamping */}
            <motion.div
                ref={modalContainer}
                variants={scaleAnimation}
                initial="initial"
                animate={active ? "enter" : "closed"}
                className="h-[350px] w-[450px] fixed top-1/2 left-1/2 overflow-hidden pointer-events-none flex items-center justify-center z-[100] rounded-3xl shadow-2xl border-4 border-white/10"
            >
                {/* modal slider */}
                <div
                    style={{ top: index * -100 + "%" }}
                    className="h-full w-full absolute transition-all duration-500 ease-in-out"
                >
                    {/* modal */}
                    {items.map((item, id) => {
                        const { name, thumbnail, short_name } = item;
                        return (
                            <div
                                className="h-full w-full flex items-center justify-center bg-zinc-950"
                                key={`modal_${id}`}
                            >
                                <img
                                    src={thumbnail}
                                    alt={short_name ?? name}
                                    className="w-full h-full object-cover opacity-80"
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent"></div>
                                <div className="absolute bottom-6 left-8">
                                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-primary mb-1">Previewing</p>
                                    <h4 className="text-2xl font-black text-white tracking-tighter">{name}</h4>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </motion.div>
        </>
    );
};

export default HoverPreviewModal;
