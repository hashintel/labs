# SGAI agentic planning demo

This is an implementation POC and interactive CLI demo of our "R&D Planning Prototype", to accompany our report of the same title.

## Quickstart

Once you have cloned this repository to your machine and you have the prerequisites (see below), please open the `./pocs/sgai-agent-planner/` subdirectory in your terminal and execute the following command:

```sh
bun run demo:plan
```

## Prerequisites

- Node.js runtime v22+
- Bun package manager
- OpenRouter API key (for Google models)

  ```sh
  # in your shell profile, e.g. `.bashrc` or `.zshrc`
  export OPENROUTER_API_KEY='<your_api_key_here>'
  ```
