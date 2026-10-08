import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, AvatarStack } from "./Avatar.tsx";

describe("Avatar", () => {
  it("is an image named by the person, showing their initial", () => {
    render(<Avatar name="andrea" />);
    const avatar = screen.getByRole("img", { name: "andrea" });
    expect(avatar).toHaveTextContent("A");
  });

  it("gives the same person the same tint every time, from the palette tokens", () => {
    const { rerender } = render(<Avatar name="Victor" />);
    const first = screen.getByRole("img", { name: "Victor" }).style.background;
    rerender(<Avatar name="Victor" />);
    expect(screen.getByRole("img", { name: "Victor" }).style.background).toBe(first);
    expect(first).toMatch(/^var\(--(orange|coral|pink|purple|cream)-200\)$/);
  });

  it("spreads different people over more than one tint", () => {
    const names = ["Ana", "Beto", "Carla", "Diego", "Elena", "Fabio", "Gala", "Hugo"];
    const tints = new Set(
      names.map((name) => {
        const { unmount } = render(<Avatar name={name} />);
        const tint = screen.getByRole("img", { name }).style.background;
        unmount();
        return tint;
      }),
    );
    expect(tints.size).toBeGreaterThan(1);
  });

  it("shows a question mark rather than nothing for an empty name", () => {
    render(<Avatar name="  " />);
    expect(screen.getByRole("img")).toHaveTextContent("?");
  });

  it("supports size 28 and 48 as string or number", () => {
    const { rerender } = render(<Avatar name="Andrea" size={48} />);
    let avatar = screen.getByRole("img", { name: "Andrea" });
    expect(avatar.className).toMatch(/size48/);

    rerender(<Avatar name="Andrea" size="48" />);
    avatar = screen.getByRole("img", { name: "Andrea" });
    expect(avatar.className).toMatch(/size48/);

    rerender(<Avatar name="Andrea" size={40} />);
    avatar = screen.getByRole("img", { name: "Andrea" });
    expect(avatar.className).toMatch(/size40|md/);

    rerender(<Avatar name="Andrea" size="40" />);
    avatar = screen.getByRole("img", { name: "Andrea" });
    expect(avatar.className).toMatch(/size40|md/);

    rerender(<Avatar name="Andrea" size={28} />);
    avatar = screen.getByRole("img", { name: "Andrea" });
    expect(avatar.className).toMatch(/size28/);

    rerender(<Avatar name="Andrea" size="28" />);
    avatar = screen.getByRole("img", { name: "Andrea" });
    expect(avatar.className).toMatch(/size28/);
  });
});

describe("AvatarStack", () => {
  it("shows one avatar per name", () => {
    render(<AvatarStack names={["Andrea", "Victor"]} />);
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("aria-label"))).toEqual([
      "Andrea",
      "Victor",
    ]);
  });

  it("caps the stack", () => {
    render(<AvatarStack names={["A", "B", "C", "D", "E"]} max={3} />);
    expect(screen.getAllByRole("img")).toHaveLength(3);
  });

  it("supports size 28 and 48 in the stack", () => {
    render(<AvatarStack names={["Andrea", "Victor"]} size={28} />);
    const avatars = screen.getAllByRole("img");
    expect(avatars[0]?.className).toMatch(/size28/);
    expect(avatars[1]?.className).toMatch(/size28/);
  });
});
