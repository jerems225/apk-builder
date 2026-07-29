#!/usr/bin/env bash
# Bascule de la version 1 vers la version 2, en une seule commande.
#
#   sudo ./deploy/migrer-v2.sh
#
# Ordre imposé par docs/demarche-signature-par-projet.md §3 : on sauvegarde
# AVANT de toucher à quoi que ce soit. Tant que la clé de debug actuelle
# existe, les applications déjà installées chez les utilisateurs peuvent
# encore être mises à jour ; la perdre rendrait ce retour arrière impossible.
#
# Le script est interruptible : chaque étape est vérifiée avant la suivante,
# et rien n'est destructif avant l'étape 4.
set -Eeuo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT=/srv/apkbuild
SVC_USER=apkbuild
SERVER_NAME="${SERVER_NAME:-build.upjunoo-preprod.tech}"
SAUVEGARDES="${SAUVEGARDES:-/root/apkbuild-sauvegardes}"
HORODATAGE="$(date +%Y%m%d-%H%M%S)"

[ "$(id -u)" -eq 0 ] || { echo "À lancer avec sudo." >&2; exit 1; }
step() { echo; echo "════ $* ════"; }

mkdir -p "$SAUVEGARDES"
chmod 700 "$SAUVEGARDES"

# ── 1. Sauvegarde de la clé de debug ─────────────────────────────────────────
# Le geste le plus urgent, indépendamment du reste. Cette clé est ce qui permet
# aujourd'hui aux mises à jour de s'installer par-dessus l'existant. Elle
# n'était sauvegardée nulle part et rien ne la distinguait d'un fichier de cache.
step "1/6  Sauvegarde de la clé de debug"
DEBUG_KS="$ROOT/cache/home/.android/debug.keystore"
if [ -f "$DEBUG_KS" ]; then
  cp -a "$DEBUG_KS" "$SAUVEGARDES/debug.keystore-$HORODATAGE"
  chmod 600 "$SAUVEGARDES/debug.keystore-$HORODATAGE"
  echo "  copiée dans $SAUVEGARDES/debug.keystore-$HORODATAGE"
  echo
  echo "  Empreinte et validité — à consigner hors du serveur :"
  if command -v keytool >/dev/null 2>&1; then
    keytool -list -v -keystore "$DEBUG_KS" -storepass android 2>/dev/null \
      | grep -i -E 'alias|valid|SHA-?256' | sed 's/^/    /'
  else
    echo "    keytool absent — installez openjdk-17-jdk-headless pour la lire"
  fi
  echo
  echo "  ⚠ RAPATRIEZ CETTE CLÉ HORS DU SERVEUR :"
  echo "    scp vps-builder:$SAUVEGARDES/debug.keystore-$HORODATAGE ."
else
  echo "  Aucun debug.keystore dans $DEBUG_KS."
  echo "  Soit aucun build n'a encore tourné, soit le cache a déjà été vidé."
  echo "  Dans le second cas, les APK déjà distribués ne sont plus reproductibles."
fi

# ── 2. Sauvegarde de la base et de la configuration ──────────────────────────
step "2/6  Sauvegarde de la base et du .env"
tar czf "$SAUVEGARDES/apkbuild-$HORODATAGE.tgz" \
  -C / "srv/apkbuild/data" "srv/apkbuild/.env" \
  $( [ -d "$ROOT/keystores" ] && echo "srv/apkbuild/keystores" ) 2>/dev/null
chmod 600 "$SAUVEGARDES/apkbuild-$HORODATAGE.tgz"
echo "  $SAUVEGARDES/apkbuild-$HORODATAGE.tgz ($(du -h "$SAUVEGARDES/apkbuild-$HORODATAGE.tgz" | cut -f1))"

