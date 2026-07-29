# Migrer le builder sur un autre serveur

**Objet** : déplacer une installation complète — données, clés de signature,
artefacts — vers une nouvelle machine, sans perdre de clé et sans casser les
liens de téléchargement déjà distribués.

**Durée** : 45 à 90 minutes, dont 20 à 30 d'attente pendant la construction de
l'image Docker.

**Interruption de service** : de quelques minutes à une heure selon la taille
des artefacts. La §7 explique comment la réduire à quelques minutes.

---

## 1. Ce qui doit voyager, et ce qui se régénère

C'est la seule chose à connaître par cœur. Tout le reste découle de ce tableau.

| Chemin | Nature | À copier ? |
|---|---|---|
| `/srv/apkbuild/keystores/` | **Clés de signature privées** | **Oui — irremplaçable** |
| `/srv/apkbuild/.env` | Clé maîtresse, secrets | **Oui — irremplaçable** |
| `/srv/apkbuild/data/apkbuild.db` | Base : comptes, projets, builds | **Oui** |
| `/srv/apkbuild/artifacts/` | APK produits + journaux | Oui, si les liens doivent survivre |
| `/srv/apkbuild/cache/` | Cache Gradle, npm, clé de debug | Facultatif, voir §1.1 |
| `/srv/apkbuild/work/` | Espaces de build en cours | Non — éphémère |
| `/srv/apkbuild/app/` | Code | Non — vient de Git |
| `node_modules`, `.next` | Dépendances, build | Non — reconstruits |
| Image `rn-android-builder:1` | 15 Go | Non — reconstruite |

**Les deux premières lignes sont le cœur du sujet.** Sans les clés, les
applications déjà distribuées ne peuvent plus jamais être mises à jour. Sans
le `.env`, la clé maîtresse est perdue : les jetons Git, les mots de passe de
magasins et les secrets de webhook deviennent illisibles — donc les clés
elles-mêmes, dont le mot de passe est chiffré avec.

> **Copiez `.env` et `keystores/` ensemble, ou ni l'un ni l'autre.** L'un sans
> l'autre ne vaut rien.

### 1.1 Le cas du cache

`cache/home/.android/debug.keystore` est la clé de debug. Les projets qui n'ont
pas encore de clé de release signent avec elle. La laisser derrière signifie
que leurs APK changeront d'identité de signature : les utilisateurs devront
désinstaller avant de réinstaller.

Deux options honnêtes :

- **Copier `cache/home/`** (quelques Mo) : les projets non migrés continuent de
  fonctionner à l'identique. Recommandé.
- **Profiter de la migration** pour donner une vraie clé de release à ces
  projets. Le changement d'identité a lieu de toute façon, autant qu'il soit le
  dernier.

Le reste du cache (`cache/gradle`, `cache/npm`) pèse plusieurs Go et se
reconstitue seul. Ne le copiez que si la bande passante est gratuite et le
temps compté : il fait gagner 5 à 10 minutes sur le premier build.

---

## 2. Prérequis sur la nouvelle machine

```bash
# Ubuntu 22.04 ou 24.04
sudo apt-get update
sudo apt-get install -y docker.io git curl rsync openssl
sudo systemctl enable --now docker

# Node 20 ou plus
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
node -v   # doit afficher v20 ou plus

# Frontal web
sudo apt-get install -y apache2
sudo a2enmod proxy proxy_http headers ssl rewrite
```

`keytool` n'est **pas** à installer : `deploy/install.sh` s'en charge.

**Dimensionnement** : comptez au minimum 4 vCPU, 8 Go de RAM et 60 Go de disque,
plus la taille de vos artefacts. L'image Docker à elle seule pèse 15 Go. Un
build Gradle consomme jusqu'à 8 Go de RAM.

Vérifiez l'espace avant de commencer :

```bash
du -sh /srv/apkbuild/*          # sur l'ancien serveur
df -h /                         # sur le nouveau
```

---

## 3. Sauvegarde, avant tout

Sur **l'ancien** serveur :

