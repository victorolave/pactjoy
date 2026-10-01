import type { HttpMethod } from "./types.ts";

/** A route is data; the router never contains per-route logic. */
export interface RouteSpec {
  readonly method: HttpMethod;
  readonly pattern: string;
}

export type RouteMatch<R extends RouteSpec> =
  | { readonly kind: "match"; readonly route: R; readonly params: Readonly<Record<string, string>> }
  | { readonly kind: "methodNotAllowed"; readonly allow: readonly HttpMethod[] }
  | { readonly kind: "notFound" };

type Segment = { readonly param: string } | { readonly literal: string };

const PATTERN = /^(\/(:[A-Za-z][A-Za-z0-9]*|[A-Za-z0-9_-]+))+$/;

function compile(pattern: string): Segment[] {
  if (!PATTERN.test(pattern)) throw new Error(`Invalid route pattern: ${pattern}`);
  const names = new Set<string>();
  return pattern
    .slice(1)
    .split("/")
    .map((part): Segment => {
      if (!part.startsWith(":")) return { literal: part };
      const param = part.slice(1);
      if (names.has(param)) throw new Error(`Duplicate param "${param}" in ${pattern}`);
      names.add(param);
      return { param };
    });
}

/** The path under `basePath`, or null when the request is outside it. */
export function stripBasePath(pathname: string, basePath: string): string | null {
  if (pathname === basePath) return "/";
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : null;
}

/**
 * Ambiguity is rejected at construction (params act as wildcards for the
 * same-shape check), so matching needs no precedence rules.
 */
export function createRouter<R extends RouteSpec>(routes: readonly R[]) {
  const compiled = routes.map((route) => ({ route, segments: compile(route.pattern) }));
  const overlaps = (a: Segment[], b: Segment[]) =>
    a.length === b.length &&
    a.every((s, i) => {
      const t = b[i];
      return !t || "param" in s || "param" in t || s.literal === t.literal;
    });
  for (const [i, a] of compiled.entries()) {
    for (const b of compiled.slice(i + 1)) {
      if (a.route.method === b.route.method && overlaps(a.segments, b.segments)) {
        throw new Error(
          `Routes of the same shape: ${a.route.method} ${a.route.pattern} / ${b.route.pattern}`,
        );
      }
    }
  }

  function match(method: string, path: string): RouteMatch<R> {
    const parts = path.slice(1).split("/");
    if (!path.startsWith("/") || parts.some((p) => p === "")) return { kind: "notFound" };
    const allow = new Set<HttpMethod>();
    let found: { route: R; params: Record<string, string> } | undefined;
    for (const { route, segments } of compiled) {
      if (segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (const [i, segment] of segments.entries()) {
        const part = parts[i] ?? "";
        if ("literal" in segment) {
          ok = segment.literal === part;
        } else {
          try {
            params[segment.param] = decodeURIComponent(part);
          } catch {
            return { kind: "notFound" };
          }
        }
        if (!ok) break;
      }
      if (!ok) continue;
      if (route.method === method) found = { route, params };
      else allow.add(route.method);
    }
    if (found) return { kind: "match", ...found };
    if (allow.size > 0) return { kind: "methodNotAllowed", allow: [...allow].sort() };
    return { kind: "notFound" };
  }

  return { match };
}
