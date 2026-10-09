import type { Actor } from "@pactjoy/app";
import type { Accounts } from "./accounts.ts";
import { leaveCurrentCircle, type SeedContext } from "./core.ts";
import { pairWeek3 } from "./scenarios/pair-week-3.ts";

export interface ScenarioAccount {
  readonly email: string;
  readonly displayName: string;
}

/** One seeded situation: its own circle and its own fixed @pactjoy.local accounts. */
export interface Scenario {
  readonly id: string;
  readonly summary: string;
  readonly accounts: readonly ScenarioAccount[];
  run(seed: SeedContext, actors: readonly Actor[], today: string): Promise<void>;
}

export const SCENARIOS: readonly Scenario[] = [pairWeek3];

/** `--scenario <id>` or `--scenario all` (default `all`). */
export function selectScenarios(args: readonly string[]): readonly Scenario[] | string {
  const flag = args.indexOf("--scenario");
  const id = flag === -1 ? "all" : args[flag + 1];
  if (id === "all") return SCENARIOS;
  const found = SCENARIOS.find((scenario) => scenario.id === id);
  return found
    ? [found]
    : `Unknown scenario "${id ?? ""}". Use one of: all, ${SCENARIOS.map((s) => s.id).join(", ")}.`;
}

/**
 * Seeds each scenario: ensures its accounts, makes them leave whatever circle they are in (a
 * rerun therefore starts clean, touching only these accounts), then runs it.
 */
export async function runScenarios(
  seed: SeedContext,
  accounts: Accounts,
  scenarios: readonly Scenario[],
  today: string,
  resetAt: () => void,
): Promise<void> {
  for (const scenario of scenarios) {
    const actors: Actor[] = [];
    for (const account of scenario.accounts) actors.push(await accounts.ensure(account.email));
    resetAt();
    for (const actor of actors) await leaveCurrentCircle(seed, actor);
    await scenario.run(seed, actors, today);
    seed.log(`${scenario.id}: ${scenario.accounts.map((a) => a.email).join(", ")}`);
  }
}
