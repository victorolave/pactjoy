let last = 0;

/**
 * A number that only ever grows, so two moments can be put in order even inside one millisecond
 * (a clock cannot). The outbox stamps a send with it and Today stamps a fetch with it; a fetch that
 * started after a send has seen the server as that send left it.
 */
export const tick = (): number => {
  last += 1;
  return last;
};
