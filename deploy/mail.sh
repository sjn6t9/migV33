#!/bin/bash
# Email for the agency's own domain on this VPS (run as root; safe to run again).
#
#   bash /opt/mam-overseas/deploy/mail.sh mamandmam.bd [forward-to@example.com]
#
#   - noreply@<domain>: the website sends verification codes from it (Postfix on 127.0.0.1:25,
#     signed with DKIM; SPF, DKIM and DMARC records are served by mam-dns)
#   - info@, postmaster@, abuse@<domain>: incoming mail is forwarded to the forward-to address
#     (default: the website admin's email). Mail to noreply@ is discarded.
set -euo pipefail
DOMAIN="${1:-mamandmam.bd}"
FWD_FILE=/etc/mam-dns/mail-forward
ENVF=/etc/mam-overseas.env
DATA=/var/lib/mam-overseas
mkdir -p /etc/mam-dns

FWD="${2:-${MAIL_FORWARD:-}}"
[ -n "$FWD" ] || FWD=$(cat "$FWD_FILE" 2>/dev/null || true)
[ -n "$FWD" ] || FWD=$(node -e 'try{const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const a=(d.users||[]).find(u=>u.role==="admin");process.stdout.write(a&&a.email||"")}catch(e){}' "$DATA/db.json")
case "$FWD" in *@*.*) ;; *) echo "No forward address found. Run again with: bash $0 $DOMAIN you@example.com"; exit 1 ;; esac
case "$FWD" in *@"$DOMAIN") echo "The forward address must be outside $DOMAIN."; exit 1 ;; esac
echo "$FWD" > "$FWD_FILE"

echo "==> Mail packages"
export DEBIAN_FRONTEND=noninteractive
echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
echo "postfix postfix/mailname string mail.$DOMAIN" | debconf-set-selections
PKGS=""
for p in postfix opendkim opendkim-tools ssl-cert; do dpkg -s "$p" >/dev/null 2>&1 || PKGS="$PKGS $p"; done
[ -z "$PKGS" ] || { apt-get update -qq; apt-get install -y -qq $PKGS >/dev/null; }

echo "==> DKIM key"
KD=/etc/opendkim/keys/$DOMAIN
if [ ! -f "$KD/mail.private" ]; then
  mkdir -p "$KD"; opendkim-genkey -b 2048 -h sha256 -d "$DOMAIN" -s mail -D "$KD"
fi
chown -R opendkim:opendkim /etc/opendkim/keys; chmod 700 "$KD"; chmod 600 "$KD/mail.private"
tr -d '\n' < "$KD/mail.txt" | grep -o '"[^"]*"' | tr -d '"' | tr -s ' \t' ' ' > "/etc/mam-dns/dkim-$DOMAIN.txt"
chmod 644 "/etc/mam-dns/dkim-$DOMAIN.txt"
cat > /etc/opendkim.conf <<EOF
Syslog                  yes
UMask                   007
Mode                    sv
Canonicalization        relaxed/simple
Domain                  $DOMAIN
Selector                mail
KeyFile                 $KD/mail.private
Socket                  inet:8891@127.0.0.1
PidFile                 /run/opendkim/opendkim.pid
UserID                  opendkim
OversignHeaders         From
InternalHosts           127.0.0.1, ::1, localhost
EOF
if [ -f /etc/default/opendkim ]; then
  sed -i '/^SOCKET=/d' /etc/default/opendkim; echo 'SOCKET=inet:8891@127.0.0.1' >> /etc/default/opendkim
  [ -x /lib/opendkim/opendkim.service.generate ] && /lib/opendkim/opendkim.service.generate || true
fi
systemctl daemon-reload; systemctl enable -q opendkim; systemctl restart opendkim

echo "==> Postfix"
postconf -e "myhostname = mail.$DOMAIN" "mydomain = $DOMAIN" "myorigin = $DOMAIN" "mydestination = localhost" \
  "inet_interfaces = all" "inet_protocols = ipv4" "mynetworks = 127.0.0.0/8" \
  "virtual_alias_domains = $DOMAIN" "virtual_alias_maps = hash:/etc/postfix/virtual" \
  "smtpd_relay_restrictions = permit_mynetworks, reject_unauth_destination" \
  "smtpd_helo_required = yes" "disable_vrfy_command = yes" "message_size_limit = 31457280" \
  "smtpd_tls_cert_file = /etc/ssl/certs/ssl-cert-snakeoil.pem" "smtpd_tls_key_file = /etc/ssl/private/ssl-cert-snakeoil.key" \
  "smtpd_tls_security_level = may" "smtp_tls_security_level = may" \
  "smtpd_milters = inet:127.0.0.1:8891" "non_smtpd_milters = inet:127.0.0.1:8891" "milter_default_action = accept" "milter_protocol = 6"
echo "mail.$DOMAIN" > /etc/mailname
cat > /etc/postfix/virtual <<EOF
info@$DOMAIN        $FWD
postmaster@$DOMAIN  $FWD
abuse@$DOMAIN       $FWD
noreply@$DOMAIN     devnull@localhost
EOF
postmap /etc/postfix/virtual
grep -q '^devnull:' /etc/aliases || echo 'devnull: /dev/null' >> /etc/aliases
newaliases
systemctl enable -q postfix; systemctl restart postfix
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then ufw allow 25/tcp >/dev/null && echo "firewall: port 25 opened"; fi

echo "==> Website sends from noreply@$DOMAIN"
touch "$ENVF"
sed -i '/^SMTP_LOCAL=/d;/^MAIL_FROM=/d' "$ENVF"
printf 'SMTP_LOCAL=1\nMAIL_FROM=noreply@%s\n' "$DOMAIN" >> "$ENVF"
systemctl restart mam-overseas
systemctl is-enabled --quiet mam-dns 2>/dev/null && systemctl restart mam-dns || true

sleep 1
systemctl is-active --quiet postfix && systemctl is-active --quiet opendkim && echo "Mail is ready: codes from noreply@$DOMAIN; info@$DOMAIN -> $FWD" || { journalctl -u postfix -u opendkim -n 20 --no-pager; echo "Mail did not start (see above)."; exit 1; }
