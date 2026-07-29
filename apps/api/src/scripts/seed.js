'use strict';
/**
 * Amorçage. Idempotent : à relancer sans crainte.
 *
 * Crée, si la base est vide, un super-administrateur et un premier espace de
 * travail avec son secret de webhook. Le mot de passe vient de
 * BOOTSTRAP_PASSWORD ; à défaut il est tiré au sort et affiché une seule fois.
 *
 *   npm run seed --workspace=apps/api
 */
const prisma = require('../lib/prisma');
const passwords = require('../lib/password');
const secrets = require('../lib/crypto');
const config = require('../config');
const { slugify } = require('../routes/workspaces');
const { pickColor } = require('../routes/team');

async function main() {
  const email = config.bootstrapEmail.toLowerCase();

  let user = await prisma.user.findUnique({ where: { email } });
  let password = null;

  if (!user) {
    password = config.bootstrapPassword || passwords.suggest();
    const problem = config.bootstrapPassword ? passwords.check(password) : null;
    if (problem) {
      console.error(`BOOTSTRAP_PASSWORD refusé : ${problem}`);
      process.exit(1);
    }
    user = await prisma.user.create({
      data: {
        email,
        name: 'Administration',
        passwordHash: await passwords.hash(password),
        isSuperAdmin: true,
        // Forcé seulement si le mot de passe a été tiré au sort : un mot de
        // passe choisi par l'exploitant n'a pas à être changé au premier accès.
        mustChangePassword: !config.bootstrapPassword,
        avatarColor: pickColor(email),
      },
    });
    console.log(`compte super-administrateur créé : ${email}`);
  } else {
    console.log(`compte ${email} déjà présent — inchangé`);
  }

  let workspace = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
  let webhookSecret = null;

  if (!workspace) {
    webhookSecret = secrets.randomToken(24);
    workspace = await prisma.workspace.create({
      data: {
        name: config.bootstrapWorkspace,
        slug: slugify(config.bootstrapWorkspace),
        webhookSecretEnc: secrets.encrypt(webhookSecret),
        webhookSecretHint: secrets.hint(webhookSecret),
        memberships: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    console.log(`espace de travail créé : ${workspace.name} (${workspace.slug})`);
  } else {
    const member = await prisma.membership.findFirst({
      where: { userId: user.id, workspaceId: workspace.id },
    });
    if (!member) {
      await prisma.membership.create({
        data: { userId: user.id, workspaceId: workspace.id, role: 'OWNER' },
      });
      console.log(`compte rattaché à l'espace existant ${workspace.slug}`);
    } else {
      console.log(`espace ${workspace.slug} déjà présent — inchangé`);
    }
  }

  console.log('\n────────────────────────────────────────────────────────');
  console.log(`Interface       : ${config.webOrigin}`);
  console.log(`Documentation   : ${config.publicUrl}/api/docs`);
  console.log(`Identifiant     : ${email}`);
  if (password) console.log(`Mot de passe    : ${password}   ← noté une seule fois`);
  if (webhookSecret) {
    console.log(`URL de webhook  : ${config.publicUrl}/api/webhooks/${workspace.slug}`);
    console.log(`Secret webhook  : ${webhookSecret}   ← noté une seule fois`);
  }
  console.log('────────────────────────────────────────────────────────\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
