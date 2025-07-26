# HASH End to End tests

## Motivations
As stated on the [UAT](https://www.notion.so/hashintel/UAT-b7669b7465a14c919b7f403faac97f2f) page in Notion, 

> The purpose of UAT is to avoid breaking changes making it through deployment to the live site, and to periodically ensure that everything is working as intended
> Our goal is to maintain uptime for HASH users, and ensure a bug free app. Ultimately we only want to deploy well-tested code with no side-effects to prod.

This repo contains End to End tests that help achieve this goal.

## Technical decisions

### Puppeteer
Puppeteer was chosen since is “just” a tool for controlling a Chrome browser, and makes no assumptions about how it’s integrated into a testing environment.
This allows us to refactor tests as the product grows to better accommodate it.

## How to run these tests?
Assuming you are standing at the same level as this README, replace `TEST_ACCOUNT_EMAIL` and `TEST_ACCOUNT_PASSWORD` from the following command
```
npm i && TEST_ACCOUNT_EMAIL="anyAccountThatIsNot@hash.com" TEST_ACCOUNT_PASSWORD="ThePassword" API_URL="https://api.hash.ai/graphql" npm test
```

Please note these tests will automatically retry up to (3) times in case of failure. This is due to the nature of E2E tests.

## How are tests organized?
Our tests are located under the `e2e` folder. We use sub-folders to group tests by kind. An example is the "sanity_checks" folder.

Each folder contains as many name.test.js files as needed, which in turn have 1 describe (Test Suite) per file.

On the top of each test file you'll find comments explaining what is being tested to help contributors quickly understand what's going on. 
PLEASE keep them updated.

## Development notes
You can change the `jest-puppeteer.config.js` or use the following env vars to change the behavior of the tests

- HEADLESS=true : visualize what the test is doing.
- SLOWMO=true : reduces the playback speed of the browser so you can catch CSS/JS glitches more easily
- TEST_ACCOUNT_EMAIL : the email used to log in. Please make sure it is NOT an HASH account since we have code that treats those accounts differently.
- TEST_ACCOUNT_PASSWORD : the password used to login.
- API_URL : The API URL. Mostly used to do automated cleanups at the end of the test
- HCORE_URL : The URL to hCore. By default is "https://core.hash.ai"

## Puppeteer basics
You can't access DOM elements directly, since there is a virtual layer between Puppeteer and the DOM. 
To work with DOM elements as usual, you have to run `await page.evaluate(element => element.innerText, yourElementComesHere)`

There are also shorthand methods for this, such as `await page.$eval` and `page.$$eval`;

Whenever possible, you should use `page.waitForSelector` rather than hardcoded `sleep` calls.

The docs are available at https://devdocs.io/puppeteer.

## Puppeteer recorder
Not so long ago, the Chrome DevTools team [released a new Experiment](https://umaar.com/dev-tips/241-puppeteer-recorder/) called "Recorder", 
which allows you to record a browsing session and in return gives you a Puppeteer script that you can use to reproduce the same actions via code.
The generated code is far from perfect but it's an amazing time saver technique. I found it especially useful to interact with elements and 
see what's the best selector without having do use the DevTools and manually copying and pasting.

## Troubleshooting
## Error: Protocol error ($REASON): Target closed.
- You probably forgot to `await` a command in that test.
- You could be using `arrayElem.forEach` instead of `for (let i=0;i<arrayElem.length;i++)`
- You could also be using `page.$` instead of `page.waitForSelector`. The difference is that the former assumes the element is there when called and it fails if it doesn't, while the latter gives it a timeout before giving up searching for it. Whenever possible, try to use `waitForSelector`.
