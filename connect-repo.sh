#!/bin/bash
# Usage: bash /opt/migv33/connect-repo.sh https://github.com/USER/REPO.git [branch]
# Links this server to a public GitHub repo and auto-updates it every minute.
set -e
BR=${2:-main}
cd /opt/migv33
git init -q
git remote remove origin 2>/dev/null || true
git remote add origin "$1"
printf 'migv33.db*\n.env\nnode_modules\n' > .git/info/exclude
git fetch -q origin "$BR"
git reset -q --hard "origin/$BR"
npm install --omit=dev
systemctl restart migv33
cat > /usr/local/bin/migv33-update <<UPD
#!/bin/bash
cd /opt/migv33
git fetch -q origin $BR || exit 0
if [ "\$(git rev-parse HEAD)" != "\$(git rev-parse origin/$BR)" ]; then
  git reset -q --hard origin/$BR
  npm install --omit=dev
  systemctl restart migv33
fi
UPD
chmod +x /usr/local/bin/migv33-update
cat > /etc/systemd/system/migv33-update.service <<UNIT
[Unit]
Description=Migv33 auto-update
[Service]
Type=oneshot
ExecStart=/usr/local/bin/migv33-update
UNIT
cat > /etc/systemd/system/migv33-update.timer <<UNIT
[Unit]
Description=Migv33 auto-update every minute
[Timer]
OnBootSec=60
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now migv33-update.timer
echo "Auto-update is on. Push to $BR and the site updates within a minute."
