import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import type { EditEntryCommand, RecordEntryCommand } from "../../ports/pactjoy-api.ts";
import { renderInProviders } from "../../testing/render.tsx";
import { useOutboxState } from "./outbox/use-outbox.tsx";
import { useDeleteEntry, useEditEntry, useRecordEntry } from "./queries.ts";

const RECORD: RecordEntryCommand = {
  seasonId: "season-1",
  commitmentId: "commitment-1",
  forDate: "2026-10-02",
  value: { kind: "done" },
  note: null,
  clientRequestId: "req-1",
};
const CONTEXT = { habitName: "Leer", forDate: "2026-10-02" };

interface ProbeProps {
  readonly command?: RecordEntryCommand;
  /** The entry the edit and the delete aim at. */
  readonly target?: string;
  readonly editPhoto?: string | null;
}

function Probe({ command = RECORD, target = "entry-9", editPhoto }: ProbeProps) {
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const callbacks = {
    onSuccess: (data: unknown) => {
      setError("");
      setResult(JSON.stringify(data));
    },
    onError: (failure: ApiError) => {
      setResult("");
      setError(failure.code);
    },
  };
  const record = useRecordEntry(callbacks, "Leer");
  const edit = useEditEntry(callbacks, CONTEXT);
  const remove = useDeleteEntry(callbacks, CONTEXT);
  const outbox = useOutboxState();
  const editCommand: EditEntryCommand = {
    entryId: target,
    value: { kind: "quantity", value: "30" },
    note: "tarde",
    ...(editPhoto === undefined ? {} : { photoId: editPhoto }),
  };
  return (
    <div>
      <output aria-label="result">{result}</output>
      <output aria-label="error">{error}</output>
      <output aria-label="queue">
        {outbox.items
          .map((item) =>
            item.kind === "record"
              ? `record:${item.localId}:${item.attempted}:${item.command.value.kind}`
              : `${item.kind}:${item.target}`,
          )
          .join(",")}
      </output>
      <button type="button" onClick={() => record.mutate(command)}>
        record
      </button>
      <button type="button" onClick={() => edit.mutate(editCommand)}>
        edit
      </button>
      <button type="button" onClick={() => remove.mutate(target)}>
        delete
      </button>
    </div>
  );
}

const click = (name: string) => userEvent.click(screen.getByRole("button", { name }));
const queue = () => screen.getByLabelText("queue").textContent;
const result = () => screen.getByLabelText("result").textContent ?? "";
const error = () => screen.getByLabelText("error").textContent;
const network = () => new ApiError("NetworkError", 0, null);

