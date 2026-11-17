import { packager } from "@electron/packager";

const outputPaths = await packager({
  dir: process.cwd(),
  name: "Gengce",
  appVersion: "0.1.0",
  platform: "win32",
  arch: "x64",
  out: process.env.DESKTOP_RELEASE_DIR ?? "release",
  overwrite: true,
  asar: true,
  extraResource: ["data/soil/hubei/soil-hubei"],
  prune: false,
  download: {
    mirrorOptions: {
      mirror: process.env.ELECTRON_MIRROR ?? "https://npmmirror.com/mirrors/electron/"
    }
  },
  ignore: [
    /^\/release($|\/)/,
    /^\/release-update($|\/)/,
    /^\/src($|\/)/,
    /^\/server($|\/)/,
    /^\/tests($|\/)/,
    /^\/scripts($|\/)/,
    /^\/docs($|\/)/,
    /^\/test-results($|\/)/,
    /^\/\.edge-profile/,
    /^\/data($|\/)/,
    /^\/\.git($|\/)/,
    /^\/\.env$/,
    /^\/node_modules($|\/)/,
    /^\/pnpm-lock\.yaml$/,
    /^\/tsconfig.*/,
    /^\/vite\.config\.ts$/,
    /^\/index\.html$/
  ],
  win32metadata: {
    CompanyName: "耕策",
    FileDescription: "面向家庭农场与合作社的农业 Agent 助手",
    ProductName: "耕策"
  }
});

console.log(outputPaths.join("\n"));
