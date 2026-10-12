import { useState } from "react";
import { useOnline } from "../../context/connectivity-context.tsx";
import { Button } from "../../ui/Button.tsx";
import { RequestPauseSheet } from "./request/RequestPauseSheet.tsx";

/** Today's way into the request sheet (PS-1): "Pausar un compromiso", with nothing preselected. */
export function PauseTodayAction() {
  const online = useOnline();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        leadingIcon="circle-pause"
        disabled={!online}
        onClick={() => setOpen(true)}
      >
        Pausar un compromiso
      </Button>
      <RequestPauseSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
