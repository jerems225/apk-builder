# Compiler des applications de bureau depuis un dépôt Git

**Objet** : étendre le builder aux applications Electron — `.exe`, `.msi`,
`.AppImage` — déclenchées par webhook, comme le sont déjà les APK Android.

**Statut** : note de conception. **Rien n'est implémenté.** À reprendre sur le
nouveau serveur.

**Rédigé le** : 29 juillet 2026, à la suite de la question « pourquoi ne pas
construire les exécutables depuis le service, via un dépôt Git ? »

---

## 1. La question, et ce qu'on croyait savoir

La branche `desktop` produit aujourd'hui les installateurs de Buildex **à la
main, sur un poste Windows**. Son README affirmait qu'il fallait Windows pour
produire des binaires Windows.

**C'est faux**, et la vérification tient en une ligne du code
d'`electron-builder` :

```js
// app-builder-lib/out/targets/MsiTarget.js:28
this.vm = process.platform === "win32" ? new VmManager() : new WineVmManager();
```

Hors Windows, `electron-builder` exécute `candle.exe` et `light.exe` de WiX
**sous Wine**. Il en va de même pour NSIS. La contrainte que l'on croyait
rédhibitoire n'existe pas.

> Leçon de méthode, valable au-delà de ce document : la réponse était dans
> `node_modules`, à trois minutes de lecture. Une contrainte « connue » qu'on
> n'a jamais vérifiée soi-même mérite d'être vérifiée avant de renoncer.

---

## 2. Ce qui est possible, ce qui ne l'est pas

| Cible | Sur Linux | Remarque |
|---|---|---|
| `.exe` NSIS | ✔ Wine | Le format que prennent neuf personnes sur dix |
| `.msi` WiX | ✔ Wine | Déploiement par stratégie de groupe |
| Portable `.exe` | ✔ Wine | |
| `.AppImage`, `.deb`, `.rpm` | ✔ nativement | |
| `.dmg` macOS | ✘ | Exige macOS, exactement comme iOS |
| Signature par `.pfx` | ✔ | `osslsigncode`, embarqué par `electron-builder` |
| Signature EV sur jeton matériel | ✘ | Un token USB ne se branche pas dans un conteneur |

Les deux impossibilités sont de même nature que celles déjà assumées côté
Android : elles tiennent au matériel, pas à la configuration. Les documenter
suffit ; les contourner demanderait une machine dédiée.

---

## 3. Le vrai coût n'est pas Wine

Ni l'image Docker de 3 Go, ni la lenteur de Wine.

**Aujourd'hui, un build égale un artefact.** Le schéma porte `apkName` et
`apkSize` au singulier ; `/dl/:id/:fichier` sert un fichier ; `/latest/` en sert
un. `docker/build.sh` prend d'ailleurs `find … | sort | head -1`.

Un build Electron produit **trois fichiers d'un coup**.

Il faut donc passer à un modèle **multi-artefacts**. C'est le préalable, et
c'est le seul morceau réellement structurant du chantier.

### 3.1 Ce que ça débloque au passage

Le même refactor lève une limite déjà consignée dans le README côté Android :
`splits.abi` produirait un APK par architecture, et la ligne `head -1`
en choisirait un au hasard. C'est écrit noir sur blanc dans « Limites connues ».

Autrement dit : **ce chantier ne sert pas que le bureau.** C'est ce qui le rend
rentable.

### 3.2 Forme proposée

```prisma
model Artifact {
  id       String @id @default(uuid())
  buildId  String
  build    Build  @relation(fields: [buildId], references: [id], onDelete: Cascade)

  nom      String   // nom de fichier, tel que produit
  taille   Int
  type     String   // apk | exe | msi | portable | appimage | deb
  cible    String?  // arm64-v8a, x64… ce qui distingue deux artefacts d'un build
  empreinte String? // SHA-256 apposée, pour les artefacts signés

  @@index([buildId])
}
```

`Build.apkName` et `Build.apkSize` restent, renseignés avec l'artefact principal :
les liens `/dl/` déjà distribués continuent de fonctionner, et la migration est
additive. Ils deviennent une commodité d'affichage, plus la source de vérité.

