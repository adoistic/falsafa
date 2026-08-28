// hls.js 1.6.x ships no `types` condition on its "./light" export.
declare module "hls.js/light" {
  export * from "hls.js";
  export { default } from "hls.js";
}
