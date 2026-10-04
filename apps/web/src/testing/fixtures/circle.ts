import type { MyCircle } from "../../ports/pactjoy-api.ts";

/** A user who has no circle yet (`/me/circle`). */
export const NO_CIRCLE: MyCircle = { circle: null, season: null };

/** The viewer alone in a circle, with a live invite. The default of `renderApp`. */
export function soloCircleFixture(): MyCircle {
  return {
    circle: {
      id: "circle-1",
      name: "Andrea & Victor",
      members: [
        {
          id: "member-victor",
          displayName: "Victor",
          joinedAt: "2026-09-28T12:00:00.000Z",
          isYou: true,
        },
      ],
      invite: {
        code: "7K4Q2M",
        createdAt: "2026-10-01T12:00:00.000Z",
        expiresAt: "2026-10-08T12:00:00.000Z",
      },
    },
    season: null,
  };
}
