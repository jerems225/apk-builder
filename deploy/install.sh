#!/usr/bin/env bash
# Installation / mise à jour du builder APK (version 2 : API + interface).
# Idempotent : relançable sans risque, ne réécrit jamais un .env existant.
#
#   sudo ./deploy/install.sh [--skip-image] [--skip-web] [--skip-vhost]
#
set -Eeuo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT=/srv/apkbuild
APP="$ROOT/app"
SVC_USER=apkbuild
SERVER_NAME="${SERVER_NAME:-build.upjunoo-preprod.tech}"
IMAGE="${IMAGE:-rn-android-builder:1}"
BOOTSTRAP_EMAIL="${BOOTSTRAP_EMAIL:-admin@$SERVER_NAME}"

SKIP_IMAGE=0; SKIP_WEB=0; SKIP_VHOST=0
for a in "$@"; do
  case "$a" in
    --skip-image) SKIP_IMAGE=1 ;;
    --skip-web)   SKIP_WEB=1 ;;
    --skip-vhost|--skip-nginx) SKIP_VHOST=1 ;;
    *) echo "option inconnue: $a" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "À lancer avec sudo." >&2; exit 1; }
step() { echo; echo "▸ $*"; }
as_svc() { sudo -u "$SVC_USER" env HOME="$ROOT" "$@"; }

# ── 1. Prérequis ─────────────────────────────────────────────────────────────
step "Prérequis"
command -v node >/dev/null || { echo "  node absent" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "  Node 20 minimum, trouvé $NODE_MAJOR" >&2; exit 1; }
echo "  node $(node -v)"
# keytool sert à valider un magasin de clés déposé depuis l'interface. Son
# absence n'empêche pas le service de démarrer, mais rend l'écran inutilisable.
command -v keytool >/dev/null \
  && echo "  keytool présent" \
  || echo "  ATTENTION : keytool absent — installez openjdk-17-jdk-headless,
    sinon le dépôt d'une clé de signature échouera."

# ── 2. Utilisateur de service ────────────────────────────────────────────────
step "Utilisateur de service"
if ! id -u "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$ROOT" --shell /usr/sbin/nologin "$SVC_USER"
  echo "  utilisateur $SVC_USER créé"
else
  echo "  utilisateur $SVC_USER déjà présent"
fi
getent group docker >/dev/null || { echo "  groupe docker absent — Docker est-il installé ?" >&2; exit 1; }
usermod -aG docker "$SVC_USER"

# ── 3. Arborescence ──────────────────────────────────────────────────────────
step "Arborescence $ROOT"
mkdir -p "$ROOT"/{app,artifacts,work,uploads,cache/home,cache/gradle,cache/npm,cache/yarn,data}
chown -R "$SVC_USER:$SVC_USER" "$ROOT"
chmod 750 "$ROOT"

# Les clés de signature vivent à part, en 0700 : ni sous artifacts/ qui est
# servi publiquement par /dl, ni sous cache/ que le cron de purge peut vider.
install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$ROOT/keystores"
echo "  $ROOT/keystores en $(stat -c '%A' "$ROOT/keystores")"

# ── 4. Code applicatif ───────────────────────────────────────────────────────
step "Déploiement du code"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete \
    --exclude node_modules --exclude .next --exclude .env --exclude .git \
    --exclude .tmp \
    "$SRC_DIR/" "$APP/"
else
  # rsync n'est pas garanti sur une Ubuntu minimale. On copie sans supprimer,
  # pour préserver node_modules et .next et ne pas tout réinstaller.
  mkdir -p "$APP"
  cp -a "$SRC_DIR/apps" "$SRC_DIR/package.json" "$APP/" 2>/dev/null || true
  cp -a "$SRC_DIR/docker" "$SRC_DIR/deploy" "$SRC_DIR/docs" "$APP/" 2>/dev/null || true
  cp -a "$SRC_DIR/README.md" "$APP/" 2>/dev/null || true
