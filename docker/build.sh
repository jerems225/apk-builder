#!/usr/bin/env bash
# Script exécuté À L'INTÉRIEUR du conteneur de build.
# Entrées (variables d'environnement, toutes fournies par --env-file) :
#   REPO_URL          obligatoire  URL de clone https
#   GIT_REF           obligatoire  branche ou tag
#   GIT_TOKEN         optionnel    token injecté dans l'URL pour les dépôts privés
#   APP_SUBDIR        optionnel    sous-dossier du projet RN dans le dépôt (monorepo)
#   GRADLE_TASK       optionnel    défaut assembleDebug
#   ABIS              optionnel    architectures natives, défaut arm64-v8a
#   KEYSTORE_FILE     optionnel    chemin du magasin monté en lecture seule
#   KEYSTORE_ALIAS    requis si KEYSTORE_FILE
#   KEYSTORE_PASSWORD requis si KEYSTORE_FILE
#   BUILD_ID          informatif
# Sorties : APK + meta.json déposés dans /artifacts
set -Eeuo pipefail

APP_SUBDIR="${APP_SUBDIR:-.}"
GRADLE_TASK="${GRADLE_TASK:-assembleDebug}"
ABIS="${ABIS:-arm64-v8a}"
export HOME=/cache/home
mkdir -p "$HOME" /cache/gradle /cache/npm /cache/yarn

section() { echo; echo "──────── $* ────────"; }
fail()    { echo "ERREUR: $*" >&2; exit 1; }

# Toute sortie inattendue est tracée avec sa ligne : indispensable pour
# diagnostiquer un build cassé sans se reconnecter au serveur.
trap 'echo "ERREUR: échec ligne $LINENO (code $?)" >&2' ERR

# URL affichable, sans le token
SAFE_URL="$(echo "$REPO_URL" | sed -E 's#(https?://)[^@/]*@#\1#')"

section "Contexte"
echo "build       : ${BUILD_ID:-n/a}"
echo "dépôt       : $SAFE_URL"
echo "référence   : $GIT_REF"
echo "sous-dossier: $APP_SUBDIR"
echo "tâche       : $GRADLE_TASK"
echo "architectures: $ABIS"
echo "signature   : ${KEYSTORE_FILE:+clé de release}${KEYSTORE_FILE:-clé de debug}"
echo "node        : $(node --version)   java: $(java -version 2>&1 | head -1)"

section "Clone"
CLONE_URL="$REPO_URL"
if [ -n "${GIT_TOKEN:-}" ]; then
  # Fonctionne pour GitHub (x-access-token) comme pour GitLab (oauth2)
  CLONE_URL="$(echo "$REPO_URL" | sed -E "s#^https://#https://x-access-token:${GIT_TOKEN}@#")"
fi
git clone --depth 1 --recurse-submodules --shallow-submodules \
  --branch "$GIT_REF" "$CLONE_URL" /workspace/src 2>&1 \
  | sed -E "s#${GIT_TOKEN:-__none__}#***#g"

cd "/workspace/src/${APP_SUBDIR}"
[ -f package.json ] || fail "package.json introuvable dans '${APP_SUBDIR}' — vérifiez APP_SUBDIR"

COMMIT="$(git -C /workspace/src rev-parse --short HEAD)"
APP_NAME="$(node -p "require('./package.json').name || 'app'" | tr -c 'a-zA-Z0-9._-' '-')"
APP_VERSION="$(node -p "require('./package.json').version || '0.0.0'")"
echo "commit $COMMIT — $APP_NAME v$APP_VERSION"

section "Installation des dépendances"
if   [ -f yarn.lock ];      then echo "> yarn";  yarn install --frozen-lockfile --network-timeout 600000
elif [ -f pnpm-lock.yaml ]; then echo "> pnpm";  pnpm install --frozen-lockfile
elif [ -f bun.lockb ];      then echo "> bun";   npm install -g bun >/dev/null && bun install --frozen-lockfile
elif [ -f package-lock.json ]; then echo "> npm ci"; npm ci
else echo "> npm install (aucun lockfile)"; npm install
fi

