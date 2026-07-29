# Image de build Android pour projets React Native (Expo managed + bare).
# Construite une fois, réutilisée par tous les builds. Volontairement lourde :
# tout ce qui est pré-installé ici est du temps gagné sur chaque build.
FROM eclipse-temurin:17-jdk-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    GRADLE_USER_HOME=/cache/gradle \
    npm_config_cache=/cache/npm \
    YARN_CACHE_FOLDER=/cache/yarn \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git unzip zip python3 file \
      build-essential libglu1-mesa openssl \
 && rm -rf /var/lib/apt/lists/*

# Node 20 : version alignée sur celle de l'hôte, compatible RN 0.73 -> 0.81
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

# Android SDK command line tools
ARG CMDLINE_TOOLS=commandlinetools-linux-11076708_latest.zip
RUN mkdir -p ${ANDROID_HOME}/cmdline-tools \
 && curl -fsSL -o /tmp/cmdtools.zip https://dl.google.com/android/repository/${CMDLINE_TOOLS} \
 && unzip -q /tmp/cmdtools.zip -d /tmp/cmdtools \
 && mv /tmp/cmdtools/cmdline-tools ${ANDROID_HOME}/cmdline-tools/latest \
 && rm -rf /tmp/cmdtools /tmp/cmdtools.zip

ENV PATH=${PATH}:${ANDROID_HOME}/cmdline-tools/latest/bin:${ANDROID_HOME}/platform-tools

# platforms 34 et 35 : couvre RN 0.73 -> 0.81.
# NDK + cmake : obligatoires, la nouvelle architecture RN (défaut depuis 0.76)
# compile du C++ à chaque build applicatif.
RUN yes | sdkmanager --licenses > /dev/null 2>&1 || true
RUN sdkmanager --install \
      "platform-tools" \
      "platforms;android-35" "build-tools;35.0.0" \
      "platforms;android-34" "build-tools;34.0.0" \
      "cmake;3.22.1" \
      "ndk;27.1.12297006" \
      "ndk;26.1.10909125" > /dev/null

# Le conteneur tourne sous l'UID de l'hôte (pas root) pour que les artefacts
# écrits dans les volumes montés restent lisibles et supprimables côté hôte.
# Le SDK doit donc rester inscriptible : Gradle y télécharge parfois un
# build-tools manquant réclamé par un projet.
RUN chmod -R a+rwX ${ANDROID_HOME}

COPY build.sh /usr/local/bin/build.sh
RUN chmod 0755 /usr/local/bin/build.sh

WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/build.sh"]
