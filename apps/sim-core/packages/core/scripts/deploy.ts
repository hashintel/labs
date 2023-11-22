// Requires awscli & proper credentials to be installed in your console session.
// Invoke this script with 'npm run deploy' or 'npx ts-node deploy.ts'

/// <reference types="./types" />

import randomEmoji from "random-emoji";
import request from "request-promise-native";
import { cat, config, echo, exec, ls, which } from "shelljs";
import { trimStart } from "lodash";

const logging_prefix: string = randomEmoji
  .random({ count: 2 })
  .map((emoji: any) => emoji.character)
  .join("");

const S3_BUCKET = "core.hash.ai";

const userName = (
  exec(`git config --global --get user.name`).stdout || exec(`whoami`).stdout
).trim();

function getNotifier(notifySlack: boolean) {
  if (!notifySlack) {
    echo("Running Silent.");
  }
  return async (message: string) => {
    echo(message);

    if (notifySlack) {
      await request.post(
        "https://hooks.slack.com/services/T5Z49HZPW/B01QB9PQNE8/4Ur5MWKteJFdxvGYCCxiD",
        { json: { text: `${logging_prefix} ${message}` } },
      );
    }
  };
}

/**
 * Builds assets from our environment and uploads to S3.
 *
 * @return {string} The build stamp
 */
async function buildAndStageAssets(): Promise<string> {
  // 1. clean build:
  exec("yarn clean");
  exec("yarn build");

  // 2. sync to bucket
  // find our manifest file:
  const manifests = ls("dist/**/manifest.json");
  echo("Found manifest", JSON.stringify(manifests));
  if (manifests.length > 1) {
    throw "Found multiple manifest files, Aborting.";
  }
  if (manifests.length === 0) {
    throw "Couldn't find a manifest.";
  }
  const manifest = JSON.parse(cat(manifests[0]));
  if (!manifest?.BUILD_STAMP) {
    throw "Build stamp not found in manifest, aborting.";
  }
  const stamp = manifest.BUILD_STAMP;

  echo("Build stamp is", stamp);

  exec(`rm -rf dist/${stamp}/*.js.map`);

  // 3. upload everything in our build folder to s3:
  exec(`aws s3 sync dist/${stamp}/ s3://${S3_BUCKET}/${stamp}/`);

  // S3 infers wasm mime types wrong, so fix them:
  Object.keys(manifest)
    .filter((key) => key.endsWith(".wasm"))
    .forEach((key) => {
      echo("Correcting mime type for", key);
      const wasm = trimStart(manifest[key], "/");
      const s3Path = `s3://${S3_BUCKET}/${wasm}`;

      // Copy the wasm file onto itself so we can mutate its metadata to set content-type wasm
      exec(
        `aws s3 cp ${s3Path} ${s3Path} --content-type application/wasm --metadata-directive REPLACE`,
      );

      // Check our work:
      exec(`aws s3api head-object --bucket ${S3_BUCKET} --key ${wasm}`);
    });

  // 4. Notify relevant apps:
  // (nothing to do at the moment)

  return stamp;
}

/**
 * Sets {stamp} as the live version. Invoke from the repo root like:
 *
 * ```sh
 * yarn deploy:core live {stamp}
 * ```
 *
 * S3 routes everything to /index.html, and so does cloudfront. The index.html
 * file we generate is path-aware; it expects /{stamp} to exist with all its
 * assets. In this manner, everyone will route by default to index.html, and
 * any specialist can go to {stamp}/index.html to load up that version instead
 * (Need to do this manually? The command is:
 *
 * ```sh
 * aws s3 cp s3://core.hash.ai/{stamp}/index.html s3://core.hash.ai/index.html
 * ```
 *
 * @param stamp -- build stamp to deploy (should already be present in s3)
 */
async function setLive(stamp: string) {
  const rootIndexPath = `s3://${S3_BUCKET}/index.html`;
  const manifestIndexPath = `s3://${S3_BUCKET}/${stamp}/index.html`;
  const rootEmbedPath = `s3://${S3_BUCKET}/embed.html`;
  const manifestEmbedPath = `s3://${S3_BUCKET}/${stamp}/embed.html`;

  try {
    exec(
      `aws s3api head-object --bucket ${S3_BUCKET} --key ${stamp}/index.html`,
    );
  } catch (err) {
    console.error("Build stamp not found in s3", stamp);
    process.exit(1);
  }
  exec(
    `aws s3 cp ${manifestIndexPath} ${rootIndexPath} --cache-control no-cache --content-type text/html --metadata-directive REPLACE`,
  );

  // Older builds may not have an embed.html (linked to when embedding hCore)
  try {
    exec(
      `aws s3 cp ${manifestEmbedPath} ${rootEmbedPath} --cache-control no-cache --content-type text/html --metadata-directive REPLACE`,
    );
  } catch (err) {
    console.warn("*** Build does not contain an embed.html! ***");
  }
}

async function run() {
  // Shelljs is awesome, docs here: https://github.com/shelljs/shelljs
  config.fatal = true; // raise an exception if a shell command errors out

  if (!which("aws")) {
    console.error("AWS CLI not found, aborting.");
    process.exit(1);
  }

  // If arg is 'silent', don't tell Slack about what's going on.
  // Only works for non-live deploys;  live deployments always notify.
  const notify = getNotifier(process.argv[2] !== "silent");

  try {
    const live = process.argv[2] === "live";
    if (live) {
      const stamp = process.argv[3];
      if (!stamp) {
        throw "Usage: deploy live <buildStamp>";
      }
      setLive(stamp);
      await notify(`Live version now set to \`${stamp}\` by ${userName}`);
      await notify(`Permalink: \`https://core.hash.ai/${stamp}/index.html\``);
    } else {
      const head = exec("git rev-parse HEAD").stdout.trim();
      const commitUrl = `https://github.com/hashintel/internal/commit/${head}`;
      const localChanges = exec("git status --porcelain").stdout !== "";
      const stamp = await buildAndStageAssets();
      console.log("Staged: ", stamp);
      // Notify slack that the version is staged:
      await notify(
        [
          `${userName} staged \`${stamp}\``,
          `Preview at: \`https://staging.hash.ai/${stamp}/index.html\``,
          `Built from: \`${commitUrl}\` ${
            localChanges ? "(plus local modifications)" : ""
          }`,
        ].join("\n"),
      );
    }
  } catch (err) {
    console.error(`Deploy failed with error:`);
    console.error("```" + err.toString() + "```");
    process.exit(1);
  }
}

run();