describe("sending a record (OE-R1)", () => {
  it("sends it straight away when online with an empty outbox", async () => {
    const app = renderInProviders(<Probe />);
    await click("record");
    await waitFor(() => expect(result()).toContain('"entryId":"entry-1"'));
    expect(JSON.parse(result())).not.toHaveProperty("queued");
    expect(queue()).toBe("");
    expect(app.deps.api.calls.recordEntry).toBe(1);
  });

  it("queues it with no request when the device is offline (OE-R1.S1)", async () => {
    const app = renderInProviders(<Probe />, { online: false });
    await click("record");
    await waitFor(() => expect(result()).not.toBe(""));
    expect(JSON.parse(result())).toEqual({ entryId: "local:id-1", replayed: false, queued: true });
    expect(app.deps.api.calls.recordEntry).toBe(0);
    expect(queue()).toBe("record:id-1:false:done");
    expect(app.deps.outboxStore.load("user-1").items[0]).toMatchObject({
      kind: "record",
      habitName: "Leer",
      command: { forDate: "2026-10-02", clientRequestId: "req-1", value: { kind: "done" } },
    });
  });

  it("queues the same command when the answer is lost, with no error (OE-R1.S2)", async () => {
    const app = renderInProviders(<Probe />);
    app.deps.api.failNext("recordEntry", network());
    await click("record");
    await waitFor(() => expect(result()).toContain('"queued":true'));
    expect(error()).toBe("");
    // The replay that follows an enqueue while online sends the very same request id.
    await waitFor(() =>
      expect(app.deps.api.recordAttempts.map((cmd) => cmd.clientRequestId)).toEqual([
        "req-1",
        "req-1",
      ]),
    );
    await waitFor(() => expect(queue()).toBe(""));
  });

  it("a record cut off mid-send is queued as attempted: a later edit or delete waits behind it", async () => {
    const app = renderInProviders(<Probe target="local:id-1" />);
    // The request leaves, the connection drops in the same tick and the answer never arrives.
    app.deps.api.recordEntry = async () => {
      app.deps.connectivity.setOnline(false);
      throw network();
    };
    await click("record");
    await waitFor(() => expect(queue()).toBe("record:id-1:true:done"));
    await click("edit");
    await waitFor(() => expect(queue()).toBe("record:id-1:true:done,edit:local:id-1"));
    await click("delete");
    await waitFor(() => expect(queue()).toBe("record:id-1:true:done,delete:local:id-1"));
  });

  it("appends to a non-empty outbox instead of sending directly (OE-R1.S3)", async () => {
    const app = renderInProviders(<Probe />, { online: false });
    await click("record");
    await waitFor(() => expect(queue()).toBe("record:id-1:false:done"));
    const release = app.deps.api.hold("recordEntry");
    act(() => app.deps.connectivity.setOnline(true));
    await waitFor(() => expect(app.deps.api.recordAttempts).toHaveLength(1));
    // Online now, but the first is still in flight: the next one waits its turn.
    await click("record");
    await waitFor(() => expect(result()).toContain('"queued":true'));
    expect(app.deps.api.recordAttempts).toHaveLength(1);
    release();
    await waitFor(() => expect(queue()).toBe(""));
    expect(app.deps.api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-1", "req-1"]);
  });

  it("does not queue a record with a photo: a lost answer is an error to retry (OE-R1.S4)", async () => {
    const app = renderInProviders(<Probe command={{ ...RECORD, photoId: "photo-1" }} />);
    app.deps.api.failNext("recordEntry", network());
    await click("record");
    await waitFor(() => expect(error()).toBe("NetworkError"));
    expect(queue()).toBe("");
  });

  it("does not queue a record without a day (OE-R1.S5)", async () => {
    const { forDate: _day, ...withoutDay } = RECORD;
    const app = renderInProviders(<Probe command={withoutDay} />, { online: false });
    app.deps.api.failNext("recordEntry", network());
    await click("record");
    await waitFor(() => expect(error()).toBe("NetworkError"));
    expect(queue()).toBe("");
  });

  it("still shows the error of a failure that is not about the connection", async () => {
    const app = renderInProviders(<Probe />);
    app.deps.api.failNext("recordEntry", new ApiError("WindowClosed", 422, null));
    await click("record");
    await waitFor(() => expect(error()).toBe("WindowClosed"));
    expect(queue()).toBe("");
  });
});

describe("editing and deleting (OE-R2)", () => {
  it("sends an edit of a server entry straight away when online", async () => {
    const app = renderInProviders(<Probe />);
    await click("edit");
    await waitFor(() => expect(result()).toBe('{"queued":false}'));
    expect(app.deps.api.edited).toEqual([
      { entryId: "entry-9", value: { kind: "quantity", value: "30" }, note: "tarde" },
    ]);
  });

  it("queues an edit of a server entry while offline, then sends it on reconnect", async () => {
    const app = renderInProviders(<Probe />, { online: false });
    await click("edit");
    await waitFor(() => expect(result()).toBe('{"queued":true}'));
    expect(app.deps.api.calls.editEntry).toBe(0);
    expect(queue()).toBe("edit:entry-9");
    act(() => app.deps.connectivity.setOnline(true));
    await waitFor(() => expect(queue()).toBe(""));
    expect(app.deps.api.edited).toHaveLength(1);
  });

  it("queues a delete of a server entry while offline", async () => {
    const app = renderInProviders(<Probe />, { online: false });
    await click("delete");
    await waitFor(() => expect(result()).toBe('{"queued":true}'));
    expect(app.deps.api.calls.deleteEntry).toBe(0);
    expect(queue()).toBe("delete:entry-9");
  });

  it("queues an edit whose answer was lost", async () => {
    const app = renderInProviders(<Probe />);
    app.deps.api.failNext("editEntry", network());
    await click("edit");
    await waitFor(() => expect(result()).toBe('{"queued":true}'));
    await waitFor(() => expect(queue()).toBe(""));
    expect(app.deps.api.calls.editEntry).toBe(2);
  });

  it("an edit cut off mid-send is not queued behind a delete the member made after it (W1)", async () => {
    const app = renderInProviders(<Probe />);
    const release = app.deps.api.hold("editEntry");
    app.deps.api.failNext("editEntry", network());
    await click("edit");
    act(() => app.deps.connectivity.setOnline(false));
    app.deps.clock.advanceSeconds(5);
    await click("delete");
    await waitFor(() => expect(queue()).toBe("delete:entry-9"));
    release();
    await waitFor(() => expect(app.deps.queryClient.isMutating()).toBe(0));
    expect(result()).toBe('{"queued":true}');
    expect(queue()).toBe("delete:entry-9");
  });

  it("an edit cut off mid-send is not queued over a later edit that already went through (W1)", async () => {
    const app = renderInProviders(<Probe />);
    const release = app.deps.api.hold("editEntry");
    await click("edit");
    app.deps.clock.advanceSeconds(5);
    await click("edit");
    await waitFor(() => expect(app.deps.api.edited).toHaveLength(1));
    app.deps.api.failNext("editEntry", network());
    release();
    await waitFor(() => expect(app.deps.queryClient.isMutating()).toBe(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queue()).toBe("");
    // Only the later edit reached the server: the cut-off one was never replayed over it.
    expect(app.deps.api.edited).toHaveLength(1);
    expect(app.deps.api.calls.editEntry).toBe(2);
  });

  it("does not queue an edit that carries a photo (OE-R1.S4)", async () => {
    const app = renderInProviders(<Probe editPhoto="photo-2" />);
    app.deps.api.failNext("editEntry", network());
    await click("edit");
    await waitFor(() => expect(error()).toBe("NetworkError"));
    expect(queue()).toBe("");
  });

  it("an edit of a record still on the phone rewrites it in place (OE-R2.S1)", async () => {
    renderInProviders(<Probe target="local:id-1" />, { online: false });
    await click("record");
    await waitFor(() => expect(queue()).toBe("record:id-1:false:done"));
    await click("edit");
    await waitFor(() => expect(result()).toBe('{"queued":true}'));
    expect(queue()).toBe("record:id-1:false:quantity");
  });

  it("an undo of a record still on the phone removes it (OE-R2.S2)", async () => {
    const app = renderInProviders(<Probe target="local:id-1" />, { online: false });
    await click("record");
    await waitFor(() => expect(queue()).toBe("record:id-1:false:done"));
    await click("delete");
    await waitFor(() => expect(queue()).toBe(""));
    expect(result()).toBe('{"queued":true}');
    expect(app.deps.api.calls.recordEntry).toBe(0);
  });

  it("an edit of a record that may be on the server waits behind it, aimed at its server entry", async () => {
    const app = renderInProviders(<Probe target="local:id-1" />, { online: false });
    await click("record");
    await waitFor(() => expect(queue()).toBe("record:id-1:false:done"));
    const release = app.deps.api.hold("recordEntry");
    act(() => app.deps.connectivity.setOnline(true));
    await waitFor(() => expect(app.deps.api.recordAttempts).toHaveLength(1));
    await click("edit");
    await waitFor(() => expect(queue()).toBe("record:id-1:true:done,edit:local:id-1"));
    release();
    await waitFor(() => expect(queue()).toBe(""));
    expect(app.deps.api.edited.map((cmd) => cmd.entryId)).toEqual(["entry-1"]);
  });

  it("a stale reference held after the sync reaches the server entry (undo toast)", async () => {
    const app = renderInProviders(<Probe target="local:id-1" />, { online: false });
    await click("record");
    await waitFor(() => expect(queue()).toBe("record:id-1:false:done"));
    act(() => app.deps.connectivity.setOnline(true));
    await waitFor(() => expect(queue()).toBe(""));
    await click("delete");
    await waitFor(() => expect(app.deps.api.deleted).toEqual(["entry-1"]));
    expect(result()).toBe('{"queued":false}');
  });

  it("a reference to a record the outbox no longer knows is an entry that is gone", async () => {
    const app = renderInProviders(<Probe target="local:ghost" />, { online: false });
    await click("delete");
    await waitFor(() => expect(error()).toBe("EntryNotFound"));
    expect(app.deps.api.calls.deleteEntry).toBe(0);
  });
});
