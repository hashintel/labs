import { sample } from "lodash";

import { theme } from "../../../src/util/theme";

/**
 * give the new component one of our brighter theme colors to make it stand out
 */
const themeColors = Object.keys(theme)
  .filter((key) => key.match(/white|grey|dark|black/) === null)
  .map((key) => `--theme-${key}`);

/**
 * @param name - the PascalCase'd name of the generated component
 */
export const styleTemplate = (name: string) => `\
.${name} {
  background: var(${sample(themeColors)});
}
`;

/**
 * the test just asserts that this new component renders without crashing, sort
 * of a `noop` but it will break as soon as you add any props to your component
 *
 * @param name - the PascalCase'd name of the generated component
 */
export const testTemplate = (name: string) => `\
import React from "react";
import ReactDOM from "react-dom";

import { ${name} } from "./${name}";

it("renders without crashing", () => {
  const div = document.createElement("div");
  ReactDOM.render(<${name} />, div);
  ReactDOM.unmountComponentAtNode(div);
});
`;

/**
 * generates a generic functional component with an empty props type, stylesheet
 * and `className` wired up
 *
 * @param name - the PascalCase'd name of the generated component
 */
export const componentTemplate = (name: string) => `\
import React, { FC } from "react";

import "./${name}.css";

type ${name}Props = {};

export const ${name}: FC<${name}Props> = () => <div className="${name}" />;
`;

/**
 * generates an icon component in "../../src/components/Icon"
 *
 * @param name - the PascalCase'd name of the generated component (should be
 * like `IconWhatever`)
 * @param size - the largest of either the width or height of the icon
 * relies on `preserveAspectRatio` defaulting to `xMidYMid meet`
 * @param jsx - the `jsx` of the icon (generated from `svg` source via
 * `@svgr/core`)
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/preserveAspectRatio
 * @see ./parseIcon.ts
 */
export const iconTemplate = (name: string, size: number, jsx: string) => `\
import React, { FC } from "react";

import { IconProps } from "..";
import "../Icon.css";

export const ${name}: FC<IconProps> = ({ size = ${size} }) => ${jsx}
`;

/**
 * the reexporting index.ts that makes our "component folder pattern" work
 *
 * @param name - the PascalCase'd name of the generated component
 */
export const indexTemplate = (name: string) => `\
export { ${name} } from "./${name}";
`;
