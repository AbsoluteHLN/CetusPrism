/** Vite's css-modules and `?inline` transforms have no static types; these
 * ambient declarations type the stylesheet imports in this package. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css?inline' {
  const source: string
  export default source
}