fi
# Les fichiers transitent par un poste Windows : les CRLF casseraient les
# shebangs et les scripts shell côté Linux.
find "$APP" -type f \( -name '*.js' -o -name '*.sh' -o -name '*.mjs' \) \
  -not -path '*/node_modules/*' -exec sed -i 's/\r$//' {} +
chown -R "$SVC_USER:$SVC_USER" "$APP"

# ── 5. Configuration ─────────────────────────────────────────────────────────
step "Configuration"
if [ ! -f "$ROOT/.env" ]; then
  ENCRYPTION_KEY="$(openssl rand -hex 32)"
  WEBHOOK_SECRET="$(openssl rand -hex 32)"
  sed -e "s|__ENCRYPTION_KEY__|$ENCRYPTION_KEY|" \
      -e "s|__WEBHOOK_SECRET__|$WEBHOOK_SECRET|" \
      -e "s|__BOOTSTRAP_EMAIL__|$BOOTSTRAP_EMAIL|" \
      -e "s|__PUBLIC_URL__|https://$SERVER_NAME|g" \
      "$SRC_DIR/.env.example" > "$ROOT/.env"
  echo "  .env généré avec des secrets aléatoires"
  NEW_ENV=1
else
  echo "  .env existant conservé"
  NEW_ENV=0
  # Ajout non destructif des clés apparues après la première installation.
  add_key() {
    grep -q "^$1=" "$ROOT/.env" || { printf '\n# %s\n%s=%s\n' "$3" "$1" "$2" >> "$ROOT/.env"; \
      echo "  $1 ajoutée au .env existant"; }
  }
  add_key ENCRYPTION_KEY "$(openssl rand -hex 32)" \
    "Clé maîtresse (AES-256-GCM). Sa perte rend illisibles les secrets stockés."
  add_key WEB_ORIGIN "https://$SERVER_NAME" \
    "Origine de l'interface, autorisée en CORS."
  add_key BOOTSTRAP_EMAIL "$BOOTSTRAP_EMAIL" \
    "Compte créé au premier seed."
  add_key ABIS "arm64-v8a" \
    "Architectures natives par défaut. Ignoré sous React Native 0.71."
  add_key SESSION_HOURS "12" "Durée de vie d'une session d'interface."
  add_key KEYTOOL_BIN "keytool" "Chemin de keytool, pour valider un magasin déposé."
fi
chown "$SVC_USER:$SVC_USER" "$ROOT/.env"
chmod 600 "$ROOT/.env"

# ── 6. Dépendances et schéma ─────────────────────────────────────────────────
step "Dépendances Node"
cd "$APP"
# HOME est forcé : sans lui, npm tenterait d'écrire son cache dans le home de
# l'utilisateur qui a lancé sudo, où apkbuild n'a pas les droits.
as_svc npm install --no-audit --no-fund

step "Client Prisma et schéma de base"
as_svc npm run db:generate
# `db push` plutôt que `migrate deploy` : le schéma évolue de façon additive et
# la base est un fichier SQLite unique, sauvegardé avant chaque intervention.
# Une chaîne de migrations formelle apporterait ici plus de cérémonie que de
# sécurité.
as_svc npm run db:push

# ── 7. Interface Next.js ─────────────────────────────────────────────────────
if [ "$SKIP_WEB" -eq 0 ]; then
  step "Compilation de l'interface (2 à 4 min)"
  as_svc npm run build
else
  step "Interface ignorée (--skip-web)"
fi

# ── 8. Image Docker de build ─────────────────────────────────────────────────
if [ "$SKIP_IMAGE" -eq 0 ]; then
  step "Image Docker $IMAGE (10 à 25 min au premier passage)"
  docker build -t "$IMAGE" "$SRC_DIR/docker"
else
  step "Image Docker ignorée (--skip-image)"
fi

# ── 9. Services systemd ──────────────────────────────────────────────────────
step "Services systemd"
install -m 0644 "$SRC_DIR/deploy/apkbuild-api.service" /etc/systemd/system/apkbuild-api.service
install -m 0644 "$SRC_DIR/deploy/apkbuild-web.service" /etc/systemd/system/apkbuild-web.service

