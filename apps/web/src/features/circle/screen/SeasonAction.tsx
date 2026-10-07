import { useNavigate } from "react-router";
import type { MyCircle } from "../../../ports/pactjoy-api.ts";
import { Button } from "../../../ui/Button.tsx";

/** The same season entry point for every member, whether alone or with others. */
export function SeasonAction({ season }: { readonly season: MyCircle["season"] }) {
  const navigate = useNavigate();
  const canPrepare = season === null || season.phase === "pactOpen";
  // The pact route applies pactFlow, including the onward redirect to Today.
  const destination =
    season === null ? "/season/new" : `/season/${season.id}/${canPrepare ? "habits" : "pact"}`;
  return (
    <Button block onClick={() => navigate(destination)}>
      {canPrepare ? "Preparar la temporada" : "Ver el pacto"}
    </Button>
  );
}