```bash
sudo systemctl stop apkbuild-api apkbuild-web

sudo tar czf /root/apkbuild-migration-$(date +%F).tgz \
  -C / \
  srv/apkbuild/.env \
  srv/apkbuild/data \
  srv/apkbuild/keystores \
  srv/apkbuild/cache/home

sudo chmod 600 /root/apkbuild-migration-*.tgz
ls -lh /root/apkbuild-migration-*.tgz
```

Cette archive contient **toutes vos clés privées et tous vos secrets**.
Traitez-la comme telle : `0600`, jamais dans un dossier partagé, effacée des
deux machines une fois la migration validée.

Rapatriez-en une copie sur un troisième support avant de continuer. Une
migration qui tourne mal avec une seule copie de l'archive, sur la machine
qu'on est en train de démonter, n'a pas de retour arrière.

---

## 4. Transfert

### 4.1 L'essentiel — petit et critique

```bash
# Depuis votre poste
scp ancien-serveur:/root/apkbuild-migration-*.tgz .
scp apkbuild-migration-*.tgz nouveau-serveur:/root/
```

Ou directement de serveur à serveur si l'un peut joindre l'autre :

```bash
sudo rsync -avz --info=progress2 \
  /srv/apkbuild/.env /srv/apkbuild/data /srv/apkbuild/keystores \
  /srv/apkbuild/cache/home \
  nouveau-serveur:/tmp/apkbuild-migration/
```

### 4.2 Les artefacts — volumineux, non critiques

```bash
sudo rsync -az --info=progress2 --partial \
  /srv/apkbuild/artifacts/ \
  nouveau-serveur:/tmp/apkbuild-artifacts/
```

`--partial` permet de reprendre une copie interrompue. Cette étape peut tourner
**pendant que l'ancien serveur est encore en service** : les artefacts déjà
produits ne changent plus. Voir §7.

---

## 5. Installation sur la nouvelle machine

```bash
git clone https://github.com/jerems225/apk-builder.git ~/apk-builder
cd ~/apk-builder
chmod +x deploy/*.sh docker/*.sh

# 1. Créer l'arborescence et le compte de service, sans démarrer.
#    --skip-vhost : le DNS pointe encore vers l'ancien serveur, certbot
#    échouerait. On y reviendra en §6.
sudo SERVER_NAME=build.exemple.tech ./deploy/install.sh --skip-vhost

# 2. Restaurer les données PAR-DESSUS, service arrêté.
sudo systemctl stop apkbuild-api apkbuild-web
sudo tar xzf /root/apkbuild-migration-*.tgz -C /

# 3. Artefacts, si copiés.
sudo rsync -a /tmp/apkbuild-artifacts/ /srv/apkbuild/artifacts/

# 4. Remettre les droits — un tar restauré par root appartient à root.
sudo chown -R apkbuild:apkbuild /srv/apkbuild
sudo chmod 700 /srv/apkbuild/keystores
sudo chmod 600 /srv/apkbuild/.env
sudo find /srv/apkbuild/keystores -type f -exec chmod 600 {} +

# 5. Adapter le .env au nouveau nom d'hôte, si celui-ci change.
sudo nano /srv/apkbuild/.env      # PUBLIC_URL et WEB_ORIGIN

# 6. Relancer l'installation complète : schéma, interface, image, services.
sudo SERVER_NAME=build.exemple.tech ./deploy/install.sh --skip-vhost
```

L'étape 6 applique `prisma db push` sur la base restaurée. C'est additif : une
base déjà à jour n'est pas modifiée.

### 5.1 Vérifier avant d'ouvrir au public

```bash
curl -s http://127.0.0.1:9100/healthz
# {"ok":true,"running":0,"limit":2,"crypto":true}
```

