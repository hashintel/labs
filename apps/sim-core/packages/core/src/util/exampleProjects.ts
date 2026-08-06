export interface ExampleManifestEntry {
  slug: string;
  name: string;
  file: string;
  type: string;
  description: string;
  default?: boolean;
}

const MANIFEST_URL = "/example_projects/manifest.json";

let cachedManifest: ExampleManifestEntry[] | null = null;

export async function fetchExampleManifest(): Promise<ExampleManifestEntry[]> {
  if (cachedManifest) return cachedManifest;

  const response = await fetch(MANIFEST_URL);
  if (!response.ok) {
    console.warn(`Failed to load example manifest: ${response.status}`);
    return [];
  }
  cachedManifest = (await response.json()) as ExampleManifestEntry[];
  return cachedManifest;
}

export function exampleZipUrl(entry: ExampleManifestEntry): string {
  return `/example_projects/${entry.file}`;
}
