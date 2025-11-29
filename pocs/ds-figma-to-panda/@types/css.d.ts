declare module '*.css' {
  const css: string;
  export default css;
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
