import { type ChangeEvent, type FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useClock } from "../../../context/clock-context.tsx";
import { ApiError } from "../../../ports/api-error.ts";
import { addDays } from "../../../shared/date.ts";
import { weekdayDay } from "../../../shared/format.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { FlowScreen } from "../../../ui/FlowScreen.tsx";
import { InlineMessage } from "../../../ui/InlineMessage.tsx";
import { Icon } from "../../../ui/icon/Icon.tsx";
import { SegmentedControl, type SegmentOption } from "../../../ui/SegmentedControl.tsx";
import { Tag } from "../../../ui/Tag.tsx";
import { useCreateSeason, useCurrentCircle } from "../queries.ts";
import styles from "./CreateSeasonScreen.module.css";
import {
  DEFAULT_SEASON_LENGTH,
  type ReviewCadenceWeeks,
  reviewCadenceForLength,
  SEASON_LENGTH_OPTIONS,
  type SeasonLengthWeeks,
  seasonCadenceMessage,
  seasonEndMessage,
  todayIso,
} from "./season-model.ts";

const CADENCE_OPTIONS: readonly SegmentOption<string>[] = [
  { value: "1", label: "Cada semana" },
  { value: "2", label: "Cada 2" },
  { value: "3", label: "Cada 3" },
];

/**
 * Design 8: Crear temporada.
 * Allows any circle member to start a season: choose length (4/6/8/12), start date
 * (today..+30, default tomorrow), and review cadence (default per length).
 */
export function CreateSeasonScreen() {
  const navigate = useNavigate();
  const clock = useClock();
  const circleQuery = useCurrentCircle();
  const createSeason = useCreateSeason();

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const todayDate = todayIso(clock.nowMs(), timezone);
  const tomorrowDate = addDays(todayDate, 1);
  const maxDate = addDays(todayDate, 30);

  const [lengthWeeks, setLengthWeeks] = useState<SeasonLengthWeeks>(DEFAULT_SEASON_LENGTH);
  const [startDate, setStartDate] = useState(tomorrowDate);
  const [customDate, setCustomDate] = useState<string | null>(null);
  const [reviewCadence, setReviewCadence] = useState<ReviewCadenceWeeks>(
    reviewCadenceForLength(DEFAULT_SEASON_LENGTH),
  );
  const [failure, setFailure] = useState<string | undefined>();
  const dateInputRef = useRef<HTMLInputElement>(null);

  const circle = circleQuery.data?.circle;
  const circleName = circle?.name ?? "Tu círculo";

  const onOpenDatePicker = () => {
    try {
      dateInputRef.current?.showPicker?.();
    } catch {
      dateInputRef.current?.focus();
      dateInputRef.current?.click();
    }
  };

  const onCustomDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const val = event.target.value;
    if (val) {
      setCustomDate(val);
      setStartDate(val);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (createSeason.isPending) return;
    setFailure(undefined);

    if (!circle) return;

    const existingSeason = circleQuery.data?.season;
    if (existingSeason) {
      navigate(`/season/${existingSeason.id}/habits`);
      return;
    }

    try {
      const season = await createSeason.mutateAsync({
        circleId: circle.id,
        input: {
          timezone,
          startDate,
          lengthWeeks,
          reviewCadenceWeeks: reviewCadence,
        },
      });
      navigate(`/season/${season.id}/habits`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "SeasonInProgress") {
        if (circleQuery.data?.season?.id) {
          navigate(`/season/${circleQuery.data.season.id}/habits`);
          return;
        }
        setFailure("Ese círculo ya tiene una temporada en preparación o activa.");
        return;
      }
      setFailure("No pudimos crear la temporada. Inténtalo de nuevo.");
    }
  };

  return (
    <FlowScreen
      title="Nueva temporada"
      meta={circleName}
      onSubmit={submit}
      onBack={() => navigate(-1)}
      footer={
        <Button type="submit" block disabled={createSeason.isPending}>
          Continuar
        </Button>
      }
    >
      <div className={styles.section}>
        <div className={styles.label}>Duración</div>
        <div className={styles.durationGrid} role="radiogroup" aria-label="Duración">
          {SEASON_LENGTH_OPTIONS.map((weeks) => {
            const selected = lengthWeeks === weeks;
            return (
              // biome-ignore lint/a11y/useSemanticElements: the design-system control is button-based by design
              <button
                key={weeks}
                type="button"
                role="radio"
                aria-checked={selected}
                className={styles.durationOption}
                onClick={() => {
                  setLengthWeeks(weeks);
                  setReviewCadence(reviewCadenceForLength(weeks));
                }}
              >
                {weeks}
                <span className={styles.durationMeta}>semanas</span>
              </button>
            );
          })}
        </div>
        <div className={styles.recommendedRow}>
          <Badge tone="pending">Recomendada</Badge>8 semanas: tiempo para notar el cambio sin
          hacerse eterna.
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.label}>Empieza</div>
        <div className={styles.dateOptions}>
          <Tag selected={startDate === todayDate} onClick={() => setStartDate(todayDate)}>
            Hoy
          </Tag>
          <Tag selected={startDate === tomorrowDate} onClick={() => setStartDate(tomorrowDate)}>
            Mañana
          </Tag>
          {customDate !== null && customDate !== todayDate && customDate !== tomorrowDate && (
            <Tag selected={startDate === customDate} onClick={() => setStartDate(customDate)}>
              {weekdayDay(customDate)}
            </Tag>
          )}
          <div className={styles.datePickerWrapper}>
            <Tag onClick={onOpenDatePicker}>
              <Icon name="calendar-days" size="sm" />
              Otra fecha
            </Tag>
            <input
              ref={dateInputRef}
              type="date"
              aria-label="Elegir otra fecha"
              min={todayDate}
              max={maxDate}
              className={styles.hiddenDateInput}
              onChange={onCustomDateChange}
            />
          </div>
        </div>
        <div className={styles.hint}>{seasonEndMessage(startDate, lengthWeeks)}</div>
      </div>

      <div className={styles.section}>
        <div className={styles.label}>Revisión privada</div>
        <SegmentedControl
          options={CADENCE_OPTIONS}
          value={String(reviewCadence)}
          onChange={(val) => setReviewCadence(Number(val) as ReviewCadenceWeeks)}
          label="Cadencia de revisión"
        />
        <div className={styles.hint}>{seasonCadenceMessage(lengthWeeks, reviewCadence)}</div>
      </div>

      {failure !== undefined && <InlineMessage tone="error" title={failure} />}
    </FlowScreen>
  );
}
