import { useState, useCallback } from 'react';

export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'success';
  duration?: number;
}

type ToastAction = Toast & { dismiss: () => void };

let toastCount = 0;
const listeners: Array<(toast: Toast) => void> = [];

function genId() {
  toastCount = (toastCount + 1) % Number.MAX_SAFE_INTEGER;
  return toastCount.toString();
}

export function toast(props: Omit<Toast, 'id'>) {
  const id = genId();
  const t: Toast = { ...props, id };
  listeners.forEach((listener) => listener(t));
  return id;
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastAction[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (t: Toast) => {
      const action: ToastAction = {
        ...t,
        dismiss: () => dismiss(t.id),
      };
      setToasts((prev) => [...prev, action]);

      const duration = t.duration ?? 5000;
      if (duration > 0) {
        setTimeout(() => dismiss(t.id), duration);
      }
    },
    [dismiss],
  );

  // Register listener
  useState(() => {
    listeners.push(addToast);
    return () => {
      const idx = listeners.indexOf(addToast);
      if (idx > -1) listeners.splice(idx, 1);
    };
  });

  return { toasts, toast, dismiss };
}
