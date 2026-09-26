# Contributing

Thanks for your interest in PactJoy.

## Current status

PactJoy is a personal project in pre-alpha. **Code contributions (pull requests) are not being accepted until the MVP is released.**

Welcome right now:

- **Issues:** bugs, questions and ideas.
- **Discussion** of the scoring rules and product decisions.

## Development workflow: test-first

This project practices **red → green → refactor**: write a failing test
first, make it pass with the smallest change that does so, then clean up
without changing behavior.

- **Domain rules are test-driven.** `packages/engine` has zero dependencies
  and no framework to lean on, so its correctness comes entirely from tests.
  Its rules are driven by acceptance tests derived from the product's worked
  examples — the same ones referenced in [`README.md`](README.md#documentation)
  — so every scoring rule has a test before (or as) it is implemented.
- **Every bug fix starts with a failing test** that reproduces the bug. The
  test goes red first, on purpose; only then does the fix make it green.
- This applies beyond `packages/engine` as other packages are added: new
  behavior gets a test first, not after.

## When contributions open

External contributions will require signing a **Contributor License Agreement (CLA)**. The CLA keeps the project able to offer the code under additional licenses (dual licensing) alongside the AGPL, while you keep the copyright of your contribution.

The expected workflow will be:

1. Open an issue before starting any significant change.
2. Keep pull requests small and focused, with tests.
3. The scoring engine (`packages/engine`) only accepts changes backed by acceptance tests.
