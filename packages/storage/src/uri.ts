/** RFC 3986 percent-encoding as SigV4 requires (`encodeURIComponent` also keeps `!'()*`). */
export function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Canonical URI path for S3: each segment decoded and encoded exactly once (S3 does not
 * double-encode), slashes kept.
 */
export function encodePath(pathname: string): string {
  return pathname
    .split("/")
    .map((segment) => encodeRfc3986(decodeURIComponent(segment)))
    .join("/");
}
