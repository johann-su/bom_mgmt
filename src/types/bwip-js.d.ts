// bwip-js only publishes its typings under the "browser"/"node" export
// conditions, which TypeScript's "bundler" resolution doesn't apply. Declare
// the slice the app uses (label-render.ts); both builds export it.
declare module "bwip-js" {
  export function toSVG(opts: {
    bcid: string;
    text: string;
    paddingwidth?: number;
    paddingheight?: number;
  }): string;
  // Module matrix (2D: pixx × pixy) or bar/space widths in modules (1D: sbs).
  export function raw(
    bcid: string,
    text: string,
    options: string,
  ): { pixx?: number; pixy?: number; sbs?: number[] }[];
}