# ── 3. État de départ, pour pouvoir comparer après ───────────────────────────
step "3/6  État avant bascule"
if [ -f "$ROOT/data/apkbuild.db" ] && command -v sqlite3 >/dev/null 2>&1; then
  for t in builds projects providers; do
    n="$(sqlite3 "$ROOT/data/apkbuild.db" "SELECT COUNT(*) FROM $t" 2>/dev/null || echo '?')"
    echo "  $t : $n"
  done
else
  echo "  sqlite3 absent — comptages non relevés (sans conséquence)"
fi
echo "  artefacts : $(du -sh "$ROOT/artifacts" 2>/dev/null | cut -f1)"

# ── 4. Installation ──────────────────────────────────────────────────────────
# À partir d'ici, les services sont arrêtés et remplacés.
step "4/6  Installation de la version 2"
SERVER_NAME="$SERVER_NAME" "$SRC_DIR/deploy/install.sh" "$@"

# ── 5. Reprise des données ───────────────────────────────────────────────────
step "5/6  Reprise des données de la version 1"
# Sans --archiver : les tables d'origine restent intactes. On ne les renomme
# qu'après vérification humaine dans l'interface.
sudo -u "$SVC_USER" env HOME="$ROOT" npm --prefix "$ROOT/app" run migrate:legacy

# ── 6. Contrôles ─────────────────────────────────────────────────────────────
step "6/6  Contrôles"
ok=0
verifier() {
  printf '  %-46s' "$1"
  if eval "$2" >/dev/null 2>&1; then echo "OK"; else echo "ÉCHEC"; ok=1; fi
}
verifier "service API actif"            "systemctl is-active --quiet apkbuild-api"
verifier "service interface actif"      "systemctl is-active --quiet apkbuild-web"
verifier "API en écoute (9100)"         "curl -sf http://127.0.0.1:9100/healthz"
verifier "interface en écoute (3000)"   "curl -sf -o /dev/null http://127.0.0.1:3000/connexion"
verifier "répertoire des clés en 0700"  "[ \"\$(stat -c '%a' $ROOT/keystores)\" = 700 ]"
verifier "syntaxe Apache"               "apache2ctl configtest"
verifier "HTTPS sert l'interface"       "curl -sf https://$SERVER_NAME/connexion | grep -qi 'builder\\|connexion'"
verifier "HTTPS sert l'API"             "curl -sf https://$SERVER_NAME/healthz | grep -q '\"ok\":true'"

echo
if [ "$ok" -eq 0 ]; then
  echo "════ Bascule terminée ════"
  echo "  Interface     : https://$SERVER_NAME/"
  echo "  Documentation : https://$SERVER_NAME/api/docs"
  echo
  echo "  Il reste à faire, dans cet ordre :"
  echo "   1. Se connecter et vérifier que les builds repris sont bien là."
  echo "   2. Relever la nouvelle URL de webhook dans Paramètres, et la"
  echo "      reporter chez GitHub. L'ancienne route /webhook fonctionne"
  echo "      encore : chaque appel qu'elle reçoit est tracé dans"
  echo "      'journalctl -u apkbuild-api | grep ancienne'."
  echo "   3. Archiver les tables héritées, une fois la reprise vérifiée :"
  echo "      sudo -u $SVC_USER env HOME=$ROOT \\"
  echo "        npm --prefix $ROOT/app run migrate:legacy -- --archiver"
  echo "   4. Déposer une clé de signature sur UN projet sans utilisateurs"
  echo "      en production, lancer un build, et confirmer que l'empreinte"
  echo "      affichée correspond. C'est le contrôle qui valide toute la"
  echo "      chaîne de signature (§7 du document de démarche)."
else
  echo "════ Des contrôles ont échoué ════"
  echo "  journalctl -u apkbuild-api -u apkbuild-web -n 40 --no-pager"
  echo
  echo "  Retour arrière : les sauvegardes sont dans $SAUVEGARDES."
  echo "  L'ancien service se relance par :"
  echo "    systemctl disable --now apkbuild-api apkbuild-web"
  echo "    systemctl enable --now apkbuild"
  exit 1
fi
