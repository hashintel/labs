import yargs from "yargs";

export const parseArgs = () =>
  yargs
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
    .version(false).argv;
