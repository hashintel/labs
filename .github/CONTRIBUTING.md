# Contributing

Thanks for taking the time to contribute! 🎉 We've established a set of [community guidelines](https://hash.ai/legal/trust-safety/community?utm_medium=organic&utm_source=github_readme_labs-repo_dot-github-contributing-guide) to enable as many people as possible to contribute to and benefit from HASH. Please follow these when interacting with this repo.

If you'd like to make a significant change or re-architecture to this repository or any project within, please first open a [discussion](https://github.com/hashintel/labs/discussions) or create an [issue](https://github.com/hashintel/labs/issues) to get feedback before spending too much time.

We also have a developer website at [hash.dev](https://hash.dev/?utm_medium=organic&utm_source=github_readme_labs-repo_dot-github-contributing-guide), containing developer tutorials, guides and other resources

## About this repo

This repository is HASH's `labs` monorepo. It contains [a varied mix](README.md) of experimental projects, each with its own [license](LICENSE.md) and contribution policies which may vary slightly.

To ascertain the license and contributing policy for a given project, check out the `LICENSE.md` and `CONTRIBUTING.md` files in the project's root.

## Common contribution processes

These apply across all projects:

- Before undertaking any significant work, please share your proposal with us: we don't want you to invest your time on changes we are already working on ourselves, or have different plans for. You can suggest changes as a [discussion](https://github.com/hashintel/labs/discussions) if it's a feature proposal, or an [issue](https://github.com/hashintel/labs/issues) if it's a bug you intend to fix. If it's a typo or minor docs change, you can always open a PR directly (don't worry about this step).
- When submitting a pull request, please fill out any sections of the provided template you feel able to. If you are unsure or don't feel a section is relevant, please say so.
  - Always include a link to the issue or discussion proposing the change.
  - Write tests to accompany your PR, or ask for help/guidance if this is a blocker.
  - Make sure that your PR doesn’t break existing tests.
  - The repository follows a set of linting rules. Many of them can be applied automatically by running `yarn install` and `yarn fix`.
  - Sign our _Contributor License Agreement_ at the CLA Assistant's prompting. (To learn more, read [why we have a CLA](https://hash.ai/legal/developers/contributing?utm_medium=organic&utm_source=github_readme_labs-repo_dot-github-contributing-guide))
- Once you have receive a pull request review, please bear the following in mind:
  - reviewers may make suggestions for _optional_ changes which are not required to get your code merged. It should be obvious which suggestions are optional, and which are required changes. If it is not obvious, ask for clarification.
  - please do not resolve comment threads unless you opened them - leave it to the person who raised a comment to decide if any further discussion is required (GitHub will also automatically resolve any code suggestions you click 'commit' on). Comment threads may also be left open so that they can be linked to later.

## How can I find interesting PRs to work on?

Existing issues can provide a good source of inspiration for potential contributions. The issue tags `E-help-wanted` and `E-good-first-issue` flag some of the lower-hanging fruit that are available for people (including first-time contributors) to work on, without necessarily requiring prior discussion. You should also feel free to [reach out directly](https://hash.ai/contact?utm_medium=organic&utm_source=github_readme_labs-repo_dot-github-contributing-guide) to us for more inspiration. If you're willing to contribute, we'd love to have you!

## Why might contributions be rejected?

There are a number of reasons why otherwise sound contributions might not find their way into the `main` branch of our repo. Ultimately, we reserve the right to reject PRs for any reason. In a bid to minimize wasted time and effort, here are some possible reasons for rejection:

- **PRs that introduce new functionality without proper tests will not be accepted.** You should write meaningful tests for your code.
- **PRs that fail to pass tests will not be merged.** If your PR doesn’t pass our Continuous Integration tests, it won’t be merged.
- **PRs that duplicate functionality which already exist in HASH, but outside of the project you're introducing them in.** For example, recreating functionality provided in one package directly within another.
- **PRs that duplicate workstreams already under development at HASH** may be rejected, or alternatively integrated into working branches other than those intended by the contributor. For more on these, see our [public roadmap](https://hash.dev/roadmap?utm_medium=organic&utm_source=github_readme_labs-repo_dot-github-contributing-guide).
- **PRs that add functionality that is only useful to a subset of users**, which may increase maintenance overheads on the product. We know it can be frustrating when these sorts of PRs are rejected, and it can sometimes seem arbitrary. We’ll do our best to communicate our rationale clearly in such instances and are happy to talk it out. It's impossible to forecast all of the possible use-cases of a product or feature, and we try to keep an open posture towards such contributions.
- **PRs that introduce architectural changes to the project** (without prior discussion and agreement) will be rejected.
- **PRs that don’t match the syntax, style and formatting of the project will be rejected.** See: _maintainability_.

## Can I work for HASH full-time?

We're recruiting for a number of full-time roles. If you've already contributed to this repo or our [primary `hash` monorepo](https://github.com/hashintel/hash), mention this in your application. View our open roles at [hash.ai/careers](https://hash.ai/careers?utm_medium=organic&utm_source=github_readme_labs-repo_dot-github-contributing-guide) and drop your name in the pool even if you can't see a good fit right now.
