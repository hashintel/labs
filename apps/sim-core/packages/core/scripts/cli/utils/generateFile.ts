import { existsSync, mkdirSync, writeFileSync } from "fs";
import { extname, join, relative } from "path";
import { format } from "prettier";

type NameContentTuple = [string, string];
type FileGenerator = (pair: NameContentTuple) => void;
type FileGeneratorContext = {
  dryRun: boolean;
  verbose: boolean;
  componentDir: string;
};
type FileGeneratorFactory = (ctx: FileGeneratorContext) => FileGenerator;

/**
 * `generateFile` takes in a `FileGeneratorContext` (`dryRun` and `verbose`
 * flags, and a `componentDir`) and returns a function that takes a `name` and
 * `content` tuple and formats the content before writing the file to disk (or
 * not depending on the flags in context)
 *
 * it does not write over existing files
 */
export const generateFile: FileGeneratorFactory = ({
  dryRun = false,
  verbose = false,
  componentDir,
}) => ([fileName, content]) => {
  const filePath = join(componentDir, fileName);

  const relPath = relative(process.cwd(), filePath);
  const ext = extname(filePath).substr(1);

  const fileContent = format(content, {
    parser: ext === "css" ? "css" : "babel",
  });

  if (!existsSync(componentDir)) {
    mkdirSync(componentDir);
  }

  if (existsSync(filePath) && !dryRun) {
    console.warn(
      `file already exists at \`${relPath}\` ${
        dryRun ? "will skip" : "skipping"
      }`
    );
    return;
  }

  if (verbose || dryRun) {
    console.log(`\
${dryRun ? "will write" : "writing"} file to:
\`${relPath}\`

with \`${ext}\` contents:
${fileContent}
`);
  }

  if (!dryRun) {
    writeFileSync(filePath, fileContent);
  }
};
