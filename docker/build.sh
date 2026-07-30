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

# Résolu hors du bloc de signature : la vérification d'installabilité en a
# besoin, qu'une clé de release ait été fournie ou non.
BUILD_TOOLS="$(find "${ANDROID_SDK_ROOT:-$ANDROID_HOME}/build-tools" -maxdepth 1 -mindepth 1 -type d | sort -V | tail -1)"
[ -n "$BUILD_TOOLS" ] || fail "build-tools introuvables dans le SDK Android"
echo "build-tools : $BUILD_TOOLS"

section "Signature"
if [ -n "${KEYSTORE_FILE:-}" ]; then
  [ -r "$KEYSTORE_FILE" ]         || fail "magasin de clés illisible : $KEYSTORE_FILE"
  [ -n "${KEYSTORE_ALIAS:-}" ]    || fail "KEYSTORE_ALIAS manquant alors qu'un magasin est fourni"
  [ -n "${KEYSTORE_PASSWORD:-}" ] || fail "KEYSTORE_PASSWORD manquant alors qu'un magasin est fourni"

  # 1. Aligner AVANT de signer : apksigner préserve l'alignement, l'inverse
  #    n'est pas vrai. zipalign après signature invaliderait la signature.
  #
  #    Et RIEN d'autre entre Gradle et apksigner. Il y avait ici un
  #    `zip -d META-INF/*.RSA` censé retirer la signature de debug héritée du
  #    gabarit React Native. Deux raisons de ne pas le remettre : apksigner
  #    remplace de lui-même les signatures existantes, v1 comme v2/v3, donc
  #    l'étape était sans objet ; et Info-ZIP ignore l'APK Signing Block que
  #    Gradle place avant le catalogue central, si bien qu'il réécrivait
  #    l'archive autour d'un bloc qu'il ne comprenait pas.
  "$BUILD_TOOLS/zipalign" -p -f 4 "$APK_SRC" /workspace/aligned.apk

  # 2. Signer en v2 + v3. v3 autorise une rotation de clé ultérieure, ce qui
  #    évite d'enfermer le projet dans la clé d'aujourd'hui. v1 reste laissé au
  #    choix d'apksigner, qui l'active selon le minSdk lu dans le manifeste :
  #    le forcer n'apporterait rien au-dessus d'Android 7 et échoue sur les
  #    archives aux noms d'entrées non-ASCII.
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

  APK_SRC=/workspace/signed.apk
  echo "signé avec l'alias $KEYSTORE_ALIAS"
else
  echo "aucune clé de release fournie — l'APK conserve la signature produite"
  echo "par Gradle, celle de debug pour les tâches et gabarits usuels."
  echo "Rappel : cette clé est publique et partagée, et un vidage du cache la"
  echo "régénère, ce qui casserait les mises à jour par-dessus l'existant."
  echo "Ce que Gradle a réellement apposé est constaté plus bas, pas supposé."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Porte d'installabilité. Rien ne sort d'ici sans être passé par là.
#
# Raison d'être : jusqu'au 30 juillet 2026, un APK était déposé dans
# /artifacts dès que Gradle rendait la main. On apprenait qu'il ne s'installait
# pas par l'utilisateur final, jamais par le build. Les contrôles ci-dessous
# sont ceux qu'un téléphone applique, exécutés ici pendant qu'il est encore
# temps.
# ─────────────────────────────────────────────────────────────────────────────
section "Vérification d'installabilité"

# 1. La signature doit passer la vérification COMPLÈTE, pas seulement livrer
#    une empreinte. `verify --print-certs` seul réussissait sur un paquet
#    qu'Android aurait refusé : c'est --verbose qui dit quels schémas sont là.
VERIFY_OUT="$("$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK_SRC" 2>&1)" || {
  echo "$VERIFY_OUT" >&2
  fail "l'APK ne passe pas la vérification de signature — il serait refusé à l'installation"
}
echo "$VERIFY_OUT"

SIGNED_WITH="$(echo "$VERIFY_OUT" | grep -i -m1 'certificate SHA-256 digest' | sed -E 's/.*:[[:space:]]*//' | tr -d ' ' || true)"
[ -n "$SIGNED_WITH" ] || fail "aucun certificat relevé sur l'APK : paquet non signé"

# 2. Au moins un schéma de signature doit être actif. Un APK sans aucun schéma
#    est systématiquement rejeté, sur tous les appareils.
SIG_SCHEMES=""
for s in v1:1 v2:2 v3:3 v4:4; do
  label="${s%%:*}"; num="${s##*:}"
  if echo "$VERIFY_OUT" | grep -qiE "Verified using v${num} scheme.*true"; then
    SIG_SCHEMES="${SIG_SCHEMES}${SIG_SCHEMES:+,}${label}"
  fi
