import { AnimatePresence, motion, useDragControls, useMotionValueEvent, useReducedMotion, useVelocity, type MotionValue, type PanInfo } from 'framer-motion';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { HABIT_ICONS, UI_ICONS, type UIIcon } from '../lib/icons';
import { useStore } from '../store';

// Motion tokens. Durations stay in the 180–350 ms band, sheets around 300–450 ms.
export const springs = {
  snappy: { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 },
  gentle: { type: 'spring', stiffness: 320, damping: 34 },
  sheet: { type: 'spring', stiffness: 340, damping: 36, mass: 1 },
} as const;

export function Icon({ name, habit, size = 22, label }: { name?: UIIcon; habit?: string; size?: number; label?: string }) {
  const d = habit ? HABIT_ICONS[habit] ?? HABIT_ICONS.circle : UI_ICONS[name!];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={d} />
    </svg>
  );
}

export function useReduce(): boolean {
  const { settings } = useStore();
  const system = useReducedMotion();
  return settings.motion === 'reduce' || (settings.motion === 'system' && !!system);
}

const BLUR_CAP = 14; // px — keeps the filter cheap
/**
 * Horizontal, velocity-driven motion blur for a moving layer. Returns an SVG filter element to render
 * and a ref-style setter applied to the moving element. Blur is 0 (filter removed) whenever velocity settles.
 */
export function useSwipeBlur(x: MotionValue<number>) {
  const reduce = useReduce();
  const id = 'blur' + useId().replace(/:/g, '');
  const vx = useVelocity(x);
  const gauss = useRef<SVGFEGaussianBlurElement>(null);
  const target = useRef<HTMLElement | null>(null);
  const apply = (v: number) => {
    const b = reduce ? 0 : Math.min(BLUR_CAP, Math.max(0, (Math.abs(v) - 250) / 220));
    gauss.current?.setAttribute('stdDeviation', `${b.toFixed(2)} 0`);
    if (target.current) target.current.style.filter = b > 0.15 ? `url(#${id})` : '';
  };
  useMotionValueEvent(vx, 'change', apply);
  // Safety: never leave content blurred once the motion value stops changing.
  useMotionValueEvent(x, 'animationComplete', () => apply(0));
  const filter = (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id={id} x="-10%" y="0" width="120%" height="100%" colorInterpolationFilters="sRGB">
        <feGaussianBlur ref={gauss} stdDeviation="0 0" />
      </filter>
    </svg>
  );
  return { filter, ref: (el: HTMLElement | null) => void (target.current = el) };
}

export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const controls = useDragControls();
  const reduce = useReduce();
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Callers often pass an inline `onClose`, which is a new function on every render. Reading it through a ref
  // keeps the effect below tied to `open` only; otherwise every keystroke in a form re-ran it and moved focus
  // to the panel.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Runs once per open/close: initial focus on the panel, Escape + focus trap, focus restored on close.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost sheet reacts (a confirmation can open above another sheet).
      const sheets = document.querySelectorAll('.sheet');
      if (sheets[sheets.length - 1] !== panel.current) return;
      if (e.key === 'Escape') onCloseRef.current();
      if (e.key === 'Tab' && panel.current) trapFocus(e, panel.current);
    };
    document.addEventListener('keydown', onKey);
    const raf = requestAnimationFrame(() => {
      // Don't steal focus from a field the user already moved into.
      if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  const onDragEnd = (_: unknown, i: PanInfo) => {
    if (i.offset.y > 120 || i.velocity.y > 600) onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="sheet-root">
          <motion.div className="backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
          <motion.div
            ref={panel}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%', transition: { duration: 0.28, ease: [0.4, 0, 1, 1] } }}
            transition={reduce ? { duration: 0.15 } : springs.sheet}
            drag={reduce ? false : 'y'}
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.9 }}
            onDragEnd={onDragEnd}
          >
            <div className="sheet-head" onPointerDown={(e) => controls.start(e)}>
              <div className="grabber" aria-hidden="true" />
              <div className="sheet-title-row">
                <h2 id={titleId}>{title}</h2>
                <button className="icon-btn" onClick={onClose} aria-label="Schließen">
                  <Icon name="close" size={20} />
                </button>
              </div>
            </div>
            <div className="sheet-body">{children}</div>
            {footer && <div className="sheet-foot">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function trapFocus(e: KeyboardEvent, root: HTMLElement) {
  const f = [...root.querySelectorAll<HTMLElement>('button:not([disabled]):not([hidden]),input:not([disabled]),textarea,select,[tabindex="0"]')];
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function ToastHost() {
  const { toast, dismissToast } = useStore();
  const reduce = useReduce();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, toast.undo ? 5000 : 2600);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);
  return (
    <div className="toast-wrap" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {toast && (
          <motion.div
            key={toast.id}
            className="toast"
            role="status"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
            transition={springs.snappy}
          >
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                className="toast-undo"
                onClick={() => {
                  toast.undo!();
                  dismissToast();
                }}
              >
                Rückgängig
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Confirm({ open, title, text, action, onConfirm, onClose }: { open: boolean; title: string; text: string; action: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button
            className="btn danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {action}
          </button>
        </>
      }
    >
      <p className="muted">{text}</p>
    </Sheet>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const n = options.length;
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {/* One CSS-transformed pill (no layoutId: shared layout inside exiting sheets blocked AnimatePresence removal). */}
      <span className="seg-pill" aria-hidden="true" style={{ width: `calc((100% - 6px - ${(n - 1) * 2}px) / ${n})`, transform: `translateX(calc(${i} * (100% + 2px)))` }} />
      {options.map((o) => (
        <button type="button" key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          <span className="seg-label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
