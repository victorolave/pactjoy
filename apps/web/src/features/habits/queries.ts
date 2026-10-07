import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePactJoyApi } from "../../context/api-context.tsx";
import type { PreviewScoringCommand } from "../../ports/pactjoy-api.ts";
import type { CommitmentDto, HabitDto } from "../../ports/wire.ts";
import {
  habitsKey,
  myCircleKey,
  scoringPreviewKey,
  seasonKey,
  todayKey,
} from "../../shared/query-keys.ts";
import type { WizardMeasure } from "./wizard/measure-defaults.ts";
import { habitPatch, previewValues, type WizardDraft, wireMeasure } from "./wizard/wizard-model.ts";

/** Debounce the entire command and retain rows together with the unit that produced them. */
export function useScoringPreview(measure: WizardMeasure) {
  const api = usePactJoyApi();
  const input = useMemo(
    () => ({ measure: wireMeasure(measure), values: previewValues(measure) }),
    [measure],
  );
  const [command, setCommand] = useState<PreviewScoringCommand>(() => input);
  useEffect(() => {
    if (input === command) return;
    const timer = setTimeout(() => setCommand(input), 250);
    return () => clearTimeout(timer);
  }, [input, command]);
  return useQuery({
    queryKey: scoringPreviewKey(JSON.stringify(command)),
    queryFn: async ({ signal }) => {
      return { result: await api.previewScoring(command, signal), measure: command.measure };
    },
    enabled: command.values.length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useWizardData(seasonId: string | undefined) {
  const api = usePactJoyApi();
  const habits = useQuery({ queryKey: habitsKey, queryFn: ({ signal }) => api.listHabits(signal) });
  const circle = useQuery({
    queryKey: myCircleKey,
    queryFn: ({ signal }) => api.getMyCircle(signal),
  });
  const season = useQuery({
    queryKey: seasonKey(seasonId ?? ""),
    enabled: Boolean(seasonId),
    queryFn: ({ signal }) => {
      if (!seasonId) throw new Error("Season id required");
      return api.getSeason(seasonId, signal);
    },
  });
  return { habits, circle, season };
}

type DetailCommitment = Extract<CommitmentDto, { kind: "detail" }>;

/** A save is sequential. Retain successful habit writes when the season write must be retried. */
export function useSaveWizard(seasonId: string, originalHabit?: HabitDto) {
  const api = usePactJoyApi();
  const client = useQueryClient();
  const savedHabit = useRef(originalHabit);
  const cacheHabit = (habit: HabitDto) => {
    savedHabit.current = habit;
    client.setQueryData<readonly HabitDto[]>(habitsKey, (previous = []) =>
      previous.some((item) => item.id === habit.id)
        ? previous.map((item) => (item.id === habit.id ? habit : item))
        : [habit, ...previous],
    );
  };
  return useMutation({
    mutationFn: async ({
      draft,
      commitment,
    }: {
      readonly draft: WizardDraft;
      readonly commitment?: DetailCommitment | undefined;
    }) => {
      const current = savedHabit.current;
      const refreshed = client
        .getQueryData<readonly HabitDto[]>(habitsKey)
        ?.find((h) => h.id === current?.id);
      let habit = refreshed && current && refreshed.version > current.version ? refreshed : current;
      if (habit === undefined) {
        habit = await api.createHabit({
          name: draft.name.trim(),
          why: draft.why.trim() || null,
          category: draft.category,
          icon: draft.icon,
        });
        cacheHabit(habit);
      } else {
        const patch = habitPatch(habit, draft);
        if (patch !== null) {
          habit = await api.updateHabit(habit.id, patch);
          cacheHabit(habit);
        }
      }
      const input = {
        weightPercent: commitment?.weightPercent ?? 5,
        privacy: draft.privacy,
        measure: wireMeasure(draft.measure),
      };
      return commitment === undefined
        ? api.addCommitment(seasonId, { ...input, habitId: habit.id })
        : api.editCommitment(seasonId, commitment.id, input);
    },
    onSuccess: (season) => client.setQueryData(seasonKey(seasonId), season),
    onSettled: async () => {
      await Promise.all(
        [seasonKey(seasonId), habitsKey, todayKey, myCircleKey].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
