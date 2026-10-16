/** A file read as text through Vite's `?raw` query, as the README test reads the README. */
declare module "*.md?raw" {
  const text: string;
  export default text;
}