# Distinction Expo managed / RN bare : c'est la présence du dossier android/
# qui tranche. Absent => on le génère avec prebuild, exactement comme EAS.
if [ ! -d android ]; then
  # Sans dossier android/ ET sans dépendance expo, prebuild échouerait sur une
  # erreur interne d'Expo, illisible. On tranche ici avec un message qui dit
  # quoi corriger.
  HAS_EXPO="$(node -p "const p=require('./package.json');(((p.dependencies||{}).expo)||((p.devDependencies||{}).expo))?1:0" 2>/dev/null || echo 0)"
  if [ "$HAS_EXPO" != "1" ]; then
    echo "Contenu de $(pwd) :" >&2
    ls -1 >&2
    fail "ni dossier 'android/' ni dépendance 'expo' dans ${APP_SUBDIR}/package.json.
       Projet bare  -> le dossier android/ doit être versionné dans le dépôt.
       Monorepo     -> renseignez le sous-dossier dans la fiche du projet (ex: apps/mobile).
       Projet Expo  -> 'expo' doit figurer dans les dependencies."
  fi
  section "Projet Expo managed détecté — génération du projet natif"
  npx --yes expo prebuild --platform android --no-install
  [ -d android ] || fail "expo prebuild n'a pas généré le dossier android/"
else
  section "Projet React Native bare détecté (android/ présent)"
fi

section "Compilation Gradle"
cd android
chmod +x ./gradlew
# --no-daemon : le conteneur est éphémère, un démon Gradle ne survivrait pas
#               et consommerait de la RAM pour rien.
# Xmx4g       : la moitié de la limite mémoire du conteneur, le reste sert
#               aux workers Kotlin/C++ qui tournent hors JVM Gradle.
# -PreactNativeArchitectures : lu par React Native >= 0.71, y compris dans le
#               gradle.properties généré par expo prebuild. Passer par la ligne
#               de commande plutôt que par le dépôt, sinon le prebuild efface
#               le réglage à chaque build. Silencieusement ignoré sous 0.71 :
#               le build réussit mais ne réduit rien, et le comparatif de taille
#               dans l'interface le révèle.
./gradlew "$GRADLE_TASK" \
  -PreactNativeArchitectures="$ABIS" \
  --no-daemon --console=plain --stacktrace \
  -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g"

section "Récupération de l'artefact"
# find | sort | head -1 suppose un seul APK produit. C'est vrai tant qu'on
# passe par -PreactNativeArchitectures, qui produit un APK unique. Un jour où
# l'on passerait à splits.abi, cette ligne devra être revue AVANT : elle
# choisirait une architecture au hasard.
APK_SRC="$(find app/build/outputs/apk -name '*.apk' -type f | sort | head -1)"
[ -n "$APK_SRC" ] || fail "aucun APK produit par la tâche $GRADLE_TASK"

SIGNED_WITH=""

