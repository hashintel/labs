import { camelCase, upperFirst } from "lodash";
import { join } from "path";

import {
  componentTemplate,
  iconTemplate,
  indexTemplate,
  styleTemplate,
  testTemplate,
} from "./templates";
import { generateFile, parseIcon } from ".";

type FilesGenerator = (name: string) => void;
interface FilesGeneratorContext {
  dryRun: boolean;
  verbose: boolean;
  isValidIcon: boolean;
  fromIcon?: string;
}
type FilesGeneratorFactory = (ctx: FilesGeneratorContext) => FilesGenerator;

const pascalCase = (words: string) => upperFirst(camelCase(words));
const componentsDir = join(__dirname, "../../../src/components");

/**
 * `generateFiles` takes in a `FilesGeneratorContext` (`dryRun` and `verbose`
 * flags, an `isValidIcon` flag and optional `fromIcon` path [if `isValidIcon`
 * is `true`]) and returns a function that takes in a (component) `name` and
 * does some normalization on it (pascal case, inserting "Icon" if it's an icon)
 * and figures out what files to generate, passing the `filePath` and
 * `fileContent` pairs off to `generateFile` in the end
 *
 * @see ./generateFile.ts
 */
export const generateFiles: FilesGeneratorFactory =
  ({ dryRun = false, verbose = false, isValidIcon, fromIcon }) =>
  (name) => {
    const folderName = pascalCase(name);
    const componentName = `${isValidIcon ? "Icon" : ""}${folderName}`;
    const componentDir = join(
      componentsDir,
      isValidIcon ? "Icon" : "",
      folderName,
    );

    const styleFileName = `${componentName}.css`;
    const styleFileContent = styleTemplate(componentName);

    const testFileName = `${componentName}.spec.tsx`;
    const testFileContent = testTemplate(componentName);

    const componentFileName = `${componentName}.tsx`;
    const componentFileContent = isValidIcon
      ? iconTemplate(componentName, ...parseIcon(fromIcon!, componentName))
      : componentTemplate(componentName);

    const indexFileName = "index.ts";
    const indexFileContent = indexTemplate(componentName);

    Object.entries({
      ...(isValidIcon
        ? {}
        : {
            [styleFileName]: styleFileContent,
          }),
      [testFileName]: testFileContent,
      [componentFileName]: componentFileContent,
      [indexFileName]: indexFileContent,
    }).forEach(generateFile({ dryRun, verbose, componentDir }));
  };
