# Petrinaut x Patchwork

## Installation

Clone patchwork & build it

```
git clone git@github.com:inkandswitch/patchwork.git
cd patchwork
pnpm install
pnpm build
```

Link patchwork cli

```
cd patchwork-cli
yarn link
```

In `petrinaut-patchwork` update `@patchwork/sdk` in `package.json` to point to where you've cloned
the patchwork repo in step 1

```
{
  "name": "@patchwork/petrinaut",
  "version": "0.0.1",
  "description": "Petrinaut – Petri Net editor",
  "type": "module",
  "main": "src/index.ts",

   // ....


  "dependencies": {

     // ...

     // this path needs to point

    "@patchwork/sdk": "file:../../../patchwork/sdk",


    // ...
  },

 // ...
}
```

Finally you can push the petrinaut tool with

```
yarn push
```

Or you can watch continously with

```
yarn watch
```

You don't need to run patchwork locally you can add the petrinaut tool to your profile on `patchwork.inkandswitch.com` by following these steps:

![alt text](<Screenshot 2025-08-29 at 15.58.13.png>)
