import svgr from "@svgr/core";
import { readFileSync } from "fs";

// looks for `viewBox="<any non-quote characters>"` falling back to an empty
// string in the no-match (`match` returns `null`) case
const parseViewBox = (svgStr: string) =>
  (svgStr.match(/viewBox="([^"]*)"/) ?? ["", ""])[1];

const parseRect = (rectStr: string) =>
  rectStr.split(" ").map((number) => parseInt(number, 10));

const maxValue = (values: number[]) =>
  values.reduce((max, number) => Math.max(max, number), 0);

export function parseIcon(path: string, name: string): [number, string] {
  const jsx = svgr.sync(readFileSync(path).toString(), {
    icon: true,
    expandProps: false,
    svgoConfig: {
      plugins: [
        { removeUnusedNS: false },
        { removeAttrs: { attrs: "(fill|stroke)" } },
        { prefixIds: false },
        {
          cleanupIDs: {
            prefix: `${name}__`,
          },
        },
      ],
    },
    svgProps: {
      className: `Icon ${name}`,
    },
    replaceAttrValues: {
      "1em": "{size}",
    },
    plugins: ["@svgr/plugin-svgo", "@svgr/plugin-jsx"],
    template: ({ template }, _, { jsx }) => template.ast`${jsx}`,
  });

  const size = maxValue(parseRect(parseViewBox(jsx)));

  return [size, jsx];
}
