import type { MarketplaceExtension, MarketplaceVersion } from '../types.js';

const MS_MARKETPLACE_API =
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

const MS_VSIX_BASE =
  'https://marketplace.visualstudio.com/_apis/public/gallery/' +
  'publishers/{publisher}/vsextensions/{name}/{version}/vspackage';

interface MarketplaceResponse {
  results: Array<{
    extensions?: Array<{
      publisher: { publisherName: string };
      extensionName: string;
      versions?: Array<{
        version: string;
        properties?: Array<{ key: string; value: string }>;
        files?: Array<{ assetType: string; source: string }>;
      }>;
    }>;
  }>;
}

export interface FetchResult {
  metadata: MarketplaceExtension | null;
  error: string | null;
}

export async function fetchExtensionMetadataWithReason(
  extensionId: string
): Promise<FetchResult> {
  const payload = {
    filters: [
      {
        criteria: [{ filterType: 7, value: extensionId }],
        pageNumber: 1,
        pageSize: 1,
        sortBy: 0,
        sortOrder: 0,
      },
    ],
    assetTypes: [],
    flags: 0x1 | 0x2 | 0x10 | 0x200 | 0x80,
  };

  try {
    const response = await fetch(MS_MARKETPLACE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json;api-version=3.0-preview.1',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      return { metadata: null, error: `HTTP ${response.status}` };
    }

    const data = (await response.json()) as MarketplaceResponse;
    const results = data.results ?? [];
    const firstResult = results[0];
    if (!results.length || !firstResult?.extensions?.length) {
      return { metadata: null, error: 'Not found in marketplace' };
    }

    const ext = firstResult.extensions[0];
    if (!ext) return { metadata: null, error: 'No extension data in response' };
    const publisher = ext.publisher.publisherName;
    const name = ext.extensionName;
    const versions: MarketplaceVersion[] = [];

    for (const v of ext.versions ?? []) {
      const engineProp = v.properties?.find((p) => p.key === 'Microsoft.VisualStudio.Code.Engine');
      const engineSpec = engineProp?.value ?? '*';

      let vsixUrl: string | null = null;
      const vsixFile = v.files?.find(
        (f) => f.assetType === 'Microsoft.VisualStudio.Services.VSIXPackage'
      );
      if (vsixFile?.source) {
        vsixUrl = vsixFile.source;
      } else {
        vsixUrl = MS_VSIX_BASE.replace('{publisher}', publisher)
          .replace('{name}', name)
          .replace('{version}', v.version);
      }

      versions.push({
        version: v.version,
        engineSpec,
        vsixUrl,
      });
    }

    return {
      metadata: {
        id: extensionId.toLowerCase(),
        publisher,
        name,
        versions,
      },
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { metadata: null, error: message };
  }
}

export async function fetchExtensionMetadata(
  extensionId: string
): Promise<MarketplaceExtension | null> {
  const result = await fetchExtensionMetadataWithReason(extensionId);
  return result.metadata;
}

export function parseExtensionId(extensionId: string): {
  publisher: string;
  name: string;
} {
  const [publisher = '', name = ''] = extensionId.split('.');
  return { publisher, name };
}

export function getVsixFilename(extensionId: string, version: string): string {
  return `${extensionId.toLowerCase()}-${version}.vsix`;
}
