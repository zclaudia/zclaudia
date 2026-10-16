// 仅供 `zclaudia --check --staging-dir` 校验目录结构的最小占位 server 入口。
// 真实发行包里这个位置是 server/scripts/bundle.mjs 的自包含产物（见
// scripts/distribution/build.mjs 的 stagePackage）。
console.log('minimal-staging placeholder server entry');
