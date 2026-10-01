/** Types `import.meta.glob`, which Vite resolves at build time; shared by the source-scanning tests. */
interface ImportMeta {
  glob(
    pattern: string,
    options: { query: string; import: string; eager: true },
  ): Record<string, string>;
}
