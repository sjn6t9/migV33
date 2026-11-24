#!/bin/bash
# MAM & MAM Overseas portal: installer / updater for an Ubuntu VPS (run as root).
#
#   curl -fsSL https://raw.githubusercontent.com/sjn6t9/migV33/mam-overseas/deploy/install.sh | bash -s -- mamandmam.bd www.mamandmam.bd
#
# The first name is the main domain. Once it has HTTPS, every other name that reaches the app
# (such as www.) is redirected to it, keeping the page path.
#
# What it does (safe to run again):
#   1. installs Node.js 22 and git if missing
#   2. puts the app in /opt/mam-overseas, data in /var/lib/mam-overseas (owned by a locked-down "mamapp" user)
#   3. runs it as the systemd service "mam-overseas" on 127.0.0.1:3100
#   4. checks GitHub every 2 minutes and updates itself when new code is pushed
#   5. ADDS a site for the domain to the existing nginx or Caddy (other sites are not changed;
#      the config is tested before reload and a backup is kept), with HTTPS
#   6. for a .bd main domain: runs the domain's own DNS server (server/dns.cjs, service "mam-dns")
#      so the registrar only needs the name servers ns1.<domain> and ns2.<domain> (both with this server's IP)
#      and its email: noreply@ sends verification codes, info@ is forwarded (deploy/mail.sh)
#   7. if DNS or HTTPS is not ready yet, tries again by itself every 10 minutes until it is
#      and a separate admin panel at admin.<domain> (admin and staff sign in only there)
#   8. prints a one-time link for creating the admin account
set -euo pipefail

DOMAIN="${1:-mamandmam.bd}"
NAMES="${*:-$DOMAIN}"   # all names for this site, main domain first
REPO="${REPO:-https://github.com/sjn6t9/migV33.git}"
BRANCH="${BRANCH:-mam-overseas}"
APP=/opt/mam-overseas
DATA=/var/lib/mam-overseas
ENVF=/etc/mam-overseas.env
SVC=mam-overseas
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Please run as root (or with sudo)."; exit 1; }

say "1/6 Checking Node.js and git"
export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v git >/dev/null 2>&1 || apt-get install -y git
command -v openssl >/dev/null 2>&1 || apt-get install -y openssl
echo "node $(node -v)"

say "2/6 Getting the code"
if [ -d "$APP/.git" ]; then
  git -C "$APP" fetch -q origin "$BRANCH" && git -C "$APP" reset -q --hard "origin/$BRANCH"
else
  rm -rf "$APP"; git clone -q -b "$BRANCH" "$REPO" "$APP"
fi
cd "$APP" && npm install --omit=dev --no-audit --no-fund --loglevel=error
id mamapp >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin mamapp
mkdir -p "$DATA" && chown -R mamapp:mamapp "$DATA" && chmod 750 "$DATA"

say "3/6 Settings and service"
if [ ! -f "$ENVF" ]; then
  PORT=3100
  while ss -ltn | awk '{print $4}' | grep -qE "[:.]$PORT\$"; do PORT=$((PORT + 1)); done
  printf 'PORT=%s\nHOST=127.0.0.1\nDATA_DIR=%s\nSETUP_TOKEN=%s\n' "$PORT" "$DATA" "$(openssl rand -hex 16)" > "$ENVF"
  chmod 600 "$ENVF"
fi
PORT=$(grep '^PORT=' "$ENVF" | cut -d= -f2)
TOKEN=$(grep '^SETUP_TOKEN=' "$ENVF" | cut -d= -f2)
NODE_BIN=$(command -v node)
cat > /etc/systemd/system/$SVC.service <<EOF
[Unit]
Description=MAM & MAM Overseas portal
After=network.target

[Service]
User=mamapp
Group=mamapp
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=$NODE_BIN server/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF

