/**
 * An instant as epoch milliseconds. The use cases speak numbers (`Instant`); a JSON round trip types
 * them as strings (`Serialized`) although the evidence photo's expiry arrives as a number, so the
 * screens read either form through this one function instead of trusting the type.
 */
export const epochMs = (value: string | number): number =>
  typeof value === "number" ? value : Date.parse(value);