`"crypto":true` est le contrôle qui compte : il signifie que la clé maîtresse a
été restaurée et fonctionne. **S'il est à `false`, arrêtez-vous** — le `.env`
n'a pas suivi, et rien de ce qui est chiffré ne sera lisible.

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/connexion   # 200
sudo -u apkbuild ls -l /srv/apkbuild/keystores/     # vos .jks, en -rw-------
sudo journalctl -u apkbuild-api -n 30 --no-pager
```

Connectez-vous en passant par un tunnel, sans toucher au DNS :

```bash
ssh -L 8080:127.0.0.1:3000 nouveau-serveur
# puis http://localhost:8080 dans le navigateur
```

Vérifiez : vos espaces, vos projets, l'historique des builds, et surtout
**l'empreinte de chaque clé de signature** dans Projets → Gérer la clé. Elle
doit être identique à celle de l'ancien serveur.

---

## 6. Bascule du DNS et du TLS

Une fois la vérification faite :

```bash
# 1. Abaisser le TTL de l'enregistrement DNS à 300 s, la veille si possible.
# 2. Faire pointer l'enregistrement A vers la nouvelle IP.
# 3. Attendre la propagation.
dig +short build.exemple.tech

# 4. Vhost et certificat, une fois le DNS à jour.
cd ~/apk-builder
sudo SERVER_NAME=build.exemple.tech ./deploy/install.sh --skip-image --skip-web
sudo certbot --apache -d build.exemple.tech
```

`certbot` valide par HTTP : le DNS **doit** pointer vers la nouvelle machine
avant, sinon la demande échoue.

### 6.1 Contrôles publics

```bash
curl -s https://build.exemple.tech/healthz
curl -s -o /dev/null -w '%{http_code}\n' https://build.exemple.tech/connexion
curl -s -o /dev/null -D - https://build.exemple.tech/builds/UN_ID_EXISTANT | grep -i location
```

La dernière commande doit renvoyer un `Location` **absolu, en https, sur le bon
domaine**. Un `localhost` ici signale que le vhost ne pose pas
`X-Forwarded-Proto` — voir §8.

Testez enfin un lien de téléchargement réel, celui d'un APK déjà distribué :

```bash
curl -sI https://build.exemple.tech/dl/<build>/<fichier>.apk | head -3
```

---

## 7. Réduire l'interruption de service

L'ordre ci-dessus est simple mais arrête le service pendant toute la copie. Pour
descendre à quelques minutes :

1. **J-1** — Installer la nouvelle machine (§2 et §5 étape 1), construire
   l'image Docker, abaisser le TTL du DNS à 300 s.
2. **J-1** — Copier les artefacts en `rsync`, **ancien serveur en service**.
   Ils ne changent plus une fois produits.
3. **Jour J** — Arrêter les services, refaire un `rsync` des artefacts (il ne
   copiera que les nouveaux), puis transférer base, `.env` et clés.
4. **Jour J** — Démarrer, vérifier par tunnel, basculer le DNS.

L'interruption se limite alors à l'étape 3, soit quelques minutes.

---

## 8. Après la bascule

### 8.1 Les webhooks

L'URL ne change pas si le nom de domaine ne change pas — **rien à faire**.

Si le domaine change, chaque webhook doit être repointé chez le fournisseur Git.
Les URL sont dans Paramètres → Webhook, une par espace. Le secret, lui, est
conservé : il vient de la base restaurée.

Pour repérer les hooks encore posés sur l'ancienne adresse :

```bash
sudo journalctl -u apkbuild-api -f | grep -i webhook
```

### 8.2 Le premier build

Lancez un build réel avant d'annoncer la migration terminée. C'est le seul test
qui vérifie la chaîne complète : Docker, clone Git avec un jeton déchiffré,
Gradle, et **signature avec la clé restaurée**.

Sur l'écran du build, l'empreinte apposée doit correspondre à celle du projet.
Une divergence s'affiche en rouge.

### 8.3 Effacer les copies

```bash
# Les deux serveurs
sudo shred -u /root/apkbuild-migration-*.tgz
sudo rm -rf /tmp/apkbuild-migration /tmp/apkbuild-artifacts
```

Gardez l'ancien serveur en l'état une à deux semaines avant de le détruire.
C'est votre retour arrière.

---

## 9. Retour arrière

Tant que l'ancien serveur existe et que ses données sont intactes :

```bash
# 1. Remettre le DNS sur l'ancienne IP.
# 2. Sur l'ancien serveur
sudo systemctl start apkbuild-api apkbuild-web
```

**Ce qui ne revient pas en arrière** : les builds lancés sur la nouvelle machine
pendant la fenêtre de bascule. Ils n'existent que là-bas. C'est une raison de
plus pour ne pas laisser passer de webhook pendant la migration — désactivez
temporairement les projets, ou prévenez les équipes de ne pas pousser.

---

## 10. Pièges rencontrés en conditions réelles

Chacun a coûté une intervention. Ils sont corrigés dans le dépôt, mais restent
utiles à connaître pour diagnostiquer.

**`sudo` demande un mot de passe.** Aucun script de déploiement ne peut tourner
sans terminal interactif. Lancez-les vous-même, ou posez une règle
`/etc/sudoers.d/` limitée — en validant sa syntaxe par `visudo -cf` avant de
l'installer, un fichier malformé coupant `sudo` entièrement.

**Le vhost TLS n'est pas le vhost HTTP.** `certbot` produit un
`<domaine>-le-ssl.conf` en recopiant le vhost `:80` du moment. Modifier
seulement le `:80` laisse le trafic HTTPS — donc tout le trafic réel — sur
l'ancienne configuration. `install.sh` reconstruit les deux ; si vous éditez à
la main, éditez les deux.

**`prisma db push` ne lit pas la configuration de l'application.** La CLI Prisma
veut `DATABASE_URL` dans l'environnement. Passez par `npm run db:push`, qui
charge `config.js` d'abord. Un `npx prisma` direct échoue sur `P1012`.

**CRLF.** Un fichier édité sous Windows casse les shebangs côté Linux.
`.gitattributes` impose `eol=lf` ; en cas de doute :
`file deploy/install.sh` doit dire « ASCII text », pas « with CRLF line
terminators ».

**`keytool` absent.** Sans Java, la génération de clés n'est pas proposée dans
l'interface et le dépôt d'un `.jks` échoue. `install.sh` installe
`openjdk-17-jre-headless` ; en repli, le service utilise le JDK de l'image
Docker.

**Encodage.** Ne manipulez pas les fichiers source avec `Get-Content` /
`Set-Content` de PowerShell 5.1 : ils ne lisent pas l'UTF-8 sans BOM et
transforment silencieusement les accents. Un `git diff` qui montre des lignes
entières modifiées sans raison est le symptôme.

---

## 11. Contrôle final

- [ ] `/healthz` renvoie `"crypto":true` — la clé maîtresse est restaurée
- [ ] Les empreintes des clés de signature sont identiques à l'ancien serveur
- [ ] `/srv/apkbuild/keystores` en `drwx------`, les `.jks` en `-rw-------`
- [ ] `/srv/apkbuild/.env` en `-rw-------`, propriété `apkbuild`
- [ ] Connexion à l'interface, espaces et historique présents
- [ ] Un lien de téléchargement déjà distribué fonctionne encore
- [ ] Une redirection renvoie une URL absolue en https sur le bon domaine
- [ ] Un build réel réussit, avec l'empreinte de signature attendue
- [ ] Webhooks repointés si le domaine a changé, et un push déclenche bien
- [ ] Archive de migration effacée des deux machines
- [ ] Ancien serveur conservé une à deux semaines

---

## 12. Réutiliser cette installation ailleurs

Pour monter une **seconde** instance plutôt que déplacer celle-ci — un
environnement de recette, un client hébergé à part — ne copiez ni le `.env` ni
les clés : lancez une installation neuve.

```bash
git clone https://github.com/jerems225/apk-builder.git
cd apk-builder
sudo SERVER_NAME=build-recette.exemple.tech ./deploy/install.sh
```

`install.sh` génère une clé maîtresse et des secrets propres à cette instance,
et `npm run seed` crée le premier compte. Deux instances qui partagent une clé
maîtresse partagent la capacité de déchiffrer les secrets l'une de l'autre :
c'est exactement ce qu'on ne veut pas entre une recette et une production.

Pour ne déplacer **qu'une partie** des données — un client qui prend son propre
serveur — utilisez plutôt le transfert entre espaces de travail décrit dans le
[README](../README.md#transférer-des-builds-ou-un-projet), puis exportez les
clés du projet concerné depuis l'interface.
