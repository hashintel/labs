# SGAI agentic planning demo

This is an implementation POC and interactive CLI demo by [HASH](https://hash.ai/) of an "R&D Planning Prototype", to accompany our [Safeguarded AI](https://www.aria.org.uk/opportunity-spaces/mathematics-for-safe-ai/safeguarded-ai/) report of the same title.

## Quickstart

Once you have cloned this repository to your machine and you have the prerequisites (see below), please open the `./pocs/sgai-agent-planner/` subdirectory in your terminal and execute the following command:

```sh
cd pocs/sgai-agent-planner
npm install
npm run demo:plan
```

## Prerequisites

- [Node.js](https://nodejs.org/en/download) v22+
- an OpenRouter API key

  ```sh
  # in your shell profile, e.g. `.bashrc` or `.zshrc`
  export OPENROUTER_API_KEY='<your_api_key_here>'
  ```

## Notes

### On execution and topology internals

The `plan-compiler.ts` and `topology-analyzer.ts` modules are intentionally minimal, as this POC focuses on demonstrating the planning loop rather than robust plan execution. Specifically, the compiler schedules steps correctly according to their dependencies but does not implement true dataflow—steps do not receive aggregated outputs from their declared inputs, and the execution state is not collected or returned. Similarly, the topology analyzer uses a straightforward O(n²) algorithm for computing topological order, which is adequate for the small plans in our fixtures but would need optimization for larger graphs. Both modules assume the plan has already passed validation (particularly cycle detection); they do not defensively re-check invariants. These are reasonable simplifications for a demo that emphasizes plan generation and validation, but readers should be aware that production use would require completing the dataflow plumbing and hardening these utilities.