# L'ancien service monolithique est désactivé s'il existe encore : le laisser
# actif ferait deux processus sur le port 9100.
if systemctl list-unit-files | grep -q '^apkbuild\.service'; then
  systemctl disable --now apkbuild >/dev/null 2>&1 || true
  echo "  ancien service apkbuild.service arrêté et désactivé"
fi

systemctl daemon-reload
systemctl enable apkbuild-api apkbuild-web >/dev/null
systemctl restart apkbuild-api
sleep 3
systemctl is-active --quiet apkbuild-api \
  && echo "  API active" \
  || { echo "  ÉCHEC de l'API"; journalctl -u apkbuild-api -n 25 --no-pager; exit 1; }

if [ "$SKIP_WEB" -eq 0 ]; then
  systemctl restart apkbuild-web
  sleep 3
  systemctl is-active --quiet apkbuild-web \
    && echo "  interface active" \
    || { echo "  ÉCHEC de l'interface"; journalctl -u apkbuild-web -n 25 --no-pager; exit 1; }
fi

# ── 10. Amorçage du premier compte ───────────────────────────────────────────
step "Compte d'administration"
# Le script est idempotent : sur une base déjà peuplée, il ne fait qu'afficher
# l'état sans rien modifier.
as_svc npm run seed

# ── 11. Reprise des données de la version 1 ──────────────────────────────────
if [ "$NEW_ENV" -eq 0 ] && [ -f "$ROOT/data/apkbuild.db" ]; then
  step "Reprise des données héritées"
  echo "  Les anciennes tables cohabitent avec le nouveau schéma."
  echo "  Pour les reprendre :"
  echo "    sudo -u $SVC_USER env HOME=$ROOT npm --prefix $APP run migrate:legacy"
  echo "  Puis, une fois vérifié dans l'interface, ajouter -- --archiver."
fi

# ── 12. Frontal web ──────────────────────────────────────────────────────────
# Le serveur web n'est pas présumé : on configure celui qui tourne réellement.
# Sur cette machine c'est Apache ; nginx est installé mais désactivé.
if [ "$SKIP_VHOST" -eq 0 ]; then
  if systemctl is-active --quiet apache2; then
    step "Vhost Apache ($SERVER_NAME)"
    for m in proxy proxy_http headers ssl; do a2enmod -q "$m" >/dev/null 2>&1 || true; done
    sed "s|__SERVER_NAME__|$SERVER_NAME|g" \
      "$SRC_DIR/deploy/apache-apkbuild.conf" > "/etc/apache2/sites-available/${SERVER_NAME}.conf"
    a2ensite -q "${SERVER_NAME}.conf" >/dev/null
    apache2ctl configtest && systemctl reload apache2
    echo "  vhost actif en HTTP"
    echo "  TLS : sudo certbot --apache -d $SERVER_NAME"

  elif systemctl is-active --quiet nginx; then
    step "Vhost nginx ($SERVER_NAME)"
    sed "s|__SERVER_NAME__|$SERVER_NAME|g" \
      "$SRC_DIR/deploy/nginx-apkbuild.conf" > /etc/nginx/conf.d/apkbuild.conf
    nginx -t && systemctl reload nginx
    echo "  vhost actif en HTTP"
    echo "  TLS : sudo certbot --nginx -d $SERVER_NAME"

  else
    step "Aucun frontal web actif"
    echo "  Ni apache2 ni nginx ne tournent. Les services restent joignables"
    echo "  sur 127.0.0.1:9100 (API) et 127.0.0.1:3000 (interface)."
  fi
else
  step "Frontal web ignoré (--skip-vhost)"
fi

step "Terminé"
echo "  Interface     : https://$SERVER_NAME/"
echo "  Documentation : https://$SERVER_NAME/api/docs"
echo "  Webhook       : https://$SERVER_NAME/api/webhooks/<espace>"
echo "  Journaux      : journalctl -u apkbuild-api -u apkbuild-web -f"
