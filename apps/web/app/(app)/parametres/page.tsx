'use client';

import React from 'react';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import {
  Card, CardHeader, Badge, Button, Field, Input, Select, Modal, Alert, Skeleton,
} from '@/components/ui';
import { IconPlus, IconTrash, IconDoc } from '@/components/ui/icons';
import { post, patch, del } from '@/lib/api';
import { relative, fullDate } from '@/lib/format';
import type { Workspace, ApiTokenInfo, AuditEntry } from '@/lib/types';

export default function SettingsPage() {
  const { can } = useSession();
  const { data: ws, reload } = useResource<Workspace>('/api/workspaces/current');
  const [notice, setNotice] = React.useState<string | null>(null);
  const [revealed, setRevealed] = React.useState<string | null>(null);

  return (
    <>
      <PageHeader title="Paramètres"
        subtitle="Réglages de l’espace de travail : webhook, rétention, accès machine." />

      {notice && <div className="mb-4"><Alert tone="ok">{notice}</Alert></div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <WebhookCard ws={ws} onRotated={(secret) => { setRevealed(secret); reload(true); }} />
        <GeneralCard ws={ws} onSaved={(m) => { setNotice(m); reload(true); }} />
        <TokensCard />
        {can('MAINTAINER') && <AuditCard />}
      </div>

      <Modal open={!!revealed} onClose={() => setRevealed(null)}
        title="Nouveau secret de webhook"
        subtitle="Recopiez-le maintenant chez votre fournisseur Git."
        footer={<Button variant="primary" onClick={() => setRevealed(null)}>J’ai recopié</Button>}>
        <div className="space-y-3.5">
          <Alert tone="danger" title="Les webhooks existants sont cassés">
            Tous les webhooks déjà configurés utilisent l’ancien secret et seront désormais refusés.
            Mettez le nouveau partout avant le prochain push.
          </Alert>
          <div className="rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
            <p className="select-all break-all text-[14px] font-semibold"
              style={{ fontFamily: 'var(--font-mono)' }}>{revealed}</p>
          </div>
          <Button onClick={() => navigator.clipboard?.writeText(revealed || '')}>Copier</Button>
        </div>
      </Modal>
    </>
  );
}

// ─────────────────────────────── Webhook ─────────────────────────────────────

function WebhookCard({ ws, onRotated }: { ws: Workspace | null; onRotated: (s: string) => void }) {
  const { can } = useSession();
  if (!ws) return <Skeleton className="h-64" />;

  return (
    <Card>
      <CardHeader title="Webhook Git"
        subtitle="Une URL et un secret par espace : le webhook d’un client ne peut pas déclencher de build chez un autre." />
      <div className="space-y-4 border-t px-5 py-4" style={{ borderColor: 'var(--line)' }}>
        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--ink-2)' }}>
            URL de charge utile
          </p>
          <div className="flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-[12.5px]"
              style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
              {ws.webhookUrl}
            </code>
            <Button size="sm" onClick={() => navigator.clipboard?.writeText(ws.webhookUrl)}>Copier</Button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[12.5px] font-semibold" style={{ color: 'var(--ink-2)' }}>Secret</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg px-3 py-2 text-[12.5px] tnum"
              style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
              {ws.webhookSecretHint || 'aucun secret défini'}
            </code>
            {can('OWNER') && (
              <Button size="sm" onClick={async () => {
                if (!confirm('Régénérer le secret ?\n\nTous les webhooks déjà configurés cesseront de fonctionner tant que le nouveau secret n’y est pas recopié.')) return;
                const r = await post<Workspace>('/api/workspaces/current/webhook-secret');
                if (r.webhookSecret) onRotated(r.webhookSecret);
              }}>Régénérer</Button>
            )}
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            Le secret complet n’est lisible qu’au moment où il est créé. Ensuite, seule cette
            empreinte reste affichée — comme pour un jeton Git.
          </p>
        </div>

        <details className="rounded-lg px-3.5 py-3 text-[12.5px] leading-relaxed"
          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
          <summary className="cursor-pointer font-semibold" style={{ color: 'var(--ink)' }}>
            Réglage côté GitHub
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Dépôt → <em>Settings</em> → <em>Webhooks</em> → <em>Add webhook</em></li>
            <li><em>Payload URL</em> : l’adresse ci-dessus</li>
            <li><em>Content type</em> : <code>application/json</code></li>
            <li><em>Secret</em> : le secret de cet espace, sans espace avant ni après</li>
            <li>Évènements : <em>Just the push event</em></li>
          </ol>
          <p className="mt-2">
            Un appel refusé renvoie la raison exacte du rejet ; elle s’affiche dans l’onglet
            <em> Recent Deliveries</em> de GitHub, sans avoir à ouvrir le serveur.
          </p>
        </details>
      </div>
    </Card>
  );
}

