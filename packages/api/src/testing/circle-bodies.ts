/**
 * Request-body builders for `POST /circles` and `POST /circles/join` in
 * tests. Call sites go through these so a change to the bodies touches one
 * place. Tests of REJECTED raw bodies keep their literals on purpose.
 */

export function createCircleBody(
  name: string,
  displayName = "Creator",
): { name: string; displayName: string } {
  return { name, displayName };
}

export function joinCircleBody(
  inviteCode: string,
  displayName = "Joiner",
): { inviteCode: string; displayName: string } {
  return { inviteCode, displayName };
}
