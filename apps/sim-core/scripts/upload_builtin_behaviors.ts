/**
 * DEPRECATED: This script uploaded builtin behaviors to the HASH Index.
 * The dev API (devapi.hash.ai) was deprecated in Nov 2022,
 * and the prod API requires authentication.
 * Kept for reference only.
 */
const fs = require("fs");
const yargs = require("yargs");

const options = yargs.options({
  env: {
    alias: ["environment", "env"],
    type: "string",
    default: "dev",
  },
  dryRun: {
    alias: ["dry-run", "n"],
    type: "boolean",
    default: false,
  },
}).argv;

const uploadBehaviorToHASHIndex = async (
  cookie: string,
  behavior_name: string,
  behavior_source: string,
  behavior_slug: string
) => {
  let data = {
    title: behavior_name,
    contentType: "Behavior",
    shortname: behavior_slug,
    behaviorSrc: behavior_source,
    licenseID:
      options.env === "prod"
        ? "5dc3da73cc0cf804dcc66a51"
        : "5dc3da73cc0cf804dcc66a50",
    orgId: "5d24ba74dc27ed00b3137d80",
  };
  console.log(data);

  if (options.env !== "prod") {
    throw new Error(
      "There is no dev API to upload to: https://devapi.hash.ai/graphql was deprecated in Nov 2022"
    );
  }
  const url = "https://api.hash.ai/graphql";

  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `connect.sid=${cookie}`,
    },
    body: JSON.stringify({
      query: `mutation addIndexListing($data: IndexListingCreationInput!) { 
  addIndexListing(data: $data) {
    id
  }
}`,
      variables: {
        data,
      },
    }),
  };

  if (options.dryRun) {
    console.log(`Requesting ${JSON.stringify(requestOptions, null, 2)}`);
  } else {
    const resp = await fetch(url, requestOptions);
    const body = await resp.text();
    console.log(behavior_name, resp.status);
    console.log(body);
  }
};

const snakeToTitleCase = (input: String) => {
  let new_str = "";
  let sw = false;
  for (let char of input) {
    if (!sw) {
      new_str += char.toUpperCase();
      sw = true;
    } else if (char !== "_") {
      new_str += char.toLowerCase();
    } else {
      sw = false;
      new_str += " ";
    }
  }
  return new_str;
};

fs.readdir("builtin_behaviors", {}, (err: any, files: string[]) => {
  let cookie = process.env["HASH_COOKIE"];

  if (!cookie) {
    console.error("Couldn't find hash cookie");
    return;
  }

  for (const file of files) {
    if (file === "mod.rs" || file === "builtin.rs") continue;
    let behavior_name = file.split(".")[0];
    let behavior_slug = file;
    fs.readFile(`builtin_behaviors/${file}`, {}, (err: any, data: any) => {
      if (err) throw err;
      uploadBehaviorToHASHIndex(
        cookie!,
        snakeToTitleCase(behavior_name),
        data.toString(),
        behavior_slug
      );
    });
  }
});
