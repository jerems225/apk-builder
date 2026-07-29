'use client';

import React from 'react';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import {
  Card, CardHeader, Badge, Button, Field, Input, Select, Modal, Alert, Skeleton,
} from '@/components/ui';
import { IconTeam, IconPlus, IconTrash } from '@/components/ui/icons';
import { post, patch, del } from '@/lib/api';
import { initials, relative } from '@/lib/format';
import type { Member, RoleInfo, Role } from '@/lib/types';

export default function TeamPage() {
  const { user } = useSession();
  const { data: members, loading, reload } = useResource<Member[]>('/api/team');
  const { data: roles } = useResource<RoleInfo[]>('/api/team/roles');
  const [inviting, setInviting] = React.useState(false);
  const [created, setCreated] = React.useState<Member | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Équipe"
        subtitle="Qui accède à cet espace, et jusqu’où. Un rôle plus large que le sien ne peut pas être attribué."
        actions={
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setInviting(true)}>
            Ajouter quelqu’un
          </Button>
        }
      />

      {notice && <div className="mb-4"><Alert tone="ok">{notice}</Alert></div>}
      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title="Membres"
            subtitle={members ? `${members.length} personne${members.length > 1 ? 's' : ''}` : undefined} />
          {loading && !members ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : (
            <ul className="border-t" style={{ borderColor: 'var(--line)' }}>
              {members?.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 border-b px-5 py-3.5 last:border-b-0"
                  style={{ borderColor: 'var(--line)' }}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white"
                    style={{ background: m.avatarColor }}>
                    {initials(m.name)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                      {m.name}
                      {m.userId === user?.id && <Badge tone="run">vous</Badge>}
                      {m.isSuperAdmin && <Badge tone="warn">super-administrateur</Badge>}
                    </p>
                    <p className="truncate text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                      {m.email} · {m.lastLoginAt ? `vu ${relative(m.lastLoginAt)}` : 'jamais connecté'}
                    </p>
                  </div>

                  <Select
                    className="w-auto min-w-[150px]"
                    value={m.role}
                    onChange={async (e) => {
                      setError(null);
                      try {
                        await patch(`/api/team/${m.id}`, { role: e.target.value as Role });
                        setNotice(`Rôle de ${m.name} mis à jour.`);
                        reload(true);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Modification impossible');
                        reload(true);
                      }
                    }}>
                    {roles?.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </Select>

                  <button title="Retirer de l’espace"
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-[var(--surface-sunken)]"
                    style={{ color: 'var(--danger-ink)' }}
                    onClick={async () => {
                      if (!confirm(`Retirer ${m.name} de cet espace ?\n\nLe compte n’est pas supprimé : il perd seulement l’accès à cet espace.`)) return;
                      setError(null);
                      try {
                        await del(`/api/team/${m.id}`);
                        setNotice(`${m.name} a été retiré de l’espace.`);
                        reload(true);
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Suppression impossible');
                      }
                    }}>
                    <IconTrash size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Ce que permet chaque rôle"
            subtitle="Chaque rôle inclut tout ce que permet le précédent." />
          <ul className="border-t" style={{ borderColor: 'var(--line)' }}>
            {roles?.map((r) => (
              <li key={r.key} className="border-b px-5 py-3.5 last:border-b-0"
                style={{ borderColor: 'var(--line)' }}>
                <p className="text-[13.5px] font-semibold">{r.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                  {r.description}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <InviteModal open={inviting} roles={roles || []} onClose={() => setInviting(false)}
        onCreated={(m) => { setInviting(false); reload(true); if (m.temporaryPassword) setCreated(m); }} />

      {/* Le mot de passe provisoire n'est lisible qu'ici : la base n'en garde
          qu'une empreinte, il est impossible de le réafficher plus tard. */}
      <Modal open={!!created} onClose={() => setCreated(null)}
        title="Compte créé" subtitle="Transmettez ces identifiants par votre canal habituel."
        footer={<Button variant="primary" onClick={() => setCreated(null)}>J’ai noté</Button>}>
        {created && (
          <div className="space-y-3.5">
            <Alert tone="warn" title="Affiché une seule fois">
              Ce mot de passe n’est pas conservé en clair : il ne pourra pas être réaffiché. La
              personne devra le changer à sa première connexion.
            </Alert>
            <div className="rounded-lg px-4 py-3" style={{ background: 'var(--surface-sunken)' }}>
              <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>Identifiant</p>
              <p className="text-[14px] font-semibold">{created.email}</p>
              <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>Mot de passe provisoire</p>
              <p className="select-all text-[16px] font-semibold tracking-wide"
                style={{ fontFamily: 'var(--font-mono)' }}>{created.temporaryPassword}</p>
            </div>
            <Button onClick={() => navigator.clipboard?.writeText(
              `Identifiant : ${created.email}\nMot de passe : ${created.temporaryPassword}`)}>
              Copier les deux
            </Button>
          </div>
        )}
      </Modal>
    </>
  );
}

function InviteModal({
  open, roles, onClose, onCreated,
}: { open: boolean; roles: RoleInfo[]; onClose: () => void; onCreated: (m: Member) => void }) {
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<Role>('DEVELOPER');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setEmail(''); setName(''); setRole('DEVELOPER'); setError(null); }
  }, [open]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await post<Member>('/api/team', { email, name: name || undefined, role }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ajout impossible');
    } finally {
      setBusy(false);
    }
  }

  const selected = roles.find((r) => r.key === role);

  return (
    <Modal open={open} onClose={onClose} title="Ajouter quelqu’un à l’espace"
      subtitle="Si l’adresse a déjà un compte, elle est simplement rattachée à cet espace."
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => submit()}>Ajouter</Button>
        </>
      }>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Adresse électronique" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            placeholder="prenom.nom@exemple.ci" />
        </Field>
        <Field label="Nom affiché" hint="À défaut, la partie de l’adresse avant l’arobase.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Awa Koné" />
        </Field>
        <Field label="Rôle" hint={selected?.description}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Select>
        </Field>

        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Aucun courriel n’est envoyé : le service n’a pas de relais SMTP, et en ajouter un pour
          cet usage serait disproportionné. Un mot de passe provisoire s’affichera ici, à
          transmettre par votre canal habituel.
        </p>
      </form>
    </Modal>
  );
}