// ────────────────────────────── Général ──────────────────────────────────────

function GeneralCard({ ws, onSaved }: { ws: Workspace | null; onSaved: (m: string) => void }) {
  const { can } = useSession();
  const [name, setName] = React.useState('');
  const [retention, setRetention] = React.useState('30');
  const [concurrent, setConcurrent] = React.useState('2');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!ws) return;
    setName(ws.name);
    setRetention(String(ws.retentionDays));
    setConcurrent(String(ws.maxConcurrent));
  }, [ws]);

  if (!ws) return <Skeleton className="h-64" />;
  const readOnly = !can('OWNER');

  return (
    <Card>
      <CardHeader title="Espace de travail"
        subtitle={`Identifiant : ${ws.slug} — il apparaît dans l’URL du webhook et ne change pas.`} />
      <div className="space-y-3.5 border-t px-5 py-4" style={{ borderColor: 'var(--line)' }}>
        <Field label="Nom">
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={readOnly} />
        </Field>

        <Field label="Rétention des APK (jours)"
          hint="Au-delà, l’APK est supprimé du disque et son lien de téléchargement cesse de fonctionner. 0 = conservation illimitée.">
          <Input type="number" min={0} max={3650} value={retention} disabled={readOnly}
            onChange={(e) => setRetention(e.target.value)} />
        </Field>

        <Field label="Builds simultanés dans cet espace"
          hint="Plafond propre à l’espace, dans la limite de celui de la machine. Empêche une rafale de pushs de bloquer les autres clients.">
          <Select value={concurrent} onChange={(e) => setConcurrent(e.target.value)} disabled={readOnly}>
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>

        {!readOnly && (
          <Button variant="primary" loading={busy} onClick={async () => {
            setBusy(true);
            try {
              await patch('/api/workspaces/current', {
                name,
                retentionDays: Number(retention),
                maxConcurrent: Number(concurrent),
              });
              onSaved('Paramètres enregistrés.');
            } finally { setBusy(false); }
          }}>Enregistrer</Button>
        )}
      </div>
    </Card>
  );
}

// ──────────────────────────── Jetons machine ─────────────────────────────────

