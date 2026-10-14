"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Toast = (message: string) => void;

const ToastContext = createContext<Toast>(() => {});

const DURATION_MS = 2600;

/**
 * Minimal toasts: one message at a time, bottom-centre, ink on paper. The
 * live region is always mounted so screen readers announce each message.
 * No animation under prefers-reduced-motion.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<Toast>((message) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ id: Date.now(), message });
    timer.current = setTimeout(() => setToast(null), DURATION_MS);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {toast && (
          <div
            key={toast.id}
            className="rounded-[10px] bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg animate-[toast-in_180ms_ease-out] motion-reduce:animate-none"
          >
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): Toast {
  return useContext(ToastContext);
}
