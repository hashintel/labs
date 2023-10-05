module.exports = {
  launch: {
    // dumpio: true, // uncomment this to view the console in the terminal
    headless: process.env.HEADLESS !== "false",
    slowMo: process.env.SLOWMO && 250,
    product: "chrome",
    defaultViewport: {
      // width: 2560, // MBP 13"
      // height: 1440 // MBP 13"
      width: 1920,
      height: 1080
    },
    timeout: process.env.SLOWMO ? 90000 : 60000
    // List of args: https://peter.sh/experiments/chromium-command-line-switches/
    // args: [
    //   '--no-sandbox',
    //   "--disable-dev-shm-usage"
    // ]
  },
  browserContext: "default"
};