section "Signature"
if [ -n "${KEYSTORE_FILE:-}" ]; then
  [ -r "$KEYSTORE_FILE" ]         || fail "magasin de clés illisible : $KEYSTORE_FILE"
  [ -n "${KEYSTORE_ALIAS:-}" ]    || fail "KEYSTORE_ALIAS manquant alors qu'un magasin est fourni"
  [ -n "${KEYSTORE_PASSWORD:-}" ] || fail "KEYSTORE_PASSWORD manquant alors qu'un magasin est fourni"

  BUILD_TOOLS="$(find "${ANDROID_SDK_ROOT:-$ANDROID_HOME}/build-tools" -maxdepth 1 -mindepth 1 -type d | sort -V | tail -1)"
  [ -n "$BUILD_TOOLS" ] || fail "build-tools introuvables dans le SDK Android"
  echo "build-tools : $BUILD_TOOLS"

  WORK_APK=/workspace/unsigned.apk
  cp "$APK_SRC" "$WORK_APK"

  # 1. Retirer la signature héritée du gabarit.
  #    Piège à connaître : le gabarit React Native déclare un signingConfig de
  #    release qui pointe vers la clé de DEBUG. assembleRelease ne produit donc
  #    pas un APK non signé, mais un APK signé avec la mauvaise clé. Sans cette
  #    étape, apksigner échoue ou empile deux signatures v1 incohérentes.
  zip -d "$WORK_APK" 'META-INF/*.RSA' 'META-INF/*.SF' 'META-INF/*.DSA' >/dev/null 2>&1 || true

  # 2. Aligner AVANT de signer : apksigner préserve l'alignement, l'inverse
  #    n'est pas vrai. zipalign après signature invaliderait la signature.
  "$BUILD_TOOLS/zipalign" -p -f 4 "$WORK_APK" /workspace/aligned.apk

  # 3. Signer en v2 + v3. v3 autorise une rotation de clé ultérieure, ce qui
  #    évite d'enfermer le projet dans la clé d'aujourd'hui.
  #    --ks-pass env: lit la variable au lieu de prendre le mot de passe en
  #    argument : invisible dans la table des processus du conteneur.
  "$BUILD_TOOLS/apksigner" sign \
    --ks "$KEYSTORE_FILE" \
    --ks-key-alias "$KEYSTORE_ALIAS" \
    --ks-pass env:KEYSTORE_PASSWORD \
    --key-pass env:KEYSTORE_PASSWORD \
    --v2-signing-enabled true \
    --v3-signing-enabled true \
    --out /workspace/signed.apk \
    /workspace/aligned.apk

  # 4. Relever l'empreinte réellement apposée. C'est le contrôle qui vaut :
  #    si elle diffère de celle enregistrée dans l'interface, la signature
  #    héritée n'a pas été retirée correctement.
  CERTS="$("$BUILD_TOOLS/apksigner" verify --print-certs /workspace/signed.apk)"
  echo "$CERTS"
  SIGNED_WITH="$(echo "$CERTS" | grep -i -m1 'SHA-256 digest' | sed -E 's/.*:\s*//' | tr -d ' ' || true)"

  APK_SRC=/workspace/signed.apk
  echo "signé avec l'alias $KEYSTORE_ALIAS"
else
  echo "aucune clé de release fournie — l'APK conserve la signature de debug."
  echo "Rappel : cette clé est publique et partagée, et un vidage du cache la"
  echo "régénère, ce qui casserait les mises à jour par-dessus l'existant."
fi

section "Dépôt de l'artefact"
APK_OUT="${APP_NAME}-${APP_VERSION}-${COMMIT}.apk"
cp "$APK_SRC" "/artifacts/${APK_OUT}"
APK_SIZE="$(stat -c%s "/artifacts/${APK_OUT}")"

# Vingt entrées les plus lourdes : sert à savoir CE QUI pèse, pas seulement
# combien. Sans cette trace, toute optimisation de taille se fait à l'aveugle.
section "Composition de l'APK"
unzip -l "/artifacts/${APK_OUT}" | sort -k1 -n -r | head -20 || true
echo "— bibliothèques natives par architecture —"
unzip -l "/artifacts/${APK_OUT}" | grep '/lib/' | awk '{s[$4]+=$1} END {for (a in s) print s[a], a}' | sort -rn || true

cat > /artifacts/meta.json <<JSON
{
  "apk_name": "${APK_OUT}",
  "apk_size": ${APK_SIZE},
  "app_name": "${APP_NAME}",
  "app_version": "${APP_VERSION}",
  "commit": "${COMMIT}",
  "gradle_task": "${GRADLE_TASK}",
  "abis": "${ABIS}",
  "signed_with": "${SIGNED_WITH}"
}
JSON

echo "APK : ${APK_OUT} ($(numfmt --to=iec-i --suffix=B "$APK_SIZE"))"
section "Terminé"
