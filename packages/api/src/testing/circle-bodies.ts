/**
 * Request-body builders for `POST /circles` and `POST /circles/join` in
 * tests. Call sites go through these so a change to the bodies touches one
 * place. Tests of REJECTED raw bodies keep their literals on purpose.
 */

export function createCircleBody(name: string): { name: string } {
  return { name };
}

export function joinCircleBody(inviteCode: string): { inviteCode: string } {
  return { inviteCode };
}
