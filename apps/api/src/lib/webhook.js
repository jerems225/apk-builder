'use strict';
const crypto = require('crypto');
const { safeEqual } = require('./crypto');

const hmacHex = (secret, raw) => crypto.createHmac('sha256', secret).update(raw).digest('hex');

/**
 * Vérifie l'authenticité de l'appel, quel que soit le fournisseur Git.
 * Le secret est désormais celui de l'espace de travail visé par l'URL, et non
 * un secret global : le webhook d'un client ne peut pas déclencher un build
 * chez un autre.
 *
 * Retourne { ok, provider, reason }.
 */
function verify(req, secret) {
  if (!secret) return { ok: false, reason: 'aucun secret de webhook défini pour cet espace' };

  const raw = req.rawBody || Buffer.alloc(0);
  const h = req.headers;

  // GitHub / Gitea / Forgejo : HMAC-SHA256 du corps brut
  const sig256 = h['x-hub-signature-256'] || h['x-gitea-signature'] || h['x-forgejo-signature'];
  if (sig256) {
    const expected = hmacHex(secret, raw);
    const received = String(sig256).replace(/^sha256=/, '');
    return safeEqual(expected, received)
      ? { ok: true, provider: h['x-gitea-signature'] ? 'gitea' : 'github' }
      : { ok: false, reason: 'signature HMAC invalide' };
  }

  // GitLab : jeton partagé en clair dans l'en-tête
  if (h['x-gitlab-token']) {
    return safeEqual(secret, h['x-gitlab-token'])
      ? { ok: true, provider: 'gitlab' }
      : { ok: false, reason: 'X-Gitlab-Token invalide' };
  }

  // Déclencheur générique (curl, CI tierce)
  if (h['x-build-token']) {
    return safeEqual(secret, h['x-build-token'])
      ? { ok: true, provider: 'generic' }
      : { ok: false, reason: 'X-Build-Token invalide' };
  }

  return { ok: false, reason: 'aucun en-tête d’authentification reconnu' };
}

/**
 * Normalise les charges utiles hétérogènes en un descriptif unique.
 * Retourne null si l'évènement ne doit pas déclencher de build.
 */
function parse(body, headers) {
  const event = headers['x-github-event'] || headers['x-gitea-event'] || headers['x-forgejo-event'];

  // --- GitHub / Gitea / Forgejo ---
  if (body.repository && typeof body.ref === 'string') {
    if (event && !['push', 'create'].includes(event)) return null;
    const m = body.ref.match(/^refs\/(heads|tags)\/(.+)$/);
    if (!m) return null;
    if (body.deleted) return null; // suppression de branche/tag
    return {
      repoUrl: body.repository.clone_url || body.repository.html_url,
      repoName: body.repository.full_name,
      ref: m[2],
      refType: m[1] === 'tags' ? 'tag' : 'branch',
      commitSha: (body.after || (body.head_commit && body.head_commit.id) || '').slice(0, 12) || null,
      triggeredBy: (body.pusher && body.pusher.name) || (body.sender && body.sender.login) || 'webhook',
    };
  }

  // --- GitLab ---
  if (body.object_kind === 'push' || body.object_kind === 'tag_push') {
    const m = String(body.ref || '').match(/^refs\/(heads|tags)\/(.+)$/);
    if (!m) return null;
    if (/^0+$/.test(body.after || '')) return null; // suppression
    return {
      repoUrl: (body.project && body.project.git_http_url) ||
        (body.repository && body.repository.git_http_url),
      repoName: (body.project && body.project.path_with_namespace) ||
        (body.repository && body.repository.name),
      ref: m[2],
      refType: body.object_kind === 'tag_push' ? 'tag' : 'branch',
      commitSha: (body.checkout_sha || body.after || '').slice(0, 12) || null,
      triggeredBy: body.user_username || body.user_name || 'webhook',
    };
  }

  // --- Générique : { repo_url, ref } ---
  if (body.repo_url && body.ref) {
    return {
      repoUrl: body.repo_url,
      repoName: body.repo_name ||
        body.repo_url.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, ''),
      ref: body.ref,
      refType: body.ref_type === 'tag' ? 'tag' : 'branch',
      commitSha: body.commit_sha || null,
      triggeredBy: body.triggered_by || 'api',
    };
  }

  return null;
}

/**
 * Applique la politique de build du projet. Retourne null si acceptable, sinon
 * la raison du rejet — reprise dans la réponse HTTP pour que le développeur
 * comprenne sans ouvrir le serveur pourquoi son push n'a rien déclenché.
 */
function shouldBuild(job, project) {
  if (!job.repoUrl) return 'URL de clone absente de la charge utile';
  if (!project) return `dépôt '${job.repoName}' non enregistré dans cet espace`;
  if (!project.enabled) return `projet '${job.repoName}' désactivé`;

  if (job.refType === 'tag') {
    return project.buildTags ? null : 'les tags ne déclenchent pas de build pour ce projet';
  }

  const branches = String(project.branches || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!branches.includes(job.ref)) {
    return `branche '${job.ref}' non surveillée pour ce dépôt (${branches.join(', ') || 'aucune'})`;
  }
  return null;
}

module.exports = { verify, parse, shouldBuild };
