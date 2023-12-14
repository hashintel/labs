declare module "@svgr/core" {
  export function sync(
    code: string,
    opts: Partial<{
      // @see: https://www.smooth-code.com/open-source/svgr/docs/options/
      configFile: string;
      ext: string;
      icon: boolean;
      native: boolean | { expo: true };
      dimensions: boolean;
      expandProps: "start" | "end" | false;
      prettier: boolean;
      prettierConfig: Record<string, any>;
      svgo: boolean;
      svgoConfig: {
        plugins: Record<string, any>[];
      };
      ref: boolean;
      replaceAttrValues: Record<string, string>;
      svgProps: Record<string, string>;
      title: boolean;
      template: ({ template }: any, _: any, { jsx }: any) => string;
      // only partially documented, but necessary
      // @see: https://www.smooth-code.com/open-source/svgr/docs/node-api/#plugins
      plugins: string[];
    }>,
  ): string;
}
declare module "random-emoji";
