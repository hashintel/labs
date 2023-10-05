// preinstall.js runs prior to population of npm modules,
// therefore it's limited to simple .js and no supporting libraries.
// Try to keep this file small and do real scripting work in the neighboring .ts files.

// Assert that nobody accidentally used npm instead of yarn:
const execPath = process.env.npm_execpath;
if (!execPath.includes("yarn")) {
  console.error("*********************************************");
  console.error("* Please install and use Yarn.              *");
  console.error("* https://yarnpkg.com/lang/en/docs/install/ *");
  console.error("*********************************************");
  console.error("");
  process.exit(1);
}
