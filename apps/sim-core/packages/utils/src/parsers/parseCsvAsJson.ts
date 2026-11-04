import { parse } from "papaparse";

/**
 * Really this should support papaparse's download option to stream and parse
 * rather than working directly from memory, but seems we have issues with
 * streaming from s3 because of cors
 *
 * @todo support stream parsing
 */
export const parseCsvAsJson = (
  input: string | File | NodeJS.ReadableStream,
  reportProgress?: { size: number; reporter: (progress: number) => void }
): Promise<string> =>
  new Promise((resolve, reject) => {
    let parsedString = "[";
    let first = true;
    parse(input, {
      header: false,
      skipEmptyLines: true,
      chunk: (chunk) => {
        let parsedChunk = "";
        if (first) {
          first = false;
        } else {
          parsedString += ",";
        }
        parsedChunk += JSON.stringify(chunk.data);
        try {
          parsedString += parsedChunk.slice(1, -1);
        } catch (err) {
          console.log(`Truncated dataset at ${chunk.meta.cursor} bytes.`);
          parsedString = parsedString.slice(0, -1);
          return;
        }
        reportProgress?.reporter(
          Math.round((chunk.meta.cursor / reportProgress.size) * 100)
        );
      },
      complete: () => {
        parsedString += "]";
        resolve(parsedString);
      },
      error: (err) => reject(err),
      worker: true,
    });
  });
