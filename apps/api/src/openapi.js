'use strict';
const config = require('./config');
const roles = require('./lib/roles');

// Spécification écrite à la main plutôt que dérivée d'annotations : le
// document doit rester lisible seul, y compris par quelqu'un qui n'ouvrira
// jamais le code. Les descriptions y disent le « pourquoi », pas seulement le
// « quoi » — c'est ce qui distingue une doc utile d'un catalogue de champs.

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (schema, required = true) => ({
  required,
  content: { 'application/json': { schema } },
});
const jsonRes = (description, schema) => ({
  description,
  content: schema ? { 'application/json': { schema } } : undefined,
});

const ERRORS = {
  401: jsonRes('Session absente ou expirée', ref('Error')),
  403: jsonRes('Rôle insuffisant pour cette action', ref('Error')),
  404: jsonRes('Ressource inexistante dans cet espace', ref('Error')),
  422: jsonRes('Données invalides, détaillées champ par champ', ref('ValidationError')),
};

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'API du builder APK',
    version: '2.0.0',
    description: [
      'Service de compilation d’APK React Native (Expo managed et bare), déclenché',
      'par webhook Git ou manuellement.',
      '',
      '### Isolation',
      'Toutes les ressources appartiennent à un **espace de travail**. Les requêtes',
      'authentifiées par session portent l’en-tête `X-Workspace` (identifiant ou',
      'identifiant lisible de l’espace) ; sans lui, le premier espace du compte',
      'est utilisé.',
      '',
      '### Deux façons de s’authentifier',
      '- **Session** — cookie `' + config.cookieName + '` déposé par `POST /api/auth/login`.',
      '  C’est ce qu’utilise l’interface.',
      '- **Jeton machine** — en-tête `Authorization: Bearer apkb_…`, créé dans',
      '  Paramètres → Jetons API. Le jeton porte son espace : il ne peut rien',
      '  déclencher ailleurs.',
      '',
      '### Ce que l’API ne renvoie jamais',
      'Aucun secret ne ressort en clair : tokens Git, mots de passe de magasin de',
      'clés et secrets de webhook ne sont lisibles qu’à l’instant de leur création.',
      'Ensuite, seule une empreinte est affichée.',
    ].join('\n'),
  },
  servers: [{ url: config.publicUrl, description: 'Service' }],
  tags: [
    { name: 'Authentification', description: 'Connexion, session, mot de passe' },
    { name: 'Espaces', description: 'Espaces de travail et leur configuration' },
    { name: 'Projets', description: 'Dépôts suivis et clés de signature' },
    { name: 'Builds', description: 'Déclenchement, suivi, journaux' },
    { name: 'Connexions Git', description: 'Tokens d’accès aux dépôts privés' },
    { name: 'Équipe', description: 'Membres et rôles' },
    { name: 'Jetons API', description: 'Accès machine pour les CI' },
    { name: 'Webhooks', description: 'Points d’entrée appelés par le fournisseur Git' },
    { name: 'Téléchargement', description: 'Récupération des APK — routes publiques' },
  ],
  components: {
    securitySchemes: {
      session: {
        type: 'apiKey', in: 'cookie', name: config.cookieName,
        description: 'Cookie de session, httpOnly. Déposé par POST /api/auth/login.',
      },
      bearer: {
        type: 'http', scheme: 'bearer',
        description: 'Jeton machine `apkb_…` pour les CI tierces.',
      },
    },
    parameters: {
      Workspace: {
        name: 'X-Workspace', in: 'header', required: false,
        schema: { type: 'string' },
        description: 'Espace visé (identifiant ou slug). Par défaut : le premier du compte.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Projet introuvable dans cet espace.' } },
      },
      ValidationError: {
        type: 'object',
        properties: {
          error: { type: 'string' },
          details: {
            type: 'object', additionalProperties: { type: 'string' },
            example: { repoName: 'Format attendu : organisation/depot' },
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          isSuperAdmin: { type: 'boolean' },
          mustChangePassword: {
            type: 'boolean',
            description: 'Vrai après création par un administrateur : l’interface impose ' +
              'le changement avant tout autre écran.',
          },
          workspaces: { type: 'array', items: ref('WorkspaceMembership') },
        },
      },
      WorkspaceMembership: {
        type: 'object',
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' },
          role: { type: 'string', enum: roles.ORDER },
        },
      },
      Workspace: {
        type: 'object',
        properties: {
          id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' },
          role: { type: 'string', enum: roles.ORDER },
          retentionDays: { type: 'integer', description: '0 = conservation illimitée' },
          maxConcurrent: {
            type: 'integer',
            description: 'Builds simultanés autorisés pour cet espace, dans la limite du plafond machine.',
          },
          webhookUrl: { type: 'string' },
          webhookSecretHint: { type: 'string', example: 'aB3f••••x9Zq' },
        },
      },
      Project: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          repoName: { type: 'string', example: 'upjunoo/app-mobile' },
          repoUrl: { type: 'string' },
          appSubdir: { type: 'string', description: 'Sous-dossier du projet RN (monorepo). "." = racine.' },
          gradleTask: { type: 'string', example: 'assembleRelease' },
          branches: { type: 'array', items: { type: 'string' } },
          abis: {
            type: 'array', items: { type: 'string' },
            description: 'Architectures natives. arm64-v8a seul divise la taille de l’APK ' +
              'mais exclut les téléphones 32 bits et les émulateurs x86_64. ' +
              'Ignoré silencieusement sous React Native 0.71.',
          },
          buildTags: { type: 'boolean' },
          enabled: { type: 'boolean' },
          signing: ref('Signing'),
        },
      },
      Signing: {
        type: 'object',
        description: 'Clé de signature de release, propre au projet. Sans elle, l’APK ' +
          'conserve la signature de debug : installable en test, impubliable, et ' +
          'régénérée si le cache est vidé — ce qui casse les mises à jour.',
        properties: {
          configured: { type: 'boolean' },
          alias: { type: 'string' },
          fingerprint: { type: 'string', description: 'Empreinte SHA-256, seule trace lisible de la clé' },
          uploadedAt: { type: 'string', format: 'date-time' },
        },
      },
      Build: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          repoName: { type: 'string' },
          ref: { type: 'string' },
          refType: { type: 'string', enum: ['branch', 'tag'] },
          commitSha: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'running', 'success', 'failed', 'cancelled'] },
          source: { type: 'string', enum: ['webhook', 'manuel', 'api', 'relance'] },
          apkName: { type: 'string' },
          apkSize: { type: 'integer', description: 'Octets' },
          appVersion: { type: 'string' },
          signedWith: {
            type: 'string',
            description: 'Empreinte réellement apposée, relevée par apksigner. Une ' +
              'divergence avec celle du projet signale une régression de signature.',
          },
          durationSec: { type: 'integer' },
          downloadUrl: { type: 'string', description: 'Lien public et permanent' },
          error: { type: 'string' },
        },
      },
    },
  },
  security: [{ session: [] }],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Authentification'], summary: 'Ouvrir une session', security: [],
        description: 'Dépose un cookie de session httpOnly. Limité à 15 tentatives ' +
          'par tranche de 10 minutes et par adresse IP.',
        requestBody: jsonBody({
          type: 'object', required: ['email', 'password'],
          properties: { email: { type: 'string' }, password: { type: 'string' } },
        }),
        responses: {
          200: jsonRes('Session ouverte', { type: 'object', properties: { user: ref('User') } }),
          401: jsonRes('Identifiants incorrects', ref('Error')),
          429: jsonRes('Trop de tentatives', ref('Error')),
        },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Authentification'], summary: 'Fermer la session',
        description: 'Supprime la session côté serveur : le cookie devient inutilisable.',
        responses: { 200: jsonRes('Session fermée') },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Authentification'], summary: 'Compte connecté',
        responses: {
          200: jsonRes('Compte et espaces accessibles', { type: 'object', properties: { user: ref('User') } }),
          401: ERRORS[401],
        },
      },
    },
    '/api/auth/password': {
      post: {
        tags: ['Authentification'], summary: 'Changer son mot de passe',
        description: 'Ferme toutes les autres sessions du compte — comportement attendu ' +
          'd’un changement de mot de passe, et seul moyen de reprendre la main.',
        requestBody: jsonBody({
          type: 'object', required: ['currentPassword', 'newPassword'],
          properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' } },
        }),
        responses: { 200: jsonRes('Mot de passe changé'), 401: ERRORS[401], 400: ERRORS[422] },
      },
    },
    '/api/workspaces': {
      get: {
        tags: ['Espaces'], summary: 'Espaces accessibles',
        responses: { 200: jsonRes('Liste', { type: 'array', items: ref('Workspace') }) },
      },
      post: {
        tags: ['Espaces'], summary: 'Créer un espace',
        description: 'Réservé au super-administrateur : les espaces correspondent à des ' +
          'clients, pas à des préférences individuelles. Le secret de webhook complet ' +
          'n’est retourné qu’ici, une seule fois.',
        requestBody: jsonBody({
          type: 'object', required: ['name'],
          properties: { name: { type: 'string' }, slug: { type: 'string' } },
        }),
        responses: { 201: jsonRes('Espace créé', ref('Workspace')), 403: ERRORS[403] },
      },
    },
    '/api/workspaces/current': {
      get: {
        tags: ['Espaces'], summary: 'Espace courant',
        parameters: [{ $ref: '#/components/parameters/Workspace' }],
        responses: { 200: jsonRes('Espace', ref('Workspace')), 404: ERRORS[404] },
      },
      patch: {
        tags: ['Espaces'], summary: 'Modifier l’espace (rôle Propriétaire)',
        parameters: [{ $ref: '#/components/parameters/Workspace' }],
        requestBody: jsonBody({
          type: 'object',
          properties: {
            name: { type: 'string' },
            retentionDays: { type: 'integer', nullable: true },
            maxConcurrent: { type: 'integer' },
          },
        }),
        responses: { 200: jsonRes('Espace modifié', ref('Workspace')), 403: ERRORS[403] },
      },
    },
    '/api/workspaces/current/webhook-secret': {
      post: {
        tags: ['Espaces'], summary: 'Régénérer le secret de webhook',
        description: '⚠️ Casse immédiatement tous les webhooks déjà configurés chez le ' +
          'fournisseur Git : le nouveau secret doit être recopié partout.',
        parameters: [{ $ref: '#/components/parameters/Workspace' }],
        responses: { 200: jsonRes('Nouveau secret, lisible une seule fois', ref('Workspace')) },
      },
    },
    '/api/projects': {
      get: {
        tags: ['Projets'], summary: 'Projets de l’espace',
        parameters: [{ $ref: '#/components/parameters/Workspace' }],
        responses: { 200: jsonRes('Liste', { type: 'array', items: ref('Project') }) },
      },
      post: {
        tags: ['Projets'], summary: 'Enregistrer un projet (rôle Mainteneur)',
        parameters: [{ $ref: '#/components/parameters/Workspace' }],
        requestBody: jsonBody(ref('Project')),
        responses: {
          201: jsonRes('Projet créé', ref('Project')),
          409: jsonRes('Dépôt déjà enregistré dans cet espace', ref('Error')),
          422: ERRORS[422],
        },
      },
    },
    '/api/projects/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { $ref: '#/components/parameters/Workspace' },
      ],
      get: {
        tags: ['Projets'], summary: 'Détail d’un projet',
        responses: { 200: jsonRes('Projet', ref('Project')), 404: ERRORS[404] },
      },
      patch: {
        tags: ['Projets'], summary: 'Modifier un projet (rôle Mainteneur)',
        requestBody: jsonBody(ref('Project')),
        responses: { 200: jsonRes('Projet modifié', ref('Project')), 404: ERRORS[404] },
      },
      delete: {
        tags: ['Projets'], summary: 'Supprimer un projet (rôle Mainteneur)',
        description: 'La clé de signature part avec le projet. Les builds déjà produits ' +
          'sont conservés : les liens de téléchargement distribués restent valides.',
        responses: { 200: jsonRes('Projet supprimé'), 404: ERRORS[404] },
      },
    },
    '/api/projects/{id}/keystore': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { $ref: '#/components/parameters/Workspace' },
      ],
      post: {
        tags: ['Projets'], summary: 'Déposer la clé de signature (rôle Mainteneur)',
        description: [
          'Le magasin est validé par `keytool` **avant** d’être accepté : un mot de passe',
          'faux ou un fichier corrompu est refusé ici, pas au premier build raté.',
          '',
          '⚠️ Changer la clé d’une application déjà distribuée oblige chaque utilisateur à',
          'la désinstaller puis la réinstaller. Android refuse catégoriquement une mise à',
          'jour signée par une clé différente ; aucun contournement n’existe.',
        ].join('\n'),
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object', required: ['keystore', 'alias', 'password'],
                properties: {
                  keystore: { type: 'string', format: 'binary', description: 'Fichier .jks (PKCS12)' },
                  alias: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: jsonRes('Clé enregistrée, empreinte relevée', ref('Project')),
          400: jsonRes('Mot de passe faux, alias absent ou fichier illisible', ref('Error')),
        },
      },
      delete: {
        tags: ['Projets'], summary: 'Retirer la clé (rôle Propriétaire)',
        description: 'Les builds suivants repartent sur la signature de debug. Le retour ' +
          'arrière est complet côté serveur, pas côté utilisateur déjà équipé.',
        responses: { 200: jsonRes('Clé retirée', ref('Project')) },
      },
    },
    '/api/projects/{id}/keystore/generate': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { $ref: '#/components/parameters/Workspace' },
      ],
      post: {
        tags: ['Projets'], summary: 'Générer la clé côté serveur (rôle Mainteneur)',
        description: [
          'Crée un magasin **PKCS12**, tire le mot de passe au sort, relit le fichier produit',
          'pour en extraire l’empreinte réelle, puis le range en 0600 dans un répertoire',
          'qu’aucune route ne dessert.',
          '',
          'Pourquoi côté serveur : demander à chacun d’installer un JDK et de composer une',
          'ligne de `keytool` correcte produit des clés RSA 2048 valides un an et des mots de',
          'passe choisis à la main.',
          '',
          '⚠ Le magasin et son mot de passe ne sont retournés **qu’ici**. Une clé qui n’existe',
          'que sur ce serveur meurt avec lui, et l’application qu’elle signe ne peut alors plus',
          'jamais être mise à jour. L’interface refuse de fermer l’écran avant téléchargement.',
          '',
          'Remplacer une clé existante exige le rôle Propriétaire : l’opération oblige tous les',
          'utilisateurs à réinstaller l’application.',
        ].join('\n'),
        requestBody: jsonBody({
          type: 'object', required: ['alias', 'commonName'],
          properties: {
            alias: { type: 'string', example: 'app-livreur' },
            commonName: { type: 'string', description: 'CN du certificat', example: 'Application livreur' },
            organisation: { type: 'string' },
            ville: { type: 'string', example: 'Abidjan' },
            pays: { type: 'string', minLength: 2, maxLength: 2, example: 'CI' },
            validityDays: {
              type: 'integer', default: 10950,
              description: '≈ 30 ans. Une clé qui expire condamne l’application à changer d’identité.',
            },
            keySize: { type: 'integer', enum: [2048, 3072, 4096], default: 4096 },
          },
        }),
        responses: {
          201: jsonRes('Clé créée — mot de passe et magasin lisibles une seule fois', {
            allOf: [ref('Project'), {
              type: 'object',
              properties: {
                motDePasse: { type: 'string' },
                magasin: {
                  type: 'object',
                  properties: {
                    nom: { type: 'string' },
                    contenuBase64: { type: 'string', description: 'Fichier .jks encodé en base64' },
                  },
                },
              },
            }],
          }),
          400: jsonRes('keytool absent, alias invalide ou paramètres refusés', ref('Error')),
          403: jsonRes('Remplacement d’une clé existante : rôle Propriétaire requis', ref('Error')),
        },
      },
    },
    '/api/projects/{id}/keystore/export': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { $ref: '#/components/parameters/Workspace' },
      ],
      post: {
        tags: ['Projets'], summary: 'Exporter le magasin pour sauvegarde (rôle Propriétaire)',
        description: [
          'Pendant indispensable de la génération côté serveur : sans lui, une clé générée ici',
          'n’existerait qu’ici.',
          '',
          'Trois garde-fous, parce que la réponse contient une clé privée : rôle Propriétaire,',
          '**ré-authentification** par le mot de passe du compte — c’est ce qui distingue une',
          'demande légitime d’une session volée —, et inscription au journal d’audit. Limité à',
          'dix tentatives par heure.',
        ].join('\n'),
        requestBody: jsonBody({
          type: 'object', required: ['password'],
          properties: { password: { type: 'string', description: 'Mot de passe du compte appelant' } },
        }),
        responses: {
          200: jsonRes('Magasin et mot de passe', {
            type: 'object',
            properties: {
              nom: { type: 'string' },
              contenuBase64: { type: 'string' },
              alias: { type: 'string' },
              motDePasse: { type: 'string' },
              empreinte: { type: 'string' },
            },
          }),
          401: jsonRes('Mot de passe du compte incorrect', ref('Error')),
          403: ERRORS[403],
          429: jsonRes('Trop de tentatives', ref('Error')),
        },
      },
    },
    '/api/builds': {
      parameters: [{ $ref: '#/components/parameters/Workspace' }],
      get: {
        tags: ['Builds'], summary: 'Historique des builds',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'projectId', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Filtre sur dépôt ou référence' },
        ],
        responses: {
          200: jsonRes('Page de résultats', {
            type: 'object',
            properties: { total: { type: 'integer' }, items: { type: 'array', items: ref('Build') } },
          }),
        },
      },
      post: {
        tags: ['Builds'], summary: 'Lancer un build (rôle Développeur)',
        security: [{ session: [] }, { bearer: [] }],
        requestBody: jsonBody({
          type: 'object', required: ['ref'],
          properties: {
            projectId: { type: 'string', description: 'Reprend les réglages du projet' },
            repoUrl: { type: 'string', description: 'Si aucun projet n’est indiqué' },
            ref: { type: 'string', example: 'main' },
            refType: { type: 'string', enum: ['branch', 'tag'], default: 'branch' },
            gradleTask: { type: 'string' },
            abis: { type: 'string', example: 'arm64-v8a' },
          },
        }),
        responses: { 202: jsonRes('Build mis en file', ref('Build')), 404: ERRORS[404] },
      },
    },
    '/api/builds/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { $ref: '#/components/parameters/Workspace' },
      ],
      get: {
        tags: ['Builds'], summary: 'Détail d’un build',
        responses: { 200: jsonRes('Build', ref('Build')), 404: ERRORS[404] },
      },
      delete: {
        tags: ['Builds'], summary: 'Supprimer un build et son APK (rôle Mainteneur)',
        responses: { 200: jsonRes('Supprimé'), 409: jsonRes('Build en cours', ref('Error')) },
      },
    },
    '/api/builds/{id}/log': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { $ref: '#/components/parameters/Workspace' },
      ],
      get: {
        tags: ['Builds'], summary: 'Journal de compilation',
        description: 'Les journaux Gradle atteignent plusieurs Mo : seule la fin est ' +
          'renvoyée (400 Ko), avec une mention explicite de la troncature.',
        responses: { 200: jsonRes('Journal', { type: 'object', properties: { log: { type: 'string' } } }) },
      },
    },
    '/api/builds/{id}/rerun': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { $ref: '#/components/parameters/Workspace' },
      ],
      post: {
        tags: ['Builds'], summary: 'Relancer à l’identique (rôle Développeur)',
        responses: { 202: jsonRes('Nouveau build en file', ref('Build')) },
      },
    },
    '/api/builds/{id}/cancel': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { $ref: '#/components/parameters/Workspace' },
      ],
      post: {
        tags: ['Builds'], summary: 'Interrompre un build (rôle Développeur)',
        responses: { 200: jsonRes('Interruption demandée'), 409: jsonRes('Déjà terminé', ref('Error')) },
      },
    },
    '/api/webhooks/{slug}': {
      post: {
        tags: ['Webhooks'], summary: 'Point d’entrée du fournisseur Git', security: [],
        description: [
          'Une URL par espace de travail. Le corps est authentifié par le secret de',
          'l’espace : HMAC-SHA256 pour GitHub, Gitea et Forgejo (`X-Hub-Signature-256`),',
          'jeton en clair pour GitLab (`X-Gitlab-Token`), `X-Build-Token` pour un',
          'déclencheur générique.',
          '',
          'Une requête refusée renvoie la raison exacte du rejet : elle s’affiche dans',
          '« Recent Deliveries » côté GitHub, ce qui évite d’ouvrir le serveur pour',
          'diagnostiquer.',
        ].join('\n'),
        parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          202: jsonRes('Build mis en file'),
          200: jsonRes('Évènement reçu mais non retenu (branche non surveillée, ping…)'),
          401: jsonRes('Signature invalide', ref('Error')),
        },
      },
    },
    '/dl/{buildId}/{fichier}': {
      get: {
        tags: ['Téléchargement'], summary: 'Télécharger l’APK d’un build', security: [],
        description: '**Route publique et permanente.** Choix assumé : les APK sont ' +
          'distribués à des utilisateurs sans compte. Toute personne disposant de l’URL ' +
          'peut télécharger l’application.',
        parameters: [
          { name: 'buildId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'fichier', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Fichier APK' }, 404: { description: 'Purgé ou inexistant' } },
      },
    },
    '/latest/{espace}/{org}/{depot}': {
      get: {
        tags: ['Téléchargement'], summary: 'Dernier APK réussi d’un dépôt', security: [],
        description: 'Le lien qu’on distribue : il ne change pas d’une version à l’autre.',
        parameters: [
          { name: 'espace', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'org', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'depot', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { 200: { description: 'Fichier APK' }, 404: { description: 'Aucun build réussi' } },
      },
    },
    '/healthz': {
      get: {
        tags: ['Espaces'], summary: 'État du service', security: [],
        responses: {
          200: jsonRes('Service en vie', {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              running: { type: 'integer' },
              limit: { type: 'integer' },
            },
          }),
        },
      },
    },
  },
};

module.exports = spec;
