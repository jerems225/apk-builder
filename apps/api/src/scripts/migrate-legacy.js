'use strict';
/**
 * Reprise des données de la version 1 (tables `builds`, `projects`,
 * `providers` écrites par better-sqlite3) vers le schéma Prisma multi-espaces.
 *
 *   npm run migrate:legacy --workspace=apps/api -- [--espace <slug>] [--archiver]
 *
 * Pourquoi ce script lit la même base : les nouvelles tables Prisma
 * (`Build`, `Project`, `Provider`) ne portent pas les mêmes noms que les
 * anciennes (`builds`, `projects`, `providers`). Elles cohabitent donc sans
 * conflit, et la reprise se fait sans copier de fichier ni arrêter le service
 * plus longtemps qu'un redémarrage.
 *
 * Les tokens Git chiffrés sont repris tels quels : le format et la clé maîtresse
 * n'ont pas changé, il n'y a rien à ressaisir.
 *
 * Idempotent : une seconde exécution ne recrée pas ce qui existe déjà.
 */
const prisma = require('../lib/prisma');
const config = require('../config');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] || true;
};
const wantedSlug = flag('--espace');
const archive = args.includes('--archiver');

async function tableExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?", name);
  return rows.length > 0;
}

const readAll = (table) => prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
const dateOf = (v) => (v ? new Date(v) : null);

async function main() {
  const legacyPresent = await tableExists('builds');
  if (!legacyPresent) {
    console.log('Aucune table `builds` héritée dans cette base — rien à reprendre.');
    return;
  }

  const workspace = wantedSlug
    ? await prisma.workspace.findUnique({ where: { slug: wantedSlug } })
    : await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });

  if (!workspace) {
    console.error('Aucun espace de travail. Lancez d’abord : npm run seed --workspace=apps/api');
    process.exit(1);
  }
  console.log(`Reprise vers l’espace « ${workspace.name} » (${workspace.slug})\n`);

  // ── Connexions Git ─────────────────────────────────────────────────────────
  const providerMap = new Map(); // ancien id -> nouvel id
  if (await tableExists('providers')) {
    for (const p of await readAll('providers')) {
      const existing = await prisma.provider.findFirst({
        where: { workspaceId: workspace.id, label: p.label },
      });
      if (existing) {
        providerMap.set(p.id, existing.id);
        continue;
      }
      const created = await prisma.provider.create({
        data: {
          workspaceId: workspace.id,
          label: p.label,
          kind: p.kind || 'github',
          host: p.host || 'github.com',
          // Repris tel quel : même format, même clé maîtresse.
          tokenEnc: p.token_enc || null,
          tokenHint: p.token_hint || null,
          createdAt: dateOf(p.created_at) || new Date(),
        },
      });
      providerMap.set(p.id, created.id);
    }
    console.log(`connexions Git : ${providerMap.size}`);
  }

  // ── Projets ────────────────────────────────────────────────────────────────
  const projectByRepo = new Map();
  if (await tableExists('projects')) {
    for (const p of await readAll('projects')) {
      let project = await prisma.project.findFirst({
        where: { workspaceId: workspace.id, repoName: p.repo_name },
      });
      if (!project) {
        project = await prisma.project.create({
          data: {
            workspaceId: workspace.id,
            // La v1 n'avait pas de libellé : le nom du dépôt en tient lieu, à
            // charge pour l'équipe de le renommer dans l'interface.
            name: p.repo_name,
            repoName: p.repo_name,
            repoUrl: p.repo_url,
            providerId: p.provider_id ? providerMap.get(p.provider_id) || null : null,
            appSubdir: p.app_subdir || '.',
            gradleTask: p.gradle_task || 'assembleDebug',
            branches: p.branches || 'main',
            abis: config.abis,
            enabled: p.enabled !== 0,
            createdAt: dateOf(p.created_at) || new Date(),
          },
        });
      }
      projectByRepo.set(p.repo_name, project.id);
    }
    console.log(`projets        : ${projectByRepo.size}`);
  }

  // ── Builds ─────────────────────────────────────────────────────────────────
  // Les identifiants sont conservés : les liens /dl/<id>/... déjà distribués
  // continuent de fonctionner, et les répertoires d'artefacts n'ont pas à être
  // déplacés.
  let imported = 0;
  let skipped = 0;
  for (const b of await readAll('builds')) {
    if (await prisma.build.findUnique({ where: { id: b.id } })) { skipped++; continue; }
    await prisma.build.create({
      data: {
        id: b.id,
        workspaceId: workspace.id,
        projectId: projectByRepo.get(b.repo_name) || null,
        repoUrl: b.repo_url,
        repoName: b.repo_name,
        ref: b.ref,
        refType: b.ref_type || 'branch',
        commitSha: b.commit_sha || null,
        triggeredBy: b.triggered_by || null,
        source: b.source || 'webhook',
        appSubdir: b.app_subdir || '.',
        gradleTask: b.gradle_task || 'assembleDebug',
        abis: config.abis,
        // Les builds de la v1 sont tous signés avec la clé de debug : on ne
        // renseigne pas signedWith, une empreinte inventée serait pire que rien.
        status: b.status,
        apkName: b.apk_name || null,
        apkSize: b.apk_size || null,
        appVersion: b.app_version || null,
        exitCode: b.exit_code === null ? null : Number(b.exit_code),
        error: b.error || null,
        createdAt: dateOf(b.created_at) || new Date(),
        startedAt: dateOf(b.started_at),
        finishedAt: dateOf(b.finished_at),
      },
    });
    imported++;
  }
  console.log(`builds         : ${imported} repris, ${skipped} déjà présents`);

  if (archive) {
    // Renommage plutôt que suppression : si quelque chose manque à la
    // relecture, les données d'origine sont encore là.
    for (const t of ['builds', 'projects', 'providers']) {
      if (await tableExists(t) && !(await tableExists(`legacy_${t}`))) {
        await prisma.$executeRawUnsafe(`ALTER TABLE "${t}" RENAME TO "legacy_${t}"`);
        console.log(`table ${t} archivée en legacy_${t}`);
      }
    }
  } else {
    console.log('\nLes tables d’origine sont intactes. Une fois la reprise vérifiée dans');
    console.log('l’interface, relancez avec --archiver pour les renommer en legacy_*.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
