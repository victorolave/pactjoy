import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Toast, type ToastProps } from "../ui/Toast.tsx";
import { useOptionalOnline } from "./connectivity-context.tsx";
import styles from "./toast-context.module.css";

export type ToastRequest = Omit<ToastProps, "onDismiss">;

export interface ToastApi {
  /** Shows one toast at a time: a new one replaces the current one and restarts its countdown. */
  show(toast: ToastRequest): void;
  dismiss(): void;
}

const ToastContext = createContext<ToastApi | null>(null);

interface Shown {
  readonly id: number;
  readonly toast: ToastRequest;
}

export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  // No write queue (P1): Deshacer and Reintentar are writes, so they wait for the network.
  const online = useOptionalOnline();
  const nextId = useRef(0);

  const dismiss = useCallback(() => setShown(null), []);
  const show = useCallback((toast: ToastRequest) => {
    nextId.current += 1;
    setShown({ id: nextId.current, toast });
  }, []);
  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Always mounted: a live region announces changes to its content, not its own arrival. */}
      <div className={styles.host} aria-live="polite" aria-atomic="true">
        {shown !== null && (
          <Toast
            key={shown.id}
            {...shown.toast}
            actionDisabled={!online}
            onAction={() => {
              setShown(null);
              shown.toast.onAction?.();
            }}
            onDismiss={dismiss}
          />
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error("useToasts must be used inside a ToastProvider");
  return api;
}
