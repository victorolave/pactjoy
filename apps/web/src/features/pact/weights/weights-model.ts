const validWeight = (weight: number): boolean =>
  Number.isInteger(weight) && weight >= 5 && weight <= 100;

export function changeWeight(weight: number, step: -5 | 5): number {
  if (!validWeight(weight)) throw new RangeError("weight must be an integer from 5 to 100");
  return Math.min(100, Math.max(5, weight + step));
}

/** No habit cap: null says an equal split with minimum 5 is mathematically impossible. */
export function equalWeights(count: number): readonly number[] | null {
  if (!Number.isInteger(count) || count < 0 || count > 20) return null;
  if (count === 0) return [];
  const base = Math.floor(20 / count) * 5;
  const remainder = (100 - base * count) / 5;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 5 : 0));
}

export function weightSummary(weights: readonly number[]) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return {
    total,
    canContinue: weights.length > 0 && weights.every(validWeight) && total === 100,
    message:
      total === 100
        ? null
        : total > 100
          ? `Te sobran ${total - 100}%`
          : `Te faltan ${100 - total}%`,
  };
}
