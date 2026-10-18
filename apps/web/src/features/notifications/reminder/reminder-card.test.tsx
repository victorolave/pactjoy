import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { ReminderCard } from "./ReminderCard.tsx";

/**
 * A commitment's reminder (ADR-0017 addendum, D2, REQ-R1, R12..R14): a switch, a time between
 * 08:00 and 21:45 in 15-minute steps, and the days. Every change saves at once; it never asks for
 * the notification permission, and it says where to turn notifications on when they are off.
 */

const S = "season-1";
const C = "commitment-1";

function given(options: Parameters<typeof renderInProviders>[1] = {}) {
  const view = renderInProviders(<ReminderCard seasonId={S} commitmentId={C} />, options);
  return view;
}

describe("ReminderCard", () => {
  it("shows the default: off, 20:00, with the time and days hidden until it is on", async () => {
    given();
    const toggle = await screen.findByRole("switch", { name: "Recordatorio" });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole("combobox", { name: "Hora" })).toBeNull();
  });

  it("turning it on saves at once, at 20:00 on the commitment's days", async () => {
    const { deps } = given();
    await userEvent.click(await screen.findByRole("switch", { name: "Recordatorio" }));
    await waitFor(() => expect(deps.api.reminderCommands).toHaveLength(1));
    expect(deps.api.reminderCommands[0]).toEqual({
      seasonId: S,
      commitmentId: C,
      setting: { enabled: true, minuteOfDay: 1200, weekdays: [0, 1, 2, 3, 4, 5, 6] },
    });
    expect(screen.getByRole("combobox", { name: "Hora" })).toHaveValue("1200");
    // It never asks for the permission itself (REQ-R13).
    expect(deps.notifications.requests).toBe(0);
  });

  it("offers 08:00 to 21:45 in 15-minute steps and saves the chosen time", async () => {
    const { deps } = given();
    deps.api.reminders.set(C, {
      commitmentId: C,
      enabled: true,
      minuteOfDay: 1200,
      weekdays: [0, 2, 4],
      availableWeekdays: [0, 2, 4],
    });
    const time = await screen.findByRole("combobox", { name: "Hora" });
    const options = [...(time as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options[0]).toBe("08:00");
    expect(options.at(-1)).toBe("21:45");
    expect(options).toHaveLength(56);
    await userEvent.selectOptions(time, "1290");
    await waitFor(() =>
      expect(deps.api.reminderCommands.at(-1)?.setting).toEqual({
        enabled: true,
        minuteOfDay: 1290,
        weekdays: [0, 2, 4],
      }),
    );
  });

  it("only the commitment's own days can be chosen, and never none of them", async () => {
    const { deps } = given();
    deps.api.reminders.set(C, {
      commitmentId: C,
      enabled: true,
      minuteOfDay: 1200,
      weekdays: [0, 2],
      availableWeekdays: [0, 2, 4],
    });
    const days = await screen.findByRole("group", { name: "Días" });
    expect([...days.querySelectorAll("button")].map((b) => [b.textContent, b.ariaPressed])).toEqual(
      [
        ["L", "true"],
        ["X", "true"],
        ["V", "false"],
      ],
    );
    await userEvent.click(screen.getByRole("button", { name: "Lunes" }));
    await waitFor(() => expect(deps.api.reminderCommands.at(-1)?.setting.weekdays).toEqual([2]));
    // The last day left cannot be turned off.
    expect(screen.getByRole("button", { name: "Miércoles" })).toBeDisabled();
  });

  it("REQ-R13: on, with notifications off on this device, says where to turn them on", async () => {
    given({ notificationPermission: "default" });
    await userEvent.click(await screen.findByRole("switch", { name: "Recordatorio" }));
    expect(
      await screen.findByText("Activa las notificaciones en Ajustes para recibirlo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a Ajustes" })).toHaveAttribute(
      "href",
      "/profile/settings",
    );
  });

  it("REQ-R14: offline, it cannot be changed", async () => {
    given({ online: false });
    expect(await screen.findByRole("switch", { name: "Recordatorio" })).toBeDisabled();
    expect(screen.getByText("Sin conexión")).toBeInTheDocument();
  });

  it("a failed save says so and shows the stored setting again", async () => {
    const { deps } = given();
    deps.api.failNext("setCommitmentReminder", new ApiError("NetworkError", 0, null));
    await userEvent.click(await screen.findByRole("switch", { name: "Recordatorio" }));
    expect(await screen.findByText("No pudimos guardar el recordatorio.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Recordatorio" })).not.toBeChecked();
  });
});
