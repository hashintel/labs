import { fetchDataset } from "@hashintel/utils/lib/datasets/fetchDataset";

import { FetchedDataset } from "./types";
import { Json } from "../../";
import { PyProxy } from "./python/pyodideTypes";
import {
  runPythonNamespaced,
  runnerPython,
  updatePythonDatasetCache,
} from "./buildpython";

export type DatasetCache = Map<string, { data: Json; name: string }>;

type DataKeyValuePair = { name: string; value: any; s3Key: string };

let datasetNamespace: PyProxy | null = null;

/**
 * Check if a dataset exists in the provided cache
 * Download it and convert it into json if it's not already cached
 */
export async function fetchDatasetContent(
  datasets: FetchedDataset[],
  cache: DatasetCache,
): Promise<Json> {
  const data: Record<string, Json> = {};

  const kvps: DataKeyValuePair[] = await Promise.all<DataKeyValuePair | null>(
    datasets.map((dataset) => {
      return Promise.resolve()
        .then(() => {
          if (cache.has(dataset.s3Key)) {
            return Promise.resolve(cache.get(dataset.s3Key)?.data);
          }

          if (dataset.format) {
            return fetchDataset(
              dataset.url,
              dataset.format,
              dataset.inPlaceData,
            );
          }

          throw new Error(`Unknown dataset format ${dataset.format}`);
        })
        .then((value) => ({
          name: dataset.shortname,
          value,
          s3Key: dataset.s3Key,
        }))
        .catch((err) => {
          console.error(err);
          console.error(
            "Unable to load dataset",
            dataset.shortname,
            dataset.id,
          );
          return null;
        });
    }),
  ).then((datakeys: (DataKeyValuePair | null)[]): DataKeyValuePair[] =>
    datakeys.filter<DataKeyValuePair>(
      (kvp): kvp is DataKeyValuePair => kvp !== null,
    ),
  );

  for (const kvp of kvps) {
    data[kvp.name] = kvp.value;
    if (!Object.prototype.hasOwnProperty.call(cache, kvp.s3Key)) {
      cache.set(kvp.s3Key, { data: kvp.value, name: kvp.name });
    }
  }

  return data;
}

/**
 * Inject datasets into the python scope for faster access
 */
export const refreshPyodideDatasetCache = async (cache: DatasetCache) => {
  if (datasetNamespace === null) {
    datasetNamespace = self.pyodide.toPy({});
  }
  // Cache datasets
  // Inject whatever datasets are not cached in the python side into pyodide
  if (!datasetNamespace.has("cached_dataset_names")) {
    datasetNamespace.set("cached_dataset_names", self.pyodide.toPy([]));
    datasetNamespace.set("cached_datasets", self.pyodide.toPy({}));
  }
  const pyodideCachedNames = datasetNamespace
    .get("cached_dataset_names")
    .toJs();

  // For each of our datasets in the cache, check if we've already cached it in pyodide
  // Pyodide has a memory limit of 2GB and will die if more than 2GB gets put inside it
  // It's possible to quickly hit this by loading the same big dataset over and over
  for (const [k, v] of cache.entries()) {
    // The key is a S3 key which is unique across versions of the same dataset
    // Have we seen this specific version of a dataset before?
    if (!pyodideCachedNames.includes(k) && runnerPython !== null) {
      const { data, name } = v;
      datasetNamespace.set("pythonDatasetCache", JSON.stringify(data));

      // If we haven't seen this specific version before,
      // cache the value under the dataset _shortname_: cached_datasets become
      // context.data() in Python and users access datasets there by shortname.
      // This will overwrite any existing cached value for the same shortname,
      // making it impossible to have different versions of the same dataset cached (this is impossible for other reasons, including shortname clash)
      // Allowing for multiple will involve sending the S3 key in to Python
      // and manipulating cached_datasets to the right shape there.
      await runPythonNamespaced(
        `
import json
cached_dataset_names.append("${k}")
cached_datasets["${name}"] = json.loads(pythonDatasetCache)
pythonDatasetCache = ""
 `,
        datasetNamespace,
      );
    }
  }

  updatePythonDatasetCache(datasetNamespace.get("cached_datasets"));
};
