import { useEffect, useRef } from "react";
import { animate, motion, useInView, type Variants } from "motion/react";

/** Number that counts up when it scrolls into view. Respects reduced-motion via MotionConfig. */
export function CountUp({ value, format = (n: number) => Math.round(n).toLocaleString("en-US") }: {
  value: number; format?: (n: number) => string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useInView(ref, { once: true });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!visible) { node.textContent = format(0); return; }
    const controls = animate(0, value, {
      duration: 1.1, ease: [0.22, 1, 0.36, 1], onUpdate: latest => { node.textContent = format(latest); },
    });
    return () => controls.stop();
  }, [value, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className="figure">{format(value)}</span>;
}

export const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } };
export const rise: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div className={className} variants={container} initial="hidden" animate="show">{children}</motion.div>;
}
export function Rise({ children, className }: { children: React.ReactNode; className?: string }) {
  return <motion.div className={className} variants={rise}>{children}</motion.div>;
}

export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true">
    {Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: `${92 - i * 14}%` }} />)}
  </div>;
}
