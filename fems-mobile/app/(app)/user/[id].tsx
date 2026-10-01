/**
 * Account detail.
 *
 * The person behind an FEMS account: their roles and the permissions those roles
 * carry, the company they belong to, their sign-in history, and the administrative
 * actions an administrator can take — suspend, reactivate, reset a password.
 * FEMS will not let an administrator suspend their own account.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '../../../src/api/client';
import type { DirectoryUser } from '../../../src/api/types';
import {
  useAuditLog,
  useDeactivateUser,
  useGrantUserRole,
  useResetUserPassword,
  useRestoreUser,
  useRevokeUserRole,
  useRoleList,
  useRoles,
  useSetUserStatus,
  useUpdateUser,
  useUser,
} from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { formatDateTime, formatRelative, humanize, userStatusLabel } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Avatar,
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  ErrorState,
  Notice,
  Overline,
  PageHeader,
  Row,
  Screen,
  Section,
  SelectSheet,
  SkeletonDetail,
  TextField,
  Tiny,
  useConfirm,
  useToast,
} from '../../../src/ui';

export default function AccountDetailScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: me, hasPermission } = useAuth();

  const account = useUser(id ?? null);
  const setStatus = useSetUserStatus();
  const resetPassword = useResetUserPassword();
  const audit = useAuditLog({ limit: 10, actorId: id });
  const roleList = useRoleList();
  const roleCatalogue = useRoles();
  const updateUser = useUpdateUser(id ?? '');
  const grantRole = useGrantUserRole(id ?? '');
  const revokeRole = useRevokeUserRole(id ?? '');
  const deactivate = useDeactivateUser(id ?? '');
  const restore = useRestoreUser(id ?? '');

  const [editOpen, setEditOpen] = useState(false);
  const [edited, setEdited] = useState<{ firstName: string; lastName: string; phone: string; jobTitle: string } | null>(null);
  const [roleToGrant, setRoleToGrant] = useState<string | null>(null);
  const [roleExpiry, setRoleExpiry] = useState('');

  if (account.isLoading) {
    return (
      <Screen>
        <PageHeader title="Account" onBack={() => router.back()} />
        <SkeletonDetail />
      </Screen>
    );
  }

  if (account.isError || !account.data) {
    return (
      <Screen>
        <PageHeader title="Account" onBack={() => router.back()} />
        <ErrorState error={account.error} onRetry={() => account.refetch()} title="This account could not be loaded" />
      </Screen>
    );
  }

  const data: DirectoryUser = account.data;
  const roles = data.roles ?? [];
  // The grants are carried by the role catalogue, not by the role attached to the
  // account row, so they are read from `/roles` and matched by name.
  const grantsByRole = new Map((roleList.data ?? []).map((entry) => [entry.name, entry.permissions ?? []]));
  const permissions = Array.from(new Set(roles.flatMap((role) => grantsByRole.get(role.name) ?? [])));
  const isSelf = me?.id === data.id;
  const canManage = hasPermission('users:update') || hasPermission('users:manage_status');
  const canEdit = hasPermission('users:update');
  const canManageRoles = hasPermission('users:manage_roles');
  const canDeactivate = hasPermission('users:deactivate');
  const isDeactivated = data.status === 'DEACTIVATED';
  const assignableRoles = (roleCatalogue.data ?? []).filter((entry) => !roles.some((role) => role.name === entry.name));

  const form = edited ?? {
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone ?? '',
    jobTitle: data.jobTitle ?? '',
  };
  const setForm = (patch: Partial<typeof form>) => setEdited({ ...form, ...patch });

  const saveDetails = async () => {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('Name is required', 'First and last name cannot be empty.');
      return;
    }
    try {
      await updateUser.mutateAsync({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim() || undefined,
        jobTitle: form.jobTitle.trim() || undefined,
      });
      toast.success('Account updated', 'The change is recorded in the audit trail.');
      setEditOpen(false);
      setEdited(null);
    } catch (error) {
      toast.error('Could not save', error instanceof ApiError ? error.message : undefined);
    }
  };

  const addRole = async () => {
    if (!roleToGrant) {
      toast.error('Choose a role', 'Pick the role to grant from the catalogue.');
      return;
    }
    if (roleExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(roleExpiry.trim())) {
      toast.error('Invalid expiry', 'Use the format YYYY-MM-DD, or leave it empty for a permanent assignment.');
      return;
    }
    try {
      await grantRole.mutateAsync({ role: roleToGrant, expiresAt: roleExpiry.trim() ? `${roleExpiry.trim()}T23:59:59.000Z` : undefined });
      toast.success('Role granted', `${humanize(roleToGrant)} added to ${data.firstName}'s account.`);
      setRoleToGrant(null);
      setRoleExpiry('');
    } catch (error) {
      toast.error('Could not grant the role', error instanceof ApiError ? error.message : undefined);
    }
  };

  const removeRole = async (roleName: string, label: string) => {
    if (roles.length <= 1) {
      toast.error('Last role', 'An account must keep at least one role. Grant the replacement first, then remove this one.');
      return;
    }
    const answer = await confirm({
      title: `Revoke ${label}?`,
      message: 'The account immediately loses every permission this role carries. The change is audited.',
      confirmLabel: 'Revoke role',
      destructive: true,
    });
    if (!answer.confirmed) return;
    try {
      await revokeRole.mutateAsync(roleName);
      toast.success('Role revoked', `${label} removed.`);
    } catch (error) {
      toast.error('Could not revoke', error instanceof ApiError ? error.message : undefined);
    }
  };

  const deactivateAccount = async () => {
    if (isSelf) {
      toast.error('Not allowed', 'An administrator cannot deactivate their own account.');
      return;
    }
    const answer = await confirm({
      title: `Deactivate ${data.firstName}?`,
      message:
        'The account is archived and every session is revoked. Nothing is erased — the history stays in the register and the account can be restored later.',
      confirmLabel: 'Deactivate',
      destructive: true,
    });
    if (!answer.confirmed) return;
    try {
      await deactivate.mutateAsync();
      toast.success('Account deactivated', `${data.firstName} ${data.lastName} can no longer sign in.`);
    } catch (error) {
      toast.error('Could not deactivate', error instanceof ApiError ? error.message : undefined);
    }
  };

  const restoreAccount = async () => {
    try {
      await restore.mutateAsync();
      toast.success('Account restored', 'It can sign in again with its existing roles.');
    } catch (error) {
      toast.error('Could not restore', error instanceof ApiError ? error.message : undefined);
    }
  };

  const changeStatus = async (next: 'ACTIVE' | 'SUSPENDED') => {
    if (isSelf) {
      toast.error('Not allowed', 'An administrator cannot change the status of their own account.');
      return;
    }
    const answer = await confirm({
      title: next === 'SUSPENDED' ? `Suspend ${data.firstName}?` : `Reactivate ${data.firstName}?`,
      message:
        next === 'SUSPENDED'
          ? 'The account keeps its history but can no longer sign in or use the API. The reason is recorded in the audit trail.'
          : 'The account can sign in again with its existing roles.',
      confirmLabel: next === 'SUSPENDED' ? 'Suspend' : 'Reactivate',
      destructive: next === 'SUSPENDED',
      requireReason: next === 'SUSPENDED',
      reasonLabel: 'Reason for the suspension',
      reasonMinLength: 10,
    });
    if (!answer.confirmed) return;
    try {
      await setStatus.mutateAsync({ id: data.id, status: next, reason: answer.reason });
      toast.success(next === 'SUSPENDED' ? 'Account suspended' : 'Account reactivated', `${data.firstName} ${data.lastName}`);
    } catch (error) {
      toast.error('Action failed', error instanceof ApiError ? error.message : undefined);
    }
  };

  const reset = async () => {
    const answer = await confirm({
      title: 'Reset the password?',
      message: 'FEMS generates a temporary password and signs every existing session of this account out. Share the new password over a trusted channel.',
      confirmLabel: 'Reset password',
      destructive: true,
    });
    if (!answer.confirmed) return;
    try {
      const result = await resetPassword.mutateAsync({ id: data.id });
      toast.success('Password reset', result.temporaryPassword ? `Temporary password: ${result.temporaryPassword}` : result.message);
    } catch (error) {
      toast.error('Could not reset', error instanceof ApiError ? error.message : undefined);
    }
  };

  return (
    <Screen refresh={account.isRefetching ? { refreshing: true, onRefresh: () => account.refetch() } : undefined}>
      <PageHeader
        title={`${data.firstName} ${data.lastName}`}
        subtitle={data.jobTitle ?? humanize(data.status)}
        onBack={() => router.back()}
      />

      {isSelf ? (
        <Notice tone="info" title="This is your own account">
          Change your own details from Settings. Administrative actions (suspend, reset password) are for other accounts.
        </Notice>
      ) : null}

      <Card>
        <Row gap={12} style={{ marginBottom: 10 }}>
          <Avatar first={data.firstName} last={data.lastName} size={52} tone={data.status === 'ACTIVE' ? 'success' : 'warning'} />
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '700' }}>{data.email}</Body>
            <Tiny tone="faint">{data.phone ?? 'no phone number'}</Tiny>
            <Row gap={6} wrap style={{ marginTop: 6 }}>
              <Badge label={userStatusLabel(data.status)} tone={data.status === 'ACTIVE' ? 'success' : data.status === 'SUSPENDED' ? 'danger' : 'warning'} compact />
              {data.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
              {data.emailVerifiedAt ? (
                <Badge label="email verified" tone="success" compact />
              ) : (
                <Badge label="email unverified" tone="warning" compact />
              )}
            </Row>
          </View>
        </Row>
        <Definition label="Job title" value={data.jobTitle ?? '—'} />
        <Definition label="Preferred language" value={data.preferredLanguage === 'fr' ? 'Français' : 'English'} />
        <Definition label="Company" value={data.company?.name ?? 'not linked to a company'} />
        <Definition label="Created" value={formatDateTime(data.createdAt, 'en')} />
        <Definition label="Last sign-in" value={data.lastLoginAt ? `${formatDateTime(data.lastLoginAt, 'en')} (${formatRelative(data.lastLoginAt, 'en')})` : 'never'} />
      </Card>

      {canEdit ? (
        <Section title="Details">
          <Card>
            {editOpen ? (
              <>
                <Row gap={8}>
                  <TextField label="First name" required value={form.firstName} onChangeText={(v) => setForm({ firstName: v })} style={{ flex: 1 }} />
                  <TextField label="Last name" required value={form.lastName} onChangeText={(v) => setForm({ lastName: v })} style={{ flex: 1 }} />
                </Row>
                <Row gap={8}>
                  <TextField label="Phone" value={form.phone} onChangeText={(v) => setForm({ phone: v })} keyboardType="phone-pad" placeholder="+2376…" style={{ flex: 1 }} />
                  <TextField label="Job title" value={form.jobTitle} onChangeText={(v) => setForm({ jobTitle: v })} placeholder="Chef de poste" style={{ flex: 1 }} />
                </Row>
                <Row gap={8} style={{ marginTop: 8 }}>
                  <Button label="Save changes" icon="save-outline" loading={updateUser.isPending} onPress={() => void saveDetails()} />
                  <Button
                    label="Cancel"
                    variant="secondary"
                    onPress={() => {
                      setEditOpen(false);
                      setEdited(null);
                    }}
                  />
                </Row>
                <Caption tone="faint" style={{ marginTop: 6 }}>
                  The email address is the sign-in identity and is changed from the account holder's own profile.
                </Caption>
              </>
            ) : (
              <Button label="Edit details" variant="secondary" icon="create-outline" onPress={() => setEditOpen(true)} />
            )}
          </Card>
        </Section>
      ) : null}

      <Section title="Roles">
        <Card>
          {roles.length === 0 ? (
            <Caption tone="muted">This account has no role assigned, so the API grants it nothing beyond its own profile.</Caption>
          ) : (
            roles.map((role) => (
              <View key={role.name} style={{ marginBottom: 10 }}>
                <Row justify="space-between">
                  <Body style={{ fontWeight: '600' }}>{role.label ?? humanize(role.name)}</Body>
                  <Row gap={6}>
                    <Badge label={`level ${role.level}`} tone="neutral" compact />
                    {canManageRoles && !isSelf ? (
                      <Button
                        label="Revoke"
                        variant="ghost"
                        size="sm"
                        icon="close-circle-outline"
                        loading={revokeRole.isPending}
                        onPress={() => void removeRole(role.name, role.label ?? humanize(role.name))}
                      />
                    ) : null}
                  </Row>
                </Row>
                <Tiny tone="faint">
                  {role.name}
                  {role.assignedAt ? ` · assigned ${formatDateTime(role.assignedAt, 'en')}` : ''}
                  {role.expiresAt ? ` · expires ${formatDateTime(role.expiresAt, 'en')}` : ''}
                </Tiny>
              </View>
            ))
          )}

          {canManageRoles ? (
            isSelf ? (
              <Caption tone="faint" style={{ marginTop: 6 }}>
                You cannot change the roles on your own account — ask another administrator.
              </Caption>
            ) : (
              <View style={{ marginTop: 12 }}>
                <Overline>Grant another role</Overline>
                <SelectSheet
                  label="Role"
                  value={roleToGrant ?? '__none__'}
                  options={[
                    { value: '__none__', label: 'Choose a role' },
                    ...assignableRoles.map((entry) => ({
                      value: entry.name,
                      label: `${entry.label} — ${entry.permissionCount ?? entry.permissions?.length ?? 0} permission(s)`,
                    })),
                  ]}
                  onChange={(value) => setRoleToGrant(value === '__none__' ? null : value)}
                />
                <TextField
                  label="Expires on (optional)"
                  value={roleExpiry}
                  onChangeText={setRoleExpiry}
                  placeholder="YYYY-MM-DD — leave empty for a permanent role"
                  autoCapitalize="none"
                />
                <Button
                  label="Grant role"
                  icon="shield-checkmark-outline"
                  loading={grantRole.isPending}
                  disabled={!roleToGrant}
                  onPress={() => void addRole()}
                />
                <Caption tone="faint" style={{ marginTop: 6 }}>
                  Granting the Administrator role requires full access yourself. An account must always keep at least one role.
                </Caption>
              </View>
            )
          ) : null}
        </Card>
      </Section>

      {permissions.length ? (
        <Section title={`Permissions (${permissions.length})`}>
          <Card>
            <Row gap={6} wrap>
              {permissions.map((permission) => (
                <Badge key={permission} label={permission} tone="neutral" compact />
              ))}
            </Row>
            <Caption tone="faint" style={{ marginTop: 8 }}>
              These are the grants the API enforces on every request for this account.
            </Caption>
          </Card>
        </Section>
      ) : null}

      {canManage ? (
        <Section title="Administration">
          <Row gap={8} wrap>
            {data.status === 'ACTIVE' ? (
              <Button label="Suspend account" variant="danger" icon="pause-circle-outline" loading={setStatus.isPending} disabled={isSelf} onPress={() => void changeStatus('SUSPENDED')} />
            ) : (
              <Button label="Reactivate account" icon="play-circle-outline" loading={setStatus.isPending} disabled={isSelf} onPress={() => void changeStatus('ACTIVE')} />
            )}
            <Button label="Reset password" variant="secondary" icon="key-outline" loading={resetPassword.isPending} onPress={() => void reset()} />
            {canDeactivate && !isDeactivated ? (
              <Button
                label="Deactivate account"
                variant="danger"
                icon="person-remove-outline"
                loading={deactivate.isPending}
                disabled={isSelf}
                onPress={() => void deactivateAccount()}
              />
            ) : null}
            {isDeactivated && canEdit ? (
              <Button label="Restore account" icon="person-add-outline" loading={restore.isPending} onPress={() => void restoreAccount()} />
            ) : null}
          </Row>
          {isDeactivated ? (
            <Caption tone="muted" style={{ marginTop: 6 }}>
              This account is deactivated: its sessions were revoked and it cannot sign in. Restoring it brings back its existing roles.
            </Caption>
          ) : null}
          {isSelf ? (
            <Caption tone="faint" style={{ marginTop: 6 }}>
              Suspending is disabled on your own account — ask another administrator.
            </Caption>
          ) : null}
        </Section>
      ) : null}

      <Section title="Recent activity">
        {audit.isLoading ? (
          <Tiny tone="faint">Reading the audit trail…</Tiny>
        ) : (audit.data?.items ?? []).length === 0 ? (
          <Card>
            <Caption tone="muted">No audited action recorded for this account yet.</Caption>
          </Card>
        ) : (
          <Card>
            {(audit.data?.items ?? []).map((entry) => (
              <Row key={entry.id} gap={10} style={{ marginBottom: 8 }}>
                <Ionicons
                  name={entry.severity === 'CRITICAL' ? 'alert-circle-outline' : entry.severity === 'WARNING' ? 'warning-outline' : 'information-circle-outline'}
                  size={16}
                  color={entry.severity === 'CRITICAL' ? theme.colors.danger : entry.severity === 'WARNING' ? theme.colors.warning : theme.colors.info}
                />
                <View style={{ flex: 1 }}>
                  <Tiny style={{ fontWeight: '600' }}>{humanize(entry.action)}</Tiny>
                  <Tiny tone="faint" lines={2}>
                    {entry.description} · {formatRelative(entry.createdAt, 'en')}
                  </Tiny>
                </View>
              </Row>
            ))}
          </Card>
        )}
      </Section>

      {hasPermission('audit:read') ? (
        <Button
          label="Open the full audit trail"
          variant="secondary"
          icon="list-outline"
          onPress={() => router.push({ pathname: '/audit', params: { actorId: data.id } })}
        />
      ) : null}
    </Screen>
  );
}
