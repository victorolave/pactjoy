import { useNavigate } from "react-router";
import type { MyCircle } from "../../../ports/pactjoy-api.ts";
import { Button } from "../../../ui/Button.tsx";

/** The same season entry point for every member, whether alone or with others. */
export function SeasonAction({ season }: { readonly season: MyCircle["season"] }) {
  const navigate = useNavigate();
  // An ended season the circle may leave (everyone closed, or a week past its last day) opens the
  // next one; the season is finalized by that very write, never by this read.
  const opensNext = season === null || season.nextSeasonOpen;
  const canPrepare = opensNext || season.phase === "pactOpen";
  // The pact route applies pactFlow, including the onward redirect to Today.
  const destination = opensNext
    ? "/season/new"
    : `/season/${season.id}/${canPrepare ? "habits" : "pact"}`;
  return (
    <Button block onClick={() => navigate(destination)}>
      {canPrepare ? "Preparar la temporada" : "Ver el pacto"}
    </Button>
  );
}
