import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { invitePreviewKey, myCircleKey, todayKey } from "../../shared/query-keys.ts";

/** How often a solo circle looks for a second member: there is no Realtime (D11). */
export const SOLO_POLL_MS = 30_000;

/**
 * The viewer's circle and season summary. Not persisted offline: a reload always refetches it.
 * With `pollWhileSolo`, a circle with a single member is refetched every 30 s (and on focus, which
 * the client does by default) so the waiting room notices a join; only the Circle tab asks for it.
 */
export function useMyCircle({ pollWhileSolo = false }: { readonly pollWhileSolo?: boolean } = {}) {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: myCircleKey,
    queryFn: ({ signal }) => api.getMyCircle(signal),
    // Poll only while the tab is visible: a hidden PWA must not wake the radio (iOS battery).
    refetchIntervalInBackground: false,
    refetchInterval: pollWhileSolo
      ? (query) => (query.state.data?.circle?.members.length === 1 ? SOLO_POLL_MS : false)
      : false,
  });
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

/** Joins with a code. Today and the circle are refetched before it settles, like create (WC-R10). */
export function useJoinCircle() {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (cmd: { readonly inviteCode: string; readonly displayName: string }) =>
      api.joinCircle(cmd),
    onSettled: () => invalidateCircleState(client),
  });
}

/** A new invite code (it replaces the old one). Only `myCircle` changes, so only it is refetched. */
export function useGenerateInvite(circleId: string) {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateInvite(circleId),
    onSettled: () => client.invalidateQueries({ queryKey: myCircleKey }),
  });
}

/** Renames the circle; Today shows its name too, so both caches are refetched. */
export function useRenameCircle(circleId: string) {
  const api = usePactJoyApi();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.renameCircle(circleId, name),
    onSettled: () => invalidateCircleState(client),
  });
}
