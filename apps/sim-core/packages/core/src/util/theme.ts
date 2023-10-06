type Theme = { [key: string]: string };
type ThemeNumber = { [key: string]: number };

// export to the JS world for easy reference:
export const theme: Theme = {
  // The dark/light palette:
  white: "#ffffff",
  "light-grey": "#f1f3f6",
  grey: "#dbe0e3",
  "grey-alt": "#9aa1a5",
  dark: "#1b1d24",
  "dark-transparent": "#1b1d2400",
  "light-on-dark": "#34353A",
  "dark-grey": "#6C6E78",
  darkest: "#10101b",
  black: "#000000",
  translucent: "#ffffff99",
  "translucent-dark": "#000000e6",
  "dark-hover": "#262631",
  "dark-hover-transparent": "#26263100",

  // Sometimes dark-hover is the normal color – so we need a hover color
  "dark-hover-hover": "#31323D",
  "dark-hover-hover-transparent": "#31323D00",

  // border colors
  "dark-border": "#494a50",
  border: "#393a3b",
  "border-hover": "#494a4b",
  "border-drag": "#595a5b",
  "input-border": "#313131",

  // The prime colors:
  purple: "#5f47ff",
  "purple-hover": "#7c68ff", // hover state for elements using above 'purple'
  "purple-light": "#8371ff", // typically use on dark backgrounds only
  blue: "#1e77ff",
  "blue-translucent": "rgba(30, 119, 255, 0.4)",
  "blue-hover": "#3D8AFF",
  "light-blue": "#2482FF",
  pink: "#ff47ac",

  // Context colors. -alt shades for use in darker contexts.
  green: "#0fac33", // Success, completion
  "green-translucent": "rgba(15, 172, 51, 0.4)",
  "green-alt": "#2ab967",
  yellow: "#e49f01", // Warning/Alert
  "yellow-alt": "#fbbb2a",
  "yellow-hover": "#d9aa41",
  turqoise: "#0eb3de",
  "turqoise-alt": "#59c5e1",
  red: "#f51624", // Problem/Error
  "red-translucent": "rgba(245, 22, 36, 0.4)",
  "red-alt": "#ff4b56",
  orange: "#e85300",
  "orange-alt": "#f96c41",

  // Old palette colors (deprecated)
  "blood-orange": "#d83f11",
  "hot-pink": "#f10040",
};

/**
 * These are all aliases – you should probably use the original names
 */
Object.assign(theme, {
  "editor-background": theme.dark,
  "editor-background-highlight": theme["dark-hover"],
  "modal-border": theme.dark,
});

// This is a lossy conversion. Not all colours available in theme are available in themeNumbers
// Specifically, translucent black colours are not available as,
// for example, 0x000000e6 and 0x0000e6 are the same number
export const themeNumbers: ThemeNumber = Object.fromEntries(
  Object.entries(theme).map(([key, value]) => [
    key,
    parseInt(value.substr(1), 16),
  ])
);
