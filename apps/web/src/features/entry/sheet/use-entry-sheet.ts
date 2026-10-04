import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

const COMMITMENT = "entry";
const ENTRY = "id";
const DAY = "day";
const YESTERDAY = "ayer";

export interface EntrySheetRoute {
  /** The commitment whose sheet is open, from the URL. */
  readonly commitmentId: string | null;
  /** The entry being edited, when the URL names one. */
  readonly entryId: string | null;
  /** Whether the sheet was opened for yesterday (`&day=ayer`, from the De ayer card). */
  readonly forYesterday: boolean;
  /** Opens the sheet for a commitment: a new entry, or the named entry to edit, or yesterday's. */
  open(commitmentId: string, entryId?: string, options?: { readonly yesterday?: boolean }): void;
  /** Switches the sheet to another entry of the same commitment, without a new history step. */
  select(entryId: string): void;
  close(): void;
}

/**
 * The sheet lives in the URL (`?entry=<commitmentId>[&id=<entryId>]`), so the browser's Back button
 * closes it and a link reopens it. Closing after the app opened it goes back one step; closing a
 * sheet that was the landing page only drops the parameters, so the user never leaves the app.
 */
export function useEntrySheet(): EntrySheetRoute {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { key } = useLocation();

  const open = useCallback(
    (commitmentId: string, entryId?: string, options?: { readonly yesterday?: boolean }) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set(COMMITMENT, commitmentId);
        if (entryId === undefined) next.delete(ENTRY);
        else next.set(ENTRY, entryId);
        if (options?.yesterday === true) next.set(DAY, YESTERDAY);
        else next.delete(DAY);
        return next;
      }),
    [setParams],
  );
  const select = useCallback(
    (entryId: string) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set(ENTRY, entryId);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  // Closing goes back one history step: twice in a tick (Escape and a button) must not go back two.
  // The guard re-arms whenever the location changes.
  const closing = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-arm on every location change
  useEffect(() => {
    closing.current = false;
  }, [key, params]);
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    if (key !== "default") {
      navigate(-1);
      return;
    }
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(COMMITMENT);
        next.delete(ENTRY);
        next.delete(DAY);
        return next;
      },
      { replace: true },
    );
  }, [key, navigate, setParams]);

  return {
    commitmentId: params.get(COMMITMENT),
    entryId: params.get(ENTRY),
    forYesterday: params.get(DAY) === YESTERDAY,
    open,
    select,
    close,
  };
}
