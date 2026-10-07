import type { FormEventHandler, ReactNode, Ref } from "react";
import styles from "./FlowScreen.module.css";
import { IconButton } from "./IconButton.tsx";
import type { IconName } from "./icon/Icon.tsx";

export interface FlowScreenProps {
  readonly title: string;
  /** Context or subtitle above the heading (e.g. circle name or season progress). */
  readonly meta?: ReactNode;
  /** The primary action, pinned below the scrolling content (design 3, 4). Settings has none. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  /** Makes the screen a form: pressing Enter in a field submits it. */
  readonly onSubmit?: FormEventHandler<HTMLFormElement>;
  /** Shows a "Volver" chevron above the title (design 6a); leave it out on a first step. */
  readonly onBack?: () => void;
  /** The back button's accessible name; "Volver" by default. */
  readonly backLabel?: string;
  readonly backIcon?: IconName;
  /** Opt-in programmatic heading focus for multi-step flows. */
  readonly headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * A full-screen step outside the tab bar (onboarding, create, join): a title, content that
 * scrolls, and (when it has one) a pinned action. It is a `form` when it has `onSubmit`.
 */
export function FlowScreen({
  title,
  meta,
  footer,
  children,
  onSubmit,
  onBack,
  backLabel = "Volver",
  backIcon = "chevron-left",
  headingRef,
}: FlowScreenProps) {
  const body = (
    <>
      {onBack !== undefined && (
        <div className={styles.back}>
          <IconButton icon={backIcon} label={backLabel} onClick={onBack} />
        </div>
      )}
      <div className={styles.content}>
        {meta !== undefined ? (
          <div>
            <div className={styles.meta}>{meta}</div>
            <h1
              ref={headingRef}
              tabIndex={headingRef ? -1 : undefined}
              className={styles.titleWithMeta}
            >
              {title}
            </h1>
          </div>
        ) : (
          <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={styles.title}>
            {title}
          </h1>
        )}
        {children}
      </div>
      {footer !== undefined && <div className={styles.footer}>{footer}</div>}
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