say "4/6 Auto-update from GitHub"
cat > /usr/local/bin/$SVC-update <<EOF
#!/bin/bash
cd $APP || exit 0
git fetch -q origin $BRANCH || exit 0
if [ "\$(git rev-parse HEAD)" != "\$(git rev-parse origin/$BRANCH)" ]; then
  git reset -q --hard origin/$BRANCH
  npm install --omit=dev --no-audit --no-fund --loglevel=error
  systemctl restart $SVC
fi
EOF
chmod +x /usr/local/bin/$SVC-update
cat > /etc/systemd/system/$SVC-update.service <<EOF
[Unit]
Description=MAM & MAM Overseas auto-update
[Service]
Type=oneshot
ExecStart=/usr/local/bin/$SVC-update
EOF
cat > /etc/systemd/system/$SVC-update.timer <<EOF
[Unit]
Description=Check GitHub for MAM & MAM Overseas updates every 2 minutes
[Timer]
OnBootSec=90
OnUnitActiveSec=120
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable -q --now $SVC $SVC-update.timer
systemctl restart $SVC
sleep 2
curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null && echo "app is running on 127.0.0.1:$PORT" || { journalctl -u $SVC -n 30 --no-pager; echo "The app did not start."; exit 1; }

MYIP=$(curl -s4 --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')

# The domain's own DNS server (.bd registrars only take name servers, not A records)
SELF_DNS="${SELF_DNS:-auto}"
if [ "$SELF_DNS" = auto ]; then case "$DOMAIN" in *.bd) SELF_DNS=1 ;; *) SELF_DNS=0 ;; esac; fi
if [ "$SELF_DNS" = 1 ]; then
  say "DNS server for $DOMAIN"
  if ip -4 addr | grep -qw "$MYIP"; then DBIND=$MYIP; else DBIND=0.0.0.0; fi
  cat > /etc/systemd/system/mam-dns.service <<EOF
[Unit]
Description=DNS for $DOMAIN (MAM & MAM Overseas)
After=network-online.target
Wants=network-online.target

[Service]
User=mamapp
Group=mamapp
WorkingDirectory=$APP
Environment=DNS_IP=$MYIP DNS_BIND=$DBIND DNS_ZONES=$DOMAIN DNS_NS=${DNS_NS:-ns1.$DOMAIN,ns2.$DOMAIN}
ExecStart=$NODE_BIN server/dns.cjs
Restart=always
RestartSec=3
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable -q mam-dns
  systemctl restart mam-dns || true
  if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow 53 >/dev/null && echo "firewall: port 53 opened"; fi
  sleep 1
  if systemctl is-active --quiet mam-dns; then echo "DNS server is answering for $DOMAIN and www.$DOMAIN -> $MYIP"
  else journalctl -u mam-dns -n 15 --no-pager; warn "The DNS server did not start (see above). The rest of the site is not affected."; fi
  # restart the DNS server too when the code updates
  # email for the domain: noreply@ for verification codes, info@ forwarded (deploy/mail.sh)
  if [ "${SELF_MAIL:-1}" = 1 ]; then say "Email for $DOMAIN"; bash "$APP/deploy/mail.sh" "$DOMAIN" || warn "Email setup did not finish (see above). The rest of the site is not affected."; fi
  grep -q "mam-dns" /usr/local/bin/$SVC-update || sed -i "s|^  systemctl restart $SVC\$|  systemctl restart $SVC; systemctl is-enabled --quiet mam-dns \&\& systemctl restart mam-dns|" /usr/local/bin/$SVC-update
fi

# separate admin panel at admin.<domain> (needs this server's DNS for the domain, so .bd domains only by default)
# and a separate agent panel at agent.<domain>
ADMIN_NAME="${ADMIN_NAME:-}"; AGENT_NAME="${AGENT_NAME:-}"
[ -n "$ADMIN_NAME" ] || { [ "$SELF_DNS" = 1 ] && ADMIN_NAME="admin.$DOMAIN"; } || true
[ -n "$AGENT_NAME" ] || { [ "$SELF_DNS" = 1 ] && AGENT_NAME="agent.$DOMAIN"; } || true
setenv() { if grep -q "^$1=" "$ENVF"; then sed -i "s/^$1=.*/$1=$2/" "$ENVF"; else echo "$1=$2" >> "$ENVF"; fi; }
[ -z "$ADMIN_NAME" ] || setenv ADMIN_HOST "$ADMIN_NAME"
[ -z "$AGENT_NAME" ] || setenv AGENT_HOST "$AGENT_NAME"
[ -z "$ADMIN_NAME$AGENT_NAME" ] || systemctl restart $SVC

