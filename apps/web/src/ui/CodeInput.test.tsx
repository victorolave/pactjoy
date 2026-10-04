import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CodeInput, hasRejectedChars, normalizeCode } from "./CodeInput.tsx";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

const HINT = "Sin 0, O, 1, I ni L.";

function Harness({ initial = "", invalid = false }: { initial?: string; invalid?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CodeInput
        label="Código de invitación"
        value={value}
        onChange={setValue}
        alphabet={ALPHABET}
        invalid={invalid}
        rejectedHint={HINT}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

const field = () => screen.getByRole("textbox", { name: "Código de invitación" });
const value = () => screen.getByTestId("value").textContent;

describe("normalizeCode", () => {
  it("uppercases and drops spaces, hyphens and any other separator", () => {
    expect(normalizeCode("abc-123", ALPHABET, 6)).toBe("ABC23");
    expect(normalizeCode(" 7k4 q-2.m ", ALPHABET, 6)).toBe("7K4Q2M");
  });

  it("drops characters the alphabet leaves out (0, O, 1, I, L) and cuts at the length", () => {
    expect(normalizeCode("0O1ILA", ALPHABET, 6)).toBe("A");
    expect(normalizeCode("7K4Q2MXYZ", ALPHABET, 6)).toBe("7K4Q2M");
  });
});

describe("hasRejectedChars", () => {
  it("flags characters outside the alphabet but not separators", () => {
    expect(hasRejectedChars("AB0CD1E", ALPHABET)).toBe(true);
    expect(hasRejectedChars("abc-def g", ALPHABET)).toBe(false);
  });
});

describe("CodeInput", () => {
  it("is one real text field that draws six boxes", () => {
    const { container } = render(<Harness initial="7K4" />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    const boxes = container.querySelectorAll("span[aria-hidden='true']");
    expect([...boxes].map((box) => box.textContent)).toEqual(["7", "K", "4", "", "", ""]);
  });

  it("uppercases what is typed", async () => {
    render(<Harness />);
    await userEvent.type(field(), "7k4q");
    expect(value()).toBe("7K4Q");
  });

  it("stops at six characters", async () => {
    render(<Harness />);
    await userEvent.type(field(), "7K4Q2MXY");
    expect(value()).toBe("7K4Q2M");
  });

  it("fills every box from a paste, even with separators and lowercase (WC-S3)", async () => {
    render(<Harness />);
    await userEvent.click(field());
    await userEvent.paste("7k4-q2m");
    expect(value()).toBe("7K4Q2M");
  });

  it("replaces a full code when a new one is pasted over it", async () => {
    render(<Harness initial="AAAAAA" />);
    await userEvent.click(field());
    await userEvent.paste("7K4Q2M");
    expect(value()).toBe("7K4Q2M");
  });

  it("removes the last character on Backspace", async () => {
    render(<Harness initial="7K4Q2M" />);
    await userEvent.click(field());
    await userEvent.keyboard("{Backspace}");
    expect(value()).toBe("7K4Q2");
  });

  it("marks the field invalid for assistive tech", () => {
    render(<Harness initial="7K4Q2N" invalid />);
    expect(field()).toHaveAttribute("aria-invalid", "true");
  });

  it("hints, linked to the field, when a paste drops characters outside the alphabet", async () => {
    render(<Harness />);
    await userEvent.click(field());
    await userEvent.paste("AB0CD1E");
    expect(value()).toBe("ABCDE");
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(field()).toHaveAccessibleDescription(HINT);
  });

  it("does not hint for separators", async () => {
    render(<Harness />);
    await userEvent.click(field());
    await userEvent.paste("abc-def");
    expect(value()).toBe("ABCDEF");
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it("hints on a typed 0 and clears on the next valid character", async () => {
    render(<Harness />);
    await userEvent.type(field(), "A0");
    expect(screen.getByText(HINT)).toBeInTheDocument();
    await userEvent.type(field(), "B");
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });

  it("clears the hint once the code is complete", async () => {
    render(<Harness />);
    await userEvent.click(field());
    await userEvent.paste("ABCDE0");
    expect(screen.getByText(HINT)).toBeInTheDocument();
    await userEvent.type(field(), "F");
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});
