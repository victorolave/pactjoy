import { useCallback } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

const PARAM = "entry";

export interface EntrySheetRoute {
  /** The commitment whose sheet is open, from the URL. */
  readonly commitmentId: string | null;
  open(commitmentId: string): void;
  close(): void;
}

/**
 * The sheet lives in the URL (`?entry=<commitmentId>`), so the browser's Back button closes it and a
 * link reopens it. Closing after the app opened it goes back one step; closing a sheet that was
 * the landing page only drops the parameter, so the user never leaves the app.
 */
export function useEntrySheet(): EntrySheetRoute {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { key } = useLocation();

  const open = useCallback(
    (commitmentId: string) =>
      setParams(
        (current) => new URLSearchParams({ ...Object.fromEntries(current), [PARAM]: commitmentId }),
      ),
    [setParams],
  );
  const close = useCallback(() => {
    if (key !== "default") {
      navigate(-1);
      return;
    }
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(PARAM);
        return next;
      },
      { replace: true },
    );
  }, [key, navigate, setParams]);

  return { commitmentId: params.get(PARAM), open, close };
}