say "5/6 Web server for $NAMES"
HTTPS_OK=0; DNS_OK=1
# HTTPS needs every name to point at this server first
for n in $NAMES; do
  got=$(getent ahostsv4 "$n" | awk '{print $1; exit}' || true)
  if [ "$got" = "$MYIP" ]; then echo "$n -> $MYIP (ok)"
  else DNS_OK=0; warn "$n points to '${got:-nothing}', not to this server ($MYIP). Add an A record for $n with the value $MYIP at your domain registrar, wait until it works, then run this installer again."; fi
done
STAMP=$(date +%Y%m%d%H%M%S)
if systemctl is-active --quiet caddy; then
  CF=$(systemctl cat caddy 2>/dev/null | grep -oE -- '--config [^ ]+' | head -1 | cut -d' ' -f2); CF=${CF:-/etc/caddy/Caddyfile}
  echo "Caddy found ($CF)"
  if grep -qE "^[[:space:]]*(https?://)?$DOMAIN([ ,{]|$)" "$CF"; then
    echo "$DOMAIN is already in the Caddyfile; leaving it as it is."
  else
    cp "$CF" "$CF.bak.$STAMP"
    printf '\n%s {\n\tencode gzip\n\trequest_body {\n\t\tmax_size 30MB\n\t}\n\treverse_proxy 127.0.0.1:%s\n}\n' "$(echo $NAMES | sed 's/ /, /g')" "$PORT" >> "$CF"
    if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then systemctl reload caddy; echo "Added $NAMES to Caddy (HTTPS is automatic)."
    else cp "$CF.bak.$STAMP" "$CF"; warn "Caddy rejected the new block; the old Caddyfile was restored. Nothing else changed."; exit 1; fi
  fi
  # the separate panels (admin.<domain>, agent.<domain>)
  for PN in $ADMIN_NAME $AGENT_NAME; do
    grep -qE "^[[:space:]]*(https?://)?$PN([ ,{]|$)" "$CF" && continue
    cp "$CF" "$CF.bak.$STAMP.$PN"
    printf '\n%s {\n\tencode gzip\n\trequest_body {\n\t\tmax_size 30MB\n\t}\n\treverse_proxy 127.0.0.1:%s\n}\n' "$PN" "$PORT" >> "$CF"
    if caddy validate --config "$CF" --adapter caddyfile >/dev/null 2>&1; then systemctl reload caddy; echo "Added the panel $PN to Caddy."
    else cp "$CF.bak.$STAMP.$PN" "$CF"; warn "Caddy rejected the block for $PN; the old Caddyfile was restored."; fi
  done
