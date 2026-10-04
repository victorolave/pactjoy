import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { invitePreviewKey, myCircleKey, todayKey } from "../../shared/query-keys.ts";

/** The viewer's circle and season summary. Not persisted offline: a reload always refetches it. */
export function useMyCircle() {
  const api = usePactJoyApi();
  return useQuery({ queryKey: myCircleKey, queryFn: ({ signal }) => api.getMyCircle(signal) });
}

/**
 * What a code leads to. Runs only once the code has all 6 characters, never retries (an error is a
 * verdict, not a glitch) and is not kept: a preview must not outlive the screen that asked for it.
 */
export function useInvitePreview(code: string) {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: invitePreviewKey(code),
    queryFn: ({ signal }) => api.previewInvite(code, signal),
    enabled: code.length === 6,
    retry: false,
    gcTime: 0,
  });
}

/**
 * After create, join, leave or a rename: awaits fresh `today` and `myCircle` so a screen never
 * navigates onto the old state (WC-R10, TO-R12). Call it from the mutation's `onSettled`.
 */
export async function invalidateCircleState(client: QueryClient): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: todayKey }),
    client.invalidateQueries({ queryKey: myCircleKey }),
  ]);
}

/**
 * Creates the circle, then its first invite. If the invite fails the circle still exists, so the
 * mutation succeeds and the invite screen offers "Generar código" (design D4). Both caches are
 * refetched before it settles, so the screen it navigates to never sees the old `noCircle`.
 */
export function useCreateCircle() {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (cmd: { readonly name: string; readonly displayName: string }) => {
      const { circleId } = await api.createCircle(cmd);
      try {
        await api.generateInvite(circleId);
      } catch {
        // The circle exists; its screen offers to generate the code again.
      }
      return circleId;
    },
    onSettled: () => invalidateCircleState(client),
  });
}
