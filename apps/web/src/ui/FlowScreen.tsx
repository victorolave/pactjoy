import type { FormEventHandler, ReactNode } from "react";
import styles from "./FlowScreen.module.css";

export interface FlowScreenProps {
  readonly title: string;
  /** The primary action, pinned below the scrolling content (design 3, 4). */
  readonly footer: ReactNode;
  readonly children: ReactNode;
  /** Makes the screen a form: pressing Enter in a field submits it. */
  readonly onSubmit?: FormEventHandler<HTMLFormElement>;
}

/**
 * A full-screen step outside the tab bar (onboarding, create, join): a title, content that
 * scrolls, and one pinned action. It is a `form` when it has `onSubmit`.
 */
export function FlowScreen({ title, footer, children, onSubmit }: FlowScreenProps) {
  const body = (
    <>
      <div className={styles.content}>
        <h1 className={styles.title}>{title}</h1>
        {children}
      </div>
      <div className={styles.footer}>{footer}</div>
    </>
  );
  return (
    <main className={styles.page}>
      {onSubmit === undefined ? (
        <div className={styles.frame}>{body}</div>
      ) : (
        <form className={styles.frame} onSubmit={onSubmit} noValidate>
          {body}
        </form>
      )}
    </main>
  );
}