elif systemctl is-active --quiet nginx; then
  echo "nginx found"
  if [ -d /etc/nginx/sites-available ]; then NC=/etc/nginx/sites-available/$DOMAIN; else NC=/etc/nginx/conf.d/$DOMAIN.conf; fi
  if [ -f "$NC" ]; then cp "$NC" "$NC.bak.$STAMP"; fi
  if [ ! -f "$NC" ] || ! grep -q "listen 443" "$NC"; then
    cat > "$NC" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $NAMES;
    client_max_body_size 30m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
    [ -d /etc/nginx/sites-enabled ] && ln -sf "$NC" "/etc/nginx/sites-enabled/$DOMAIN"
  fi
  if nginx -t >/dev/null 2>&1; then systemctl reload nginx; echo "Added $DOMAIN to nginx."
  else rm -f "/etc/nginx/sites-enabled/$DOMAIN"; [ -f "$NC.bak.$STAMP" ] && cp "$NC.bak.$STAMP" "$NC" || rm -f "$NC"; nginx -t; warn "nginx rejected the new site; it was removed again. Nothing else changed."; exit 1; fi
  if ! grep -q "listen 443" "$NC" && [ "$DNS_OK" = 1 ]; then
    command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx >/dev/null
    ok=0
    for i in 1 2 3 4 5 6; do
      if certbot --nginx $(for n in $NAMES; do printf -- '-d %s ' "$n"; done) --non-interactive --agree-tos --register-unsafely-without-email --redirect >/tmp/certbot.log 2>&1; then ok=1; break; fi
      echo "HTTPS certificate not issued yet (DNS may still be spreading); retrying in 30 s ($i/6)"; sleep 30
    done
    [ $ok = 1 ] && { echo "HTTPS is on for $NAMES."; HTTPS_OK=1; } || { tail -n 15 /tmp/certbot.log; warn "HTTPS could not be set up yet. The site works on http://$DOMAIN; run this installer again later to add HTTPS."; }
  elif grep -q "listen 443" "$NC"; then HTTPS_OK=1; fi
else
  warn "Neither nginx nor Caddy is running. Programs listening on ports 80/443:"
  ss -ltnp | grep -E ':(80|443) ' || true
  warn "The app is running on 127.0.0.1:$PORT. Point your web server for $DOMAIN to it, then open the link below."
fi

# make the new domain the main one: all other names are redirected to it
if [ "$DNS_OK" = 1 ] && { [ "$HTTPS_OK" = 1 ] || systemctl is-active --quiet caddy; }; then
  if grep -q '^CANONICAL_HOST=' "$ENVF"; then sed -i "s/^CANONICAL_HOST=.*/CANONICAL_HOST=$DOMAIN/" "$ENVF"; else echo "CANONICAL_HOST=$DOMAIN" >> "$ENVF"; fi
  systemctl restart $SVC; echo "Main domain: https://$DOMAIN (other names redirect here)"
fi

# not finished yet (DNS still spreading or no certificate): try again by itself every 10 minutes
if [ "$DNS_OK" = 1 ] && [ "$HTTPS_OK" = 1 ]; then
  systemctl disable -q --now $SVC-finish.timer 2>/dev/null || true
elif [ "$DNS_OK" = 1 ] && systemctl is-active --quiet caddy && grep -q "^CANONICAL_HOST=$DOMAIN\$" "$ENVF"; then
  systemctl disable -q --now $SVC-finish.timer 2>/dev/null || true
elif systemctl is-active --quiet nginx || systemctl is-active --quiet caddy; then
  cat > /etc/systemd/system/$SVC-finish.service <<EOF
[Unit]
Description=Finish MAM & MAM Overseas setup for $NAMES (DNS and HTTPS)
[Service]
Type=oneshot
TimeoutStartSec=20min
ExecStart=/bin/bash $APP/deploy/install.sh $NAMES
EOF
  cat > /etc/systemd/system/$SVC-finish.timer <<EOF
[Unit]
Description=Retry MAM & MAM Overseas DNS/HTTPS setup every 10 minutes until it works
[Timer]
OnActiveSec=10min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload; systemctl enable -q --now $SVC-finish.timer
  echo "DNS/HTTPS is not ready yet. This server tries again by itself every 10 minutes and switches to https://$DOMAIN when it works."
fi

say "6/6 Done"
if curl -s "http://127.0.0.1:$PORT/api/state" | grep -q '"needsSetup":true'; then
  echo
  echo "Create the admin account here (one-time link, keep it private):"
  echo
  echo "    https://${ADMIN_NAME:-$DOMAIN}/#setup-$TOKEN"
  echo
else
  echo "Admin account already exists. Site: https://$DOMAIN${ADMIN_NAME:+  Admin panel: https://$ADMIN_NAME}${AGENT_NAME:+  Agent panel: https://$AGENT_NAME}"
fi
