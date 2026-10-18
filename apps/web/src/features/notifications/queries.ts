import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePactJoyApi } from "../../context/api-context.tsx";
import type { CommitmentReminderDto, ReminderSettingCommand } from "../../ports/wire.ts";
import { reminderKey } from "../../shared/query-keys.ts";

/** The owner's reminder for one commitment, or its default (D2). */
export function useCommitmentReminder(seasonId: string, commitmentId: string) {
  const api = usePactJoyApi();
  return useQuery({
    queryKey: reminderKey(seasonId, commitmentId),
    queryFn: ({ signal }) => api.getCommitmentReminder(seasonId, commitmentId, signal),
  });
}

/** Saves it, showing the change at once and putting the stored one back if the save fails. */
export function useSaveCommitmentReminder(seasonId: string, commitmentId: string) {
  const api = usePactJoyApi();
  const client = useQueryClient();
  const key = reminderKey(seasonId, commitmentId);
  return useMutation({
    mutationFn: (setting: ReminderSettingCommand) =>
      api.setCommitmentReminder(seasonId, commitmentId, setting),
    onMutate: (setting) => {
      const previous = client.getQueryData<CommitmentReminderDto>(key);
      if (previous) client.setQueryData<CommitmentReminderDto>(key, { ...previous, ...setting });
      return { previous };
    },
    onError: (_error, _setting, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
    },
    onSuccess: (saved) => client.setQueryData(key, saved),
  });
}