function TokensCard() {
  const { data, reload } = useResource<ApiTokenInfo[]>('/api/tokens');
  const [creating, setCreating] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [created, setCreated] = React.useState<ApiTokenInfo | null>(null);

  return (
    <Card>
      <CardHeader title="Jetons API"
        subtitle="Pour déclencher un build depuis une CI, sans compte utilisateur."
        action={
          <Button size="sm" icon={<IconPlus size={15} />} onClick={() => setCreating(true)}>
            Créer
          </Button>
        } />

      <div className="border-t" style={{ borderColor: 'var(--line)' }}>
        {!data ? <Skeleton className="m-4 h-16" />
          : data.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px]" style={{ color: 'var(--ink-3)' }}>
              Aucun jeton. L’interface suffit tant qu’aucune CI externe ne déclenche de build.
            </p>
          ) : (
            <ul>
              {data.map((t) => (
                <li key={t.id} className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0"
                  style={{ borderColor: 'var(--line)' }}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[13.5px] font-medium">
                      {t.label}
                      {t.revokedAt && <Badge tone="idle">révoqué</Badge>}
                      {!t.revokedAt && t.expiresAt && new Date(t.expiresAt) < new Date() &&
                        <Badge tone="warn">expiré</Badge>}
                    </p>
                    <p className="truncate text-[12px]" style={{ color: 'var(--ink-3)' }}>
                      <code className="tnum">{t.tokenHint}</code>
                      {' · '}{t.lastUsedAt ? `utilisé ${relative(t.lastUsedAt)}` : 'jamais utilisé'}
                      {t.createdBy && ` · créé par ${t.createdBy}`}
                    </p>
                  </div>
                  {!t.revokedAt && (
                    <button title="Révoquer"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-[var(--surface-sunken)]"
                      style={{ color: 'var(--danger-ink)' }}
                      onClick={async () => {
                        if (!confirm(`Révoquer le jeton « ${t.label} » ?\n\nToute CI qui l’utilise cessera de fonctionner immédiatement.`)) return;
                        await del(`/api/tokens/${t.id}`);
                        reload(true);
                      }}>
                      <IconTrash size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Créer un jeton API"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Annuler</Button>
            <Button variant="primary" onClick={async () => {
              const t = await post<ApiTokenInfo>('/api/tokens', { label });
              setCreating(false);
              setLabel('');
              setCreated(t);
              reload(true);
            }}>Créer</Button>
          </>
        }>
        <Field label="Libellé" required hint="Ce qui permettra de savoir quoi révoquer, dans six mois.">
          <Input value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="GitHub Actions — app-livreur" />
        </Field>
      </Modal>

      <Modal open={!!created} onClose={() => setCreated(null)} title="Jeton créé"
        subtitle="Copiez-le maintenant : il ne sera plus jamais affiché."
        footer={<Button variant="primary" onClick={() => setCreated(null)}>J’ai copié</Button>}>
        {created && (
          <div className="space-y-3.5">
            <Alert tone="warn" title="Affiché une seule fois">
              La base n’en garde qu’une empreinte : ce jeton ne peut pas être retrouvé.
            </Alert>
            <div className="rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
              <p className="select-all break-all text-[13px]" style={{ fontFamily: 'var(--font-mono)' }}>
                {created.token}
              </p>
            </div>
            <div className="rounded-lg px-3.5 py-3 text-[12px] leading-relaxed"
              style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
              <p className="mb-1.5 font-semibold" style={{ color: 'var(--ink)' }}>Usage</p>
              <pre className="overflow-x-auto whitespace-pre-wrap"
                style={{ fontFamily: 'var(--font-mono)' }}>{`curl -X POST https://…/api/ci/builds \\
  -H "Authorization: Bearer ${created.token}" \\
  -H "Content-Type: application/json" \\
  -d '{"projectId":"…","ref":"main"}'`}</pre>
            </div>
            <Button onClick={() => navigator.clipboard?.writeText(created.token || '')}>Copier</Button>
          </div>
        )}
      </Modal>
    </Card>
  );
}

// ─────────────────────────── Journal d'audit ─────────────────────────────────

const ACTIONS: Record<string, string> = {
  'auth.login': 'Connexion',
  'auth.logout': 'Déconnexion',
  'auth.password.change': 'Changement de mot de passe',
  'docs.login': 'Accès à la documentation',
  'build.create': 'Build lancé',
  'build.rerun': 'Build relancé',
  'build.cancel': 'Build interrompu',
  'build.delete': 'Build supprimé',
  'build.purge_failed': 'Purge des échecs',
  'project.create': 'Projet ajouté',
  'project.update': 'Projet modifié',
  'project.delete': 'Projet supprimé',
  'project.keystore.upload': 'Clé de signature déposée',
  'project.keystore.delete': 'Clé de signature retirée',
  'provider.create': 'Connexion Git ajoutée',
  'provider.update': 'Connexion Git modifiée',
  'provider.delete': 'Connexion Git supprimée',
  'team.add': 'Membre ajouté',
  'team.role': 'Rôle modifié',
  'team.remove': 'Membre retiré',
  'token.create': 'Jeton API créé',
  'token.revoke': 'Jeton API révoqué',
  'workspace.update': 'Espace modifié',
  'workspace.webhook_secret.rotate': 'Secret de webhook régénéré',
};

function AuditCard() {
  const { data } = useResource<AuditEntry[]>('/api/workspaces/current/audit?limit=40');

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Journal d’activité"
        subtitle="Qui a fait quoi. Indispensable dès que plusieurs personnes partagent l’espace — sans lui, une clé remplacée est intraçable." />
      <div className="max-h-[420px] overflow-y-auto border-t" style={{ borderColor: 'var(--line)' }}>
        {!data ? <Skeleton className="m-4 h-16" />
          : data.length === 0 ? (
            <p className="px-5 py-6 text-center text-[13px]" style={{ color: 'var(--ink-3)' }}>
              Rien à afficher pour l’instant.
            </p>
          ) : (
            <ul>
              {data.map((e) => (
                <li key={e.id} className="flex gap-3 border-b px-5 py-2.5 last:border-b-0"
                  style={{ borderColor: 'var(--line)' }}>
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: e.action.includes('delete') || e.action.includes('revoke')
                      ? 'var(--danger)' : 'var(--accent)' }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px]">
                      <span className="font-medium">{ACTIONS[e.action] || e.action}</span>
                      {e.detail && typeof e.detail === 'object' && 'repoName' in e.detail && (
                        <span style={{ color: 'var(--ink-2)' }}> — {String(e.detail.repoName)}</span>
                      )}
                      {e.detail && typeof e.detail === 'object' && 'label' in e.detail && (
                        <span style={{ color: 'var(--ink-2)' }}> — {String(e.detail.label)}</span>
                      )}
                    </p>
                    <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
                      {e.user ? e.user.name : 'système'} · {fullDate(e.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </div>
      <div className="border-t px-5 py-3" style={{ borderColor: 'var(--line)', background: 'var(--surface-sunken)' }}>
        <a href="/api/docs" target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
          <IconDoc size={15} />
          Documentation de l’API
        </a>
      </div>
    </Card>
  );
}
