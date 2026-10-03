import type { QueryClient } from "@tanstack/react-query";
import type { Persister } from "@tanstack/react-query-persist-client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/icon/Icon.tsx";
import styles from "./ErrorBoundary.module.css";

export interface ErrorBoundaryProps {
  /** Where the saved Today lives: Reintentar erases it, since a bad copy is a likely cause. */
  readonly persister: Persister;
  readonly queryClient: QueryClient;
  /** Reloads the page; injected so tests do not navigate. */
  readonly reload?: () => void;
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

/**
 * The last line of defence: an error while rendering shows this screen instead of a blank page.
 * Reintentar drops everything cached on this device and reloads, so a saved copy that no longer
 * matches the code can never keep the app down.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("render error", error, info.componentStack);
  }

  private retry = async (): Promise<void> => {
    this.props.queryClient.clear();
    try {
      await this.props.persister.removeClient();
    } catch {
      // Blocked storage: reloading is still the best we can do.
    }
    (this.props.reload ?? (() => window.location.reload()))();
  };

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.screen} role="alert">
        <span className={styles.glyph}>
          <Icon name="circle-alert" size="lg" />
        </span>
        <h1 className={styles.title}>Algo salió mal</h1>
        <p className={styles.lead}>
          Borramos lo guardado en este teléfono para empezar de cero. Inténtalo de nuevo.
        </p>
        <Button leadingIcon="rotate-cw" onClick={() => void this.retry()}>
          Reintentar
        </Button>
      </div>
    );
  }
}
