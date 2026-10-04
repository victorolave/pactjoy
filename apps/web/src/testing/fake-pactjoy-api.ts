import type { TodayView } from "@pactjoy/app";
import type { ApiError } from "../ports/api-error.ts";
import type {
  CircleInvite,
  CircleRef,
  CreateCircleCommand,
  EditEntryCommand,
  InvitePreviewView,
  JoinCircleCommand,
  MyCircle,
  PactJoyApi,
  RecordEntryCommand,
  RecordedEntry,
} from "../ports/pactjoy-api.ts";
import { NO_CIRCLE } from "./fixtures/circle.ts";

type Method =
  | "getToday"
  | "recordEntry"
  | "editEntry"
  | "deleteEntry"
  | "getMyCircle"
  | "previewInvite"
  | "createCircle"
  | "joinCircle"
  | "generateInvite"
  | "renameCircle"
  | "renameMyDisplayName"
  | "leaveCircle";

const INVITE: CircleInvite = {
  code: "7K4Q2M",
  createdAt: "2026-10-01T12:00:00.000Z",
  expiresAt: "2026-10-08T12:00:00.000Z",
};
const PREVIEW: InvitePreviewView = {
  circleName: "Los Pactos",
  invitedBy: "Andrea",
  activeMemberCount: 2,
  expiresAt: "2026-10-08T12:00:00.000Z",
};

/**
 * In-memory PactJoyApi for tests, scriptable per state and per error. `recordEntry` is idempotent
 * on `clientRequestId` like the real API: a repeat returns the same entryId with `replayed: true`.
 */
export class FakePactJoyApi implements PactJoyApi {
  readonly calls: Record<Method, number> = {
    getToday: 0,
    recordEntry: 0,
    editEntry: 0,
    deleteEntry: 0,
    getMyCircle: 0,
    previewInvite: 0,
    createCircle: 0,
    joinCircle: 0,
    generateInvite: 0,
    renameCircle: 0,
    renameMyDisplayName: 0,
    leaveCircle: 0,
  };
  /** What the circle mutations were asked to do, in order, for assertions. */
  readonly circleCommands: { readonly method: Method; readonly args: readonly unknown[] }[] = [];
  /** Every recordEntry call, including the ones that were scripted to fail. */
  readonly recordAttempts: RecordEntryCommand[] = [];
  /** Every deleteEntry call, including the ones that were scripted to fail. */
  readonly deleteAttempts: string[] = [];
  readonly recorded: RecordEntryCommand[] = [];
  readonly edited: EditEntryCommand[] = [];
  readonly deleted: string[] = [];

  #today: TodayView;
  #myCircle: MyCircle = NO_CIRCLE;
  #preview: InvitePreviewView = PREVIEW;
  #invite: CircleInvite = INVITE;
  readonly #failures = new Map<Method, ApiError[]>();
  readonly #idByRequest = new Map<string, string>();
  readonly #gates = new Map<Method, Promise<void>>();

  constructor(today: TodayView) {
    this.#today = today;
  }

  setToday(today: TodayView): void {
    this.#today = today;
  }

  setMyCircle(myCircle: MyCircle): void {
    this.#myCircle = myCircle;
  }

  setPreview(preview: InvitePreviewView): void {
    this.#preview = preview;
  }

  setInvite(invite: CircleInvite): void {
    this.#invite = invite;
  }

  /** The next call to `method` rejects with `error` (queued: call twice to fail twice). */
  failNext(method: Method, error: ApiError): void {
    this.#failures.set(method, [...(this.#failures.get(method) ?? []), error]);
  }

  /** The next call to `method` waits until the returned function is called (to test pending UI). */
  hold(method: Method): () => void {
    let release = () => {};
    this.#gates.set(
      method,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  }

  async getToday(_signal?: AbortSignal): Promise<TodayView> {
    this.#enter("getToday");
    return this.#today;
  }

  async recordEntry(cmd: RecordEntryCommand): Promise<RecordedEntry> {
    const gate = this.#takeGate("recordEntry");
    this.recordAttempts.push(cmd);
    this.#enter("recordEntry");
    await gate;
    this.recorded.push(cmd);
    const existing = this.#idByRequest.get(cmd.clientRequestId);
    if (existing !== undefined) return { entryId: existing, replayed: true };
    const entryId = `entry-${this.#idByRequest.size + 1}`;
    this.#idByRequest.set(cmd.clientRequestId, entryId);
    return { entryId, replayed: false };
  }

  async editEntry(cmd: EditEntryCommand): Promise<void> {
    this.#enter("editEntry");
    this.edited.push(cmd);
  }

  async deleteEntry(entryId: string): Promise<void> {
    this.deleteAttempts.push(entryId);
    this.#enter("deleteEntry");
    this.deleted.push(entryId);
  }

  async getMyCircle(_signal?: AbortSignal): Promise<MyCircle> {
    await this.#circleCall("getMyCircle", []);
    return this.#myCircle;
  }

  async previewInvite(inviteCode: string, _signal?: AbortSignal): Promise<InvitePreviewView> {
    await this.#circleCall("previewInvite", [inviteCode]);
    return this.#preview;
  }

  async createCircle(cmd: CreateCircleCommand): Promise<CircleRef> {
    await this.#circleCall("createCircle", [cmd]);
    return { circleId: "circle-1" };
  }

  async joinCircle(cmd: JoinCircleCommand): Promise<CircleRef> {
    await this.#circleCall("joinCircle", [cmd]);
    return { circleId: "circle-1" };
  }

  async generateInvite(circleId: string): Promise<CircleInvite> {
    await this.#circleCall("generateInvite", [circleId]);
    return this.#invite;
  }

  async renameCircle(circleId: string, name: string): Promise<void> {
    await this.#circleCall("renameCircle", [circleId, name]);
  }

  async renameMyDisplayName(circleId: string, displayName: string): Promise<void> {
    await this.#circleCall("renameMyDisplayName", [circleId, displayName]);
  }

  async leaveCircle(circleId: string): Promise<void> {
    await this.#circleCall("leaveCircle", [circleId]);
  }

  /** Records the call, waits on a held gate, then throws a scripted failure. */
  async #circleCall(method: Method, args: readonly unknown[]): Promise<void> {
    const gate = this.#takeGate(method);
    this.circleCommands.push({ method, args });
    this.#enter(method);
    await gate;
  }

  #takeGate(method: Method): Promise<void> | undefined {
    const gate = this.#gates.get(method);
    this.#gates.delete(method);
    return gate;
  }

  #enter(method: Method): void {
    this.calls[method] += 1;
    const failure = this.#failures.get(method)?.shift();
    if (failure !== undefined) throw failure;
  }
}
