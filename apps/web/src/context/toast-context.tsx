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

export type ToastRequest = Omit<ToastProps, "onDismiss" | "actionDisabled"> & {
  /**
   * The action is an entry write, which the outbox keeps when there is no connection (ADR-0012
   * addendum). Every other action waits for the network.
   */
  readonly actionWorksOffline?: boolean;
};

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
  // Other writes have no queue: their actions wait for the network. Entry writes opt out.
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
            {...withoutOfflineFlag(shown.toast)}
            actionDisabled={!online && shown.toast.actionWorksOffline !== true}
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

function withoutOfflineFlag({ actionWorksOffline: _flag, ...toast }: ToastRequest) {
  return toast;
}

export function useToasts(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error("useToasts must be used inside a ToastProvider");
  return api;
}
