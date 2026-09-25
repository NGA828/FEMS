/**
 * User directory.
 *
 * Every account in FEMS with its role, its status and the company it belongs to.
 * Administrators create accounts here; the role picker is fed by the RBAC
 * catalogue from `GET /roles/catalogue`, so a role that the API does not know
 * cannot be assigned from the app.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ApiError } from '../../../src/api/client';
import type { DirectoryUser, RoleName, UserStatus } from '../../../src/api/types';
import { useCompanies, useCreateUser, useRoles, useUsers } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { formatRelative, humanize, userStatusLabel } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Avatar,
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Overline,
  PageHeader,
  Row,
  Screen,
  SearchBar,
  Section,
  SelectSheet,
  SkeletonList,
  StatTile,
  TextField,
  Tiny,
  useToast,
} from '../../../src/ui';

const STATUSES: UserStatus[] = ['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'DEACTIVATED'];

export default function UserDirectoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { hasPermission } = useAuth();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<UserStatus | 'ALL'>('ALL');
  const [roleFilter, setRoleFilter] = useState<RoleName | 'ALL'>('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState<RoleName | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  const roles = useRoles();
  const companies = useCompanies({ limit: 100 });
  const query = useMemo(
    () => ({ limit: 50, status: status === 'ALL' ? undefined : status, role: roleFilter === 'ALL' ? undefined : roleFilter }),
    [status, roleFilter],
  );
  const users = useUsers(query);
  const create = useCreateUser();

  const items = users.data?.items ?? [];
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((user: DirectoryUser) =>
      [user.firstName, user.lastName, user.email, user.jobTitle]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [items, search]);

  const canCreate = hasPermission('users:create');
  const needsCompany = role === 'COMPANY_REPRESENTATIVE' || role === 'FIELD_OPERATOR';

  const submit = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('Name is required', 'First and last name, as they appear on the staff file.');
      return;
    }
    if (!email.includes('@')) {
      toast.error('Email is required', 'The account is identified by its email address.');
      return;
    }
    if (!role) {
      toast.error('Choose a role', 'The role decides what the account can do; it is enforced by the API.');
      return;
    }
    if (needsCompany && !companyId) {
      toast.error('Company is required', `${humanize(role)} accounts must be linked to the company they represent.`);
      return;
    }
    if (password && password.length < 8) {
      toast.error('Password too short', 'Use at least 8 characters, or leave it empty to let FEMS generate one.');
      return;
    }
    try {
      const created = await create.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || undefined,
        jobTitle: jobTitle.trim() || undefined,
        role,
        companyId: companyId ?? undefined,
        password: password || undefined,
      });
      toast.success('Account created', `${created.firstName} ${created.lastName} — the invitation email carries the sign-in details.`);
      setFormOpen(false);
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setJobTitle('');
      setPassword('');
      setRole(null);
      setCompanyId(null);
    } catch (error) {
      toast.error('Could not create the account', error instanceof ApiError ? error.message : undefined);
    }
  };

  return (
    <Screen refresh={users.isRefetching ? { refreshing: true, onRefresh: () => users.refetch() } : undefined}>
      <PageHeader
        title="Accounts"
        subtitle="People with access to FEMS"
        onBack={() => router.back()}
        right={canCreate ? <Button label={formOpen ? 'Close' : 'Invite'} icon={formOpen ? 'close-outline' : 'person-add-outline'} size="sm" onPress={() => setFormOpen(!formOpen)} /> : undefined}
      />

      <Row gap={8} wrap style={{ marginBottom: 12 }}>
        <StatTile label="Accounts" value={users.data?.meta?.total ?? items.length} icon="people-outline" />
        <StatTile label="Active" value={items.filter((user: DirectoryUser) => user.status === 'ACTIVE').length} icon="checkmark-circle-outline" tone="success" />
        <StatTile label="Suspended" value={items.filter((user: DirectoryUser) => user.status === 'SUSPENDED').length} icon="pause-circle-outline" tone="danger" />
        <StatTile label="Roles" value={roles.data?.length ?? 0} icon="shield-outline" />
      </Row>

      {formOpen && canCreate ? (
        <Section title="New account">
          <Row gap={8}>
            <TextField label="First name" required value={firstName} onChangeText={setFirstName} style={{ flex: 1 }} />
            <TextField label="Last name" required value={lastName} onChangeText={setLastName} style={{ flex: 1 }} />
          </Row>
          <TextField label="Email" required value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="name@fems.cm" />
          <Row gap={8}>
            <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+2376…" style={{ flex: 1 }} />
            <TextField label="Job title" value={jobTitle} onChangeText={setJobTitle} placeholder="Chef de poste" style={{ flex: 1 }} />
          </Row>
          <SelectSheet
            label="Role"
            value={role}
            required
            options={(roles.data ?? []).map((entry) => ({ value: entry.name as RoleName, label: `${entry.label} — ${entry.permissionCount ?? entry.permissions?.length ?? 0} permission(s)` }))}
            onChange={setRole}
          />
          {needsCompany ? (
            <SelectSheet
              label="Company"
              value={companyId}
              required
              options={[
                { value: '__none__', label: 'Choose a company' },
                ...(companies.data?.items ?? []).map((company) => ({ value: company.id, label: company.name })),
              ]}
              onChange={(value) => setCompanyId(value === '__none__' ? null : value)}
            />
          ) : null}
          <TextField
            label="Temporary password (optional)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Leave empty and FEMS generates one"
            help="At least 8 characters. The account is asked to change it at first sign-in."
          />
          <Button label={create.isPending ? 'Creating…' : 'Create account'} icon="person-add-outline" loading={create.isPending} onPress={() => void submit()} />
          <Caption tone="faint" style={{ marginTop: 6 }}>
            Permissions come from the role and are enforced by the API on every request — hiding a button in the app is never the control.
          </Caption>
        </Section>
      ) : null}

      <SearchBar value={search} onChangeText={setSearch} placeholder="Name, email or job title…" />

      <View style={{ marginVertical: 10, gap: 8 }}>
        <Row gap={6} wrap>
          <Chip label="All statuses" selected={status === 'ALL'} onPress={() => setStatus('ALL')} />
          {STATUSES.map((value) => (
            <Chip key={value} label={userStatusLabel(value)} selected={status === value} onPress={() => setStatus(value)} />
          ))}
        </Row>
        <Row gap={6} wrap>
          <Tiny tone="faint">Role</Tiny>
          <Chip label="Any" selected={roleFilter === 'ALL'} onPress={() => setRoleFilter('ALL')} />
          {(roles.data ?? []).map((entry) => (
            <Chip
              key={entry.name}
              label={entry.label}
              selected={roleFilter === entry.name}
              onPress={() => setRoleFilter(entry.name as RoleName)}
            />
          ))}
        </Row>
      </View>

      {users.isLoading ? (
        <SkeletonList rows={4} />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={search || status !== 'ALL' || roleFilter !== 'ALL' ? 'No account matches these filters' : 'No account yet'}
          description={search || status !== 'ALL' || roleFilter !== 'ALL' ? 'Clear the filters to see the whole directory.' : 'Invite the first account to give someone access to FEMS.'}
          actionLabel={canCreate && !formOpen ? 'Invite an account' : undefined}
          onAction={() => setFormOpen(true)}
        />
      ) : (
        filtered.map((user: DirectoryUser) => (
          <Pressable
            key={user.id}
            onPress={() => router.push({ pathname: '/user/[id]', params: { id: user.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${user.firstName} ${user.lastName}, ${user.roles.map((entry) => entry.label).join(', ')}`}
            style={({ pressed }) => ({ marginBottom: 10, opacity: pressed ? 0.85 : 1 })}
          >
            <Card>
              <Row gap={12}>
                <Avatar first={user.firstName} last={user.lastName} size={40} tone={user.status === 'ACTIVE' ? 'success' : user.status === 'SUSPENDED' ? 'danger' : 'warning'} />
                <View style={{ flex: 1 }}>
                  <Body style={{ fontWeight: '700' }}>
                    {user.firstName} {user.lastName}
                  </Body>
                  <Tiny tone="faint" lines={1}>
                    {user.jobTitle ?? 'No job title'} · {user.email}
                  </Tiny>
                  <Row gap={6} wrap style={{ marginTop: 6 }}>
                    <Badge label={userStatusLabel(user.status)} tone={user.status === 'ACTIVE' ? 'success' : user.status === 'SUSPENDED' ? 'danger' : 'warning'} compact />
                    {user.roles.map((entry) => (
                      <Badge key={entry.name} label={entry.label} tone="primary" compact />
                    ))}
                    {user.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
                  </Row>
                  <Tiny tone="faint" style={{ marginTop: 6 }}>
                    {user.lastLoginAt ? `last signed in ${formatRelative(user.lastLoginAt, 'en')}` : 'never signed in'}
                    {user.company ? ` · ${user.company.name}` : ''}
                  </Tiny>
                </View>
                <Ionicons name="chevron-forward-outline" size={18} color={theme.colors.textFaint} />
              </Row>
            </Card>
          </Pressable>
        ))
      )}

      <Overline style={{ marginTop: 8, marginBottom: 6 }}>
        Role catalogue
      </Overline>
      <Card>
        {(roles.data ?? []).map((entry) => (
          <Row justify="space-between" style={{ marginBottom: 6 }}>
            <View style={{ flex: 1 }}>
              <Tiny style={{ fontWeight: '600' }}>{entry.label}</Tiny>
              <Tiny tone="faint">
                level {entry.level} · {entry.permissionCount ?? entry.permissions?.length ?? 0} permission(s)
              </Tiny>
            </View>
            <Chip label="Filter" selected={roleFilter === entry.name} onPress={() => setRoleFilter(entry.name as RoleName)} />
          </Row>
        ))}
        <Caption tone="faint" style={{ marginTop: 4 }}>
          The catalogue is read from the API, including for the field and company roles whose work this session covers.
        </Caption>
      </Card>
    </Screen>
  );
}
