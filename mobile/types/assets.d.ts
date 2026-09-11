/** Metro resolves font files as modules; TypeScript needs to be told. */
declare module '*.ttf' {
  const asset: number;
  export default asset;
}
