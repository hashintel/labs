import type { Plugin } from "vite";

export function singleFile(): Plugin {
  return {
    name: "single-file",
    apply: "build",
    enforce: "post",
    config: () => ({
      base: "./",
      build: {
        assetsInlineLimit: () => true,
        assetsDir: "",
        cssCodeSplit: false,
        modulePreload: false,
        chunkSizeWarningLimit: 10000,
        rolldownOptions: { output: { codeSplitting: false } },
      },
    }),
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (html?.type !== "asset") {
        this.error("single-file build requires index.html");
      }
      html.source = html.source.toString()
        .replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/gu, (_tag, url: string) => {
          const file = url.replace(/^\.\//u, "");
          const script = bundle[file];
          if (script?.type !== "chunk") this.error(`script ${file} is missing from the bundle`);
          const code = script.code
            .replace(/"?__VITE_PRELOAD__"?/gu, "void 0")
            .replace(/<(\/script|!--)/giu, "\\x3C$1");
          delete bundle[file];
          return `<script type="module">${code}</script>`;
        })
        .replace(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/gu, (_tag, url: string) => {
          const file = url.replace(/^\.\//u, "");
          const css = bundle[file];
          if (css?.type !== "asset") this.error(`stylesheet ${file} is missing from the bundle`);
          delete bundle[file];
          return `<style>${css.source.toString()}</style>`;
        });
      const remaining = Object.keys(bundle).filter((file) => file !== "index.html");
      if (remaining.length > 0) this.error(`single-file build has external assets: ${remaining.join(", ")}`);
    },
  };
}