done
[ -n "$SIG_SCHEMES" ] || fail "aucun schéma de signature actif (ni v1, ni v2, ni v3)"
echo "schémas de signature : $SIG_SCHEMES"

# 3. Identité du paquet. Consignée systématiquement : c'est l'applicationId, et
#    non le nom du dépôt, qui décide si une installation écrase une application
#    existante ou se heurte à elle. Deux projets qui partagent un applicationId
#    ne peuvent pas cohabiter sur un même téléphone.
BADGING="$("$BUILD_TOOLS/aapt2" dump badging "$APK_SRC" 2>/dev/null)" || BADGING=""
APP_ID=""; VERSION_CODE=""; MIN_SDK=""; TARGET_SDK=""; APK_ABIS=""
if [ -n "$BADGING" ]; then
  APP_ID="$(echo "$BADGING"       | sed -nE "s/^package: name='([^']+)'.*/\1/p"           | head -1)"
  VERSION_CODE="$(echo "$BADGING" | sed -nE "s/^package:.*versionCode='([^']*)'.*/\1/p"   | head -1)"
  MIN_SDK="$(echo "$BADGING"      | sed -nE "s/^sdkVersion:'([^']*)'.*/\1/p"              | head -1)"
  TARGET_SDK="$(echo "$BADGING"   | sed -nE "s/^targetSdkVersion:'([^']*)'.*/\1/p"        | head -1)"
  APK_ABIS="$(echo "$BADGING"     | sed -nE "s/^native-code: (.*)/\1/p" | tr -d "'" | tr ' ' ',' | head -1)"
  echo "applicationId : ${APP_ID:-inconnu}   versionCode : ${VERSION_CODE:-inconnu}"
  echo "minSdk : ${MIN_SDK:-?}   targetSdk : ${TARGET_SDK:-?}"
  echo "architectures réellement embarquées : ${APK_ABIS:-aucune}"
  [ -n "$APP_ID" ] || fail "applicationId illisible : le manifeste est inexploitable"
else
  echo "aapt2 n'a pas pu lire le paquet — contrôle d'identité impossible" >&2
  fail "le manifeste de l'APK est illisible : Android afficherait « problème d'analyse du package »"
fi

# 4. Les architectures demandées doivent être servies. Un APK dépourvu de
#    l'architecture du téléphone échoue à l'installation avec le message
#    générique « L'application n'a pas été installée », sans autre indice.
if [ -n "$APK_ABIS" ]; then
  MATCH=0
  for want in ${ABIS//,/ }; do
    case ",$APK_ABIS," in *",$want,"*) MATCH=1 ;; esac
  done
  [ "$MATCH" = "1" ] || fail "aucune des architectures demandées ($ABIS) n'est présente dans l'APK ($APK_ABIS)"
fi

# 5. Un APK debug s'installe mais réclame Metro au lancement. Ce n'est pas un
#    échec de build, mais l'utilisateur qui le reçoit croit à une application
#    cassée : on le dit ici, pas après coup.
if ! unzip -l "$APK_SRC" | grep -q 'assets/index.android.bundle'; then
  echo "AVERTISSEMENT : aucun bundle JS embarqué. Cet APK a besoin d'un serveur"
  echo "Metro joignable pour démarrer — ne le distribuez pas à un utilisateur final."
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

# application_id et version_code sont consignés pour être comparés d'un build
# au suivant : c'est le seul moyen de repérer un applicationId réutilisé entre
# deux projets, ou une clé qui change sous une identité inchangée — les deux
# cas où l'installation échoue chez l'utilisateur alors que l'APK est sain.
cat > /artifacts/meta.json <<JSON
{
  "apk_name": "${APK_OUT}",
  "apk_size": ${APK_SIZE},
  "app_name": "${APP_NAME}",
  "app_version": "${APP_VERSION}",
  "commit": "${COMMIT}",
  "gradle_task": "${GRADLE_TASK}",
  "abis": "${ABIS}",
  "signed_with": "${SIGNED_WITH}",
  "signature_schemes": "${SIG_SCHEMES}",
  "application_id": "${APP_ID}",
  "version_code": "${VERSION_CODE}",
  "min_sdk": "${MIN_SDK}",
  "target_sdk": "${TARGET_SDK}",
  "apk_abis": "${APK_ABIS}"
}
JSON

echo "APK : ${APK_OUT} ($(numfmt --to=iec-i --suffix=B "$APK_SIZE"))"
section "Terminé"
