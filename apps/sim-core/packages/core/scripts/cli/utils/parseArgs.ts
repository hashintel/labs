import yargs from "yargs";
import { hideBin } from "yargs/helpers";

export const parseArgs = () =>
  yargs(hideBin(process.argv))
    .options({
      dryRun: {
        alias: ["dry-run", "n"],
        type: "boolean",
        default: false,
      },
      verbose: {
        alias: "V",
        type: "boolean",
        default: false,
      },
      fromIcon: {
        alias: ["from-icon", "i"],
        type: "string",
        normalize: true,
      },
    })
    .help("help")
    .alias("help", "h")
    .version(false)
    .parseSync();
