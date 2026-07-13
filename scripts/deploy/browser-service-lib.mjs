export function requiredBuildCommands() {
  return [
    ['pnpm', '--filter', '@zclaudia/shared', 'run', 'build'],
    ['pnpm', '--filter', '@zclaudia/server', 'run', 'build'],
    ['pnpm', '--filter', '@zclaudia/desktop', 'run', 'build'],
  ];
}

export function renderBrowserEnv({ port = 3100, dataDir }) {
  return [
    '# ZClaudia local browser shell',
    `PORT=${port}`,
    'SERVER_HOST=127.0.0.1',
    'NODE_ENV=production',
    `ZCLAUDIA_DATA_DIR=${dataDir}`,
    '',
  ].join('\n');
}

export function renderSystemdUnit({
  serviceName,
  user,
  repoRoot,
  nodeBin,
  nodeDir,
  envFile,
  dataDir,
}) {
  return `[Unit]
Description=ZClaudia Local Browser Shell (${serviceName})
After=network.target

[Service]
Type=simple
User=${user}
WorkingDirectory=${repoRoot}
EnvironmentFile=${envFile}
Environment=PATH=${nodeDir}:/usr/local/bin:/usr/bin:/bin
Environment=ZCLAUDIA_DATA_DIR=${dataDir}
ExecStart=${nodeBin} ${repoRoot}/server/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${serviceName}

[Install]
WantedBy=multi-user.target
`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function renderLaunchAgentPlist({
  label,
  repoRoot,
  nodeBin,
  dataDir,
  logDir,
  port = 3100,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(label)}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(repoRoot)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodeBin)}</string>
    <string>server/dist/index.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>${port}</string>
    <key>SERVER_HOST</key>
    <string>127.0.0.1</string>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>ZCLAUDIA_DATA_DIR</key>
    <string>${escapeXml(dataDir)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(logDir)}/browser.out.log</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logDir)}/browser.err.log</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}