`/latest/<espace>/<dépôt>` doit alors désigner **quel** artefact : soit un
paramètre (`?type=exe`), soit un artefact marqué principal par projet. La
seconde forme garde les liens courts, qui sont ceux qu'on distribue.

---

## 4. Le reste est déjà en place

C'est l'argument principal en faveur de ce chantier : l'essentiel existe.

| Brique | État |
|---|---|
| Webhooks par espace, HMAC | ✔ |
| File d'attente, plafonds machine et espace | ✔ |
| Conteneur plafonné en CPU et mémoire | ✔ |
| Rétention, purge, journal d'audit | ✔ |
| Rôles, isolation multi-espaces | ✔ |
| Dépôt de secret chiffré par projet | ✔ — le `.pfx` réutilise l'écran du keystore |

Ce qu'il faut ajouter se limite à :

1. Un champ `type` sur le projet — `android` ou `electron`.
2. Une seconde image Docker, à partir d'`electronuserland/builder:wine`.
3. Un `docker/build-electron.sh`, sur le modèle de l'actuel.
4. Le modèle multi-artefacts de la §3.
5. Le dépôt du certificat `.pfx`, calqué sur celui du magasin de clés.

---

## 5. La question qui décide de l'ampleur

**Veut-on compiler les applications Electron des clients, ou seulement
automatiser la coquille Buildex ?**

Les deux réponses ne mènent pas au même travail :

- **Automatiser la coquille seule** — elle change deux ou trois fois par an. Un
  script de publication suffit ; monter un type de projet pour ça serait
  disproportionné.
- **Compiler les applications des clients** — là, tout le chantier se justifie,
  et la plateforme devient « Android *et* bureau depuis n'importe quel dépôt ».

**Cette question n'est pas tranchée.** Elle doit l'être avant d'écrire la
première ligne : elle décide si l'on fait un script ou une fonctionnalité.

---

## 6. Signature, à décider aussi

Même démarche que pour Android, mêmes conséquences :

- Un certificat `.pfx` **par projet**, chiffré comme les mots de passe de
  magasin, injecté par `CSC_LINK` et `CSC_KEY_PASSWORD`.
- Sans certificat, SmartScreen avertit à chaque première exécution. Un
  certificat OV classique lève l'avertissement progressivement, avec la
  réputation ; un certificat EV le lève immédiatement mais vit sur un jeton
  matériel — donc hors conteneur.
- Contrairement à Android, **perdre un certificat de signature Windows n'est pas
  fatal** : on en rachète un et les mises à jour continuent de s'installer. La
  contrainte est financière, pas définitive. C'est la différence de fond avec la
  clé Android, et elle change l'urgence.

---

## 7. Par où commencer, le jour venu

1. **Multi-artefacts d'abord**, sans rien changer d'autre. Le refactor se valide
   seul, sur les builds Android existants, et corrige `splits.abi` au passage.
2. Construire l'image Wine et faire tourner **un build Electron à la main**
   dedans, avant d'écrire la moindre ligne d'API. C'est ce qui dira si Wine tient
   la charge sur cette machine — un `.msi` sous Wine est le point le plus
   susceptible d'échouer, et il vaut mieux le savoir en premier.
3. Le champ `type` et l'aiguillage du worker.
4. Le certificat `.pfx`, en dernier : un build non signé est déjà utile.

---

## 8. Ce qui reste à vérifier sur la machine

À ne pas supposer :

- **Le `.msi` sous Wine aboutit-il réellement ?** La lecture du code prouve
  qu'`electron-builder` l'essaie, pas qu'il réussit. À valider par un build réel
  avant toute autre décision.
- Durée d'un build Electron sous Wine, comparée aux 3 à 10 minutes d'un APK.
- Place disque : l'image Wine s'ajoute aux 15 Go de `rn-android-builder:1`.
- Comportement de la file quand deux images différentes coexistent — les
  plafonds CPU et mémoire sont réglés pour Gradle, pas pour Wine.
