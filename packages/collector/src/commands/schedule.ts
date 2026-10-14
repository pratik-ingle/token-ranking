import path from "node:path";
import { tokenrankHome, homeDir, type Env } from "../paths";

/** Copy-paste snippets for running `sync` every 6 hours. Nothing is installed. */
export function scheduleSnippets(env: Env): string {
  const home = tokenrankHome(env);
  const defaultHome = path.join(homeDir(env), ".tokenrank");
  const customHome = path.resolve(home) !== path.resolve(defaultHome);
  const envPrefix = customHome ? `TOKENRANK_HOME=${JSON.stringify(home)} ` : "";
  const logFile = path.join(home, "sync.log");
  const cmd = `${envPrefix}npx -y tokenrank-collector sync`;

  const cron = [
    "# cron — run `crontab -e` and add:",
    `17 */6 * * * /bin/sh -lc '${cmd} >> "${logFile}" 2>&1'`,
  ].join("\n");

  const launchdEnv = customHome
    ? `
  <key>EnvironmentVariables</key>
  <dict>
    <key>TOKENRANK_HOME</key>
    <string>${home}</string>
  </dict>`
    : "";
  const launchd = `# launchd (macOS) — save as ~/Library/LaunchAgents/dev.tokenrank.collector.plist, then:
#   launchctl load ~/Library/LaunchAgents/dev.tokenrank.collector.plist
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.tokenrank.collector</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>npx -y tokenrank-collector sync</string>
  </array>${launchdEnv}
  <key>StartInterval</key>
  <integer>21600</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logFile}</string>
  <key>StandardErrorPath</key>
  <string>${logFile}</string>
</dict>
</plist>`;

  const systemdEnv = customHome ? `\nEnvironment=TOKENRANK_HOME=${home}` : "";
  const systemd = `# systemd user timer (Linux) — save these two files, then:
#   systemctl --user daemon-reload && systemctl --user enable --now tokenrank-sync.timer

# ~/.config/systemd/user/tokenrank-sync.service
[Unit]
Description=Upload daily AI token usage aggregates to TokenRank

[Service]
Type=oneshot${systemdEnv}
ExecStart=/bin/sh -lc 'npx -y tokenrank-collector sync'

# ~/.config/systemd/user/tokenrank-sync.timer
[Unit]
Description=Run tokenrank-collector sync every 6 hours

[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
Persistent=true

[Install]
WantedBy=timers.target`;

  return [
    "Run `tokenrank-collector sync` every 6 hours with any of the following (printed only; nothing is installed).",
    "Syncs are incremental and idempotent, so running more or less often is fine.",
    "",
    cron,
    "",
    launchd,
    "",
    systemd,
    "",
  ].join("\n");
}
