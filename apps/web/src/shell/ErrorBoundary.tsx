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
  /**
   * Where Reintentar goes once the cache is clean: the app's start, never a reload of the URL that
   * crashed (it would crash again). Injected so tests do not navigate.
   */
  readonly restart?: () => void;
  readonly children: ReactNode;
}

interface State {
  readonly failed: boolean;
}

/**
 * The last line of defence: an error while rendering shows this screen instead of a blank page.
 * Reintentar drops everything cached on this device and goes back to the start, so a saved copy that no longer
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
      // Blocked storage: starting over is still the best we can do.
    }
    (this.props.restart ?? (() => window.location.assign("/")))();
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
          Al reintentar borramos lo guardado en este teléfono y volvemos al inicio.
        </p>
        <Button leadingIcon="rotate-cw" onClick={() => void this.retry()}>
          Reintentar
        </Button>
      </div>
    );
  }
}
