// Copyright 2026 Z.AI Co., Ltd. — adapted from ZCode scripts/zcode-distribution/installer.mjs (Apache-2.0)
//
// 生成 install.sh：拉 <BASE_URL>/latest.json → 下载 tarball → 校验 sha256 →
// 解压安装到 ~/.zclaudia/runtime → 在 bin 目录建 zclaudia 命令。
// 下载根地址可用环境变量覆盖；安装位置同理：
//   ZCLAUDIA_DIST_BASE_URL  下载根（构建时也可用 --base-url 写死默认值）
//   ZCLAUDIA_DIST_HOME      安装根（默认 ~/.zclaudia/runtime）
//   ZCLAUDIA_DIST_BIN_DIR   命令目录（默认 ~/.local/bin）
//
// 用法:
//   node scripts/distribution/installer.mjs [--base-url <url>] [--out <file>]
// 不带 --out 时写到 stdout。build.mjs 以模块方式 import installScriptSource 生成发行包的
// install.sh；本 CLI 供单独生成/调试用。
//
// 与 ZCode 原版的适配差异：
// - 新增 sha256 校验（原版 install.sh 不校验，本任务规格要求）：sha256sum（Linux）与
//   shasum -a 256（macOS）二选一。
// - 包名/命令名/默认安装路径换成 zclaudia（~/.zclaudia/runtime）。
// - BASE_URL 未配置时给出明确报错而不是静默拉空地址。

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const packageDirName = 'zclaudia';

export function installScriptSource(baseUrl) {
  return `#!/usr/bin/env sh
set -eu

BASE_URL="\${ZCLAUDIA_DIST_BASE_URL:-${baseUrl}}"
INSTALL_DIR="\${ZCLAUDIA_DIST_HOME:-$HOME/.zclaudia/runtime}"
BIN_DIR="\${ZCLAUDIA_DIST_BIN_DIR:-$HOME/.local/bin}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "zclaudia install requires $1" >&2
    exit 1
  fi
}

need_cmd node
need_cmd curl
need_cmd tar
if command -v sha256sum >/dev/null 2>&1; then
  sha256_file() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  echo "zclaudia install requires sha256sum or shasum" >&2
  exit 1
fi

if [ -z "$BASE_URL" ]; then
  echo "Set ZCLAUDIA_DIST_BASE_URL to the distribution download root" >&2
  exit 1
fi

LATEST_JSON="$(curl -fsSL "\${BASE_URL%/}/latest.json")"
VERSION="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).version))")"
TARBALL="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).tarball))")"
EXPECTED_SHA256="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).sha256))")"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCHIVE="$TMP_DIR/$TARBALL"
curl -fL "\${BASE_URL%/}/releases/$VERSION/$TARBALL" -o "$ARCHIVE"

ACTUAL_SHA256="$(sha256_file "$ARCHIVE")"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "sha256 mismatch for $TARBALL" >&2
  echo "  expected: $EXPECTED_SHA256" >&2
  echo "  actual:   $ACTUAL_SHA256" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR/releases" "$BIN_DIR"
TARGET="$INSTALL_DIR/releases/$VERSION"
rm -rf "$TARGET.new"
mkdir -p "$TARGET.new"
tar -xzf "$ARCHIVE" -C "$TARGET.new"
rm -rf "$TARGET"
mv "$TARGET.new/${packageDirName}" "$TARGET"
rm -rf "$TARGET.new"
ln -sfn "$TARGET" "$INSTALL_DIR/current"

cat > "$BIN_DIR/zclaudia" <<SH
#!/usr/bin/env sh
exec node "$INSTALL_DIR/current/bin/zclaudia.mjs" "\\$@"
SH
chmod +x "$BIN_DIR/zclaudia"

echo "zclaudia $VERSION installed."
echo "Run: zclaudia --web"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not in PATH." ;;
esac
`;
}

async function main() {
  const argv = process.argv.slice(2);
  let baseUrl = process.env.ZCLAUDIA_DIST_BASE_URL?.trim() || '';
  let out = undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      if (arg.includes('=')) return arg.slice(arg.indexOf('=') + 1);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };
    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/distribution/installer.mjs [--base-url <url>] [--out <file>]'
      );
      return;
    }
    if (arg === '--base-url' || arg.startsWith('--base-url=')) {
      baseUrl = readValue();
      continue;
    }
    if (arg === '--out' || arg.startsWith('--out=')) {
      out = readValue();
      continue;
    }
    throw new Error(`Unknown option "${arg}"`);
  }

  const script = installScriptSource(
    baseUrl ? (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`) : baseUrl
  );
  if (out) {
    const { writeFile, chmod } = await import('node:fs/promises');
    await writeFile(out, script);
    await chmod(out, 0o755);
    console.log(`install.sh written to ${out}`);
  } else {
    process.stdout.write(script);
  }
}

// 作为 CLI 直接运行时才执行 main；被 build.mjs import 时不执行。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
