/**
 * Profile and account settings.
 *
 * Shows the identity the backend reports (roles, permission count, company,
 * session list), lets the user edit the fields `PATCH /auth/me` accepts, change
 * the password through the API, revoke a session and pick the app theme. The
 * permission list is printed read-only: it comes from the server and is the same
 * list the guards use, so there is nothing to edit here.
 */
import React, { useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, fieldErrors } from '../../../src/api/client';
import {
  useChangePassword,
  useRevokeSession,
  useSessions,
  useUpdateProfile,
} from '../../../src/api/queries';
import { authApi } from '../../../src/api/endpoints';
import { useAuth } from '../../../src/auth/AuthProvider';
import { apiConfig } from '../../../src/api/config';
import { useTheme, useThemeController } from '../../../src/theme/theme';
import { roleContext, tabsFor } from '../../../src/navigation/tabs';
import {
  Avatar,
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  Divider,
  Notice,
  Overline,
  Row,
  Section,
  SegmentedControl,
  TextField,
  Title,
  useToast,
} from '../../../src/ui';
import { formatDateTime, formatRelative, fullName, userStatusLabel } from '../../../src/lib/format';

export default function ProfileScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const { user, permissions, roles, signOut, refreshUser, hasPermission, devWarnings, primaryRole } = useAuth();
  const { preference, setPreference, mode } = useThemeController();

  const sessions = useSessions();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const revokeSession = useRevokeSession();

  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [jobTitle, setJobTitle] = useState(user?.jobTitle ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const context = useMemo(() => roleContext(user, hasPermission), [user, hasPermission]);
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileError(null);
    try {
      const updated = await updateProfile.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || undefined,
        jobTitle: jobTitle.trim() || undefined,
      });
      await refreshUser();
      setEditing(false);
      toast.success('Profile updated', `${updated.firstName} ${updated.lastName}`);
    } catch (caught) {
      setProfileError(
        caught instanceof ApiError ? Object.values(fieldErrors(caught))[0] ?? caught.message : 'The update failed.',
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const savePassword = async () => {
    if (newPassword.length < 8) {
      setPasswordError('Use at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The two passwords do not match.');
      return;
    }
    setSavingPassword(true);
    setPasswordError(null);
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      toast.success('Password changed', 'Other sessions keep working until you sign them out.');
      setPasswordOpen(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (caught) {
      setPasswordError(caught instanceof ApiError ? caught.message : 'The password could not be changed.');
    } finally {
      setSavingPassword(false);
    }
  };

  const changeLanguage = async (next: 'en' | 'fr') => {
    try {
      await authApi.updateProfile({ preferredLanguage: next });
      await refreshUser();
      toast.info(next === 'fr' ? 'Langue : français' : 'Language: English');
    } catch (caught) {
      toast.error('Could not change the language', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: theme.tabBarHeight + 40 }}
      refreshControl={
        <RefreshControl
          refreshing={sessions.isRefetching}
          onRefresh={() => {
            void sessions.refetch();
            void refreshUser();
          }}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <Row justify="space-between" align="flex-start" style={{ marginBottom: 18 }}>
        <Row gap={14} style={{ flex: 1 }}>
          <Avatar first={user?.firstName} last={user?.lastName} size={56} />
          <View style={{ flex: 1 }}>
            <Title lines={1}>{user ? fullName(user) : ''}</Title>
            <Caption tone="muted">{user?.jobTitle ?? user?.email}</Caption>
            <Row gap={6} style={{ marginTop: 8 }} wrap>
              <Badge label={user?.roles?.[0]?.label ?? '—'} tone="primary" />
              {user?.company ? <Badge label={user.company.name} tone="accent" /> : null}
              {user?.status ? <Badge label={userStatusLabel(user.status, language)} tone={user.status === 'ACTIVE' ? 'success' : 'warning'} /> : null}
              {user?.isDemo ? <Badge label="Demo account" tone="info" /> : null}
            </Row>
          </View>
        </Row>
        <Button label="Edit" size="sm" variant="secondary" icon="create-outline" onPress={() => setEditing((current) => !current)} />
      </Row>

      {devWarnings.map((warning) => (
        <View key={warning} style={{ marginBottom: 12 }}>
          <Notice tone="info">{warning}</Notice>
        </View>
      ))}

      <Section title="Account">
        <Card>
          {editing ? (
            <>
              {profileError ? (
                <View style={{ marginBottom: 12 }}>
                  <Notice tone="danger">{profileError}</Notice>
                </View>
              ) : null}
              <TextField label="First name" value={firstName} onChangeText={setFirstName} />
              <TextField label="Last name" value={lastName} onChangeText={setLastName} />
              <TextField label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
              <TextField label="Job title" value={jobTitle} onChangeText={setJobTitle} />
              <Row gap={8}>
                <Button label="Save" onPress={saveProfile} loading={savingProfile} icon="checkmark-outline" />
                <Button
                  label="Cancel"
                  variant="ghost"
                  onPress={() => {
                    setEditing(false);
                    setProfileError(null);
                    setFirstName(user?.firstName ?? '');
                    setLastName(user?.lastName ?? '');
                    setPhone(user?.phone ?? '');
                    setJobTitle(user?.jobTitle ?? '');
                  }}
                />
              </Row>
            </>
          ) : (
            <>
              <Definition label="Email" value={user?.email ?? '—'} />
              <Definition label="Phone" value={user?.phone ?? '—'} />
              <Definition label="Job title" value={user?.jobTitle ?? '—'} />
              <Definition label="Member since" value={user?.createdAt ? formatDateTime(user.createdAt, language) : '—'} />
              <Definition label="Last sign-in" value={user?.lastLoginAt ? formatRelative(user.lastLoginAt, language) : '—'} />
            </>
          )}
        </Card>
      </Section>

      <Section title="Roles and scope">
        <Card>
          <Overline style={{ marginBottom: 8 }}>Roles held</Overline>
          {roles.map((role) => (
            <Row key={role} justify="space-between" style={{ paddingVertical: 6 }}>
              <Body>{role}</Body>
              <Badge label={`level ${user?.roles?.find((entry) => entry.name === role)?.level ?? '—'}`} tone="neutral" />
            </Row>
          ))}
          <Divider style={{ marginVertical: 12 }} />
          <Row justify="space-between">
            <Caption tone="muted">Permissions granted by the server</Caption>
            <Body style={{ fontWeight: '700' }}>{permissions.length}</Body>
          </Row>
          <Caption tone="faint" style={{ marginTop: 6 }}>
            {context.isAdministrator
              ? 'Administrator: full access to every module.'
              : context.isRegulator
                ? 'Regulatory scope: you decide on permits, inspect operations and review AI signals.'
                : context.isCompanyAccount
                  ? 'Company scope: registers and totals are limited to your own company.'
                  : context.isPublicAccount
                    ? 'Public scope: forest register, map and the AI assistant.'
                    : 'Field scope: assigned inspections, activities and field captures.'}
          </Caption>
          {primaryRole ? (
            <Caption tone="faint" style={{ marginTop: 6 }}>
              Permission checks always run again on the server; this list only decides what the app offers you.
            </Caption>
          ) : null}
        </Card>
      </Section>

      <Section title="Appearance">
        <Card>
          <Caption tone="muted" style={{ marginBottom: 10 }}>
            Light “Verdant Enterprise” for registers and reports; dark “Mission Control” for the map, the AI console and field capture.
          </Caption>
          <SegmentedControl
            value={preference}
            onChange={(next) => setPreference(next)}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
          <Caption tone="faint" style={{ marginTop: 8 }}>
            Active palette: {mode === 'dark' ? 'Mission Control (dark)' : 'Verdant Enterprise (light)'}
          </Caption>
        </Card>
      </Section>

      <Section title="Language">
        <Card>
          <SegmentedControl
            value={language}
            onChange={(next) => void changeLanguage(next)}
            options={[
              { value: 'en', label: 'English' },
              { value: 'fr', label: 'Français' },
            ]}
          />
          <Caption tone="faint" style={{ marginTop: 8 }}>
            Stored on your account with <Body style={{ fontWeight: '600' }}>PATCH /auth/me</Body>, so reports and notifications use it too.
          </Caption>
        </Card>
      </Section>

      <Section title="Sessions">
        <Card>
          {sessions.isLoading ? (
            <Caption tone="muted">Loading sessions…</Caption>
          ) : sessions.isError ? (
            <Caption tone="danger">Sessions could not be loaded.</Caption>
          ) : (
            (sessions.data ?? []).map((session, index) => (
              <View key={session.id}>
                {index > 0 ? <Divider style={{ marginVertical: 10 }} /> : null}
                <Row justify="space-between" gap={12}>
                  <View style={{ flex: 1 }}>
                    <Row gap={6}>
                      <Body style={{ fontWeight: '600' }}>{session.userAgent ?? "Unknown client"}</Body>
                      {session.current ? <Badge label="This device" tone="success" compact /> : null}
                    </Row>
                    <Caption tone="muted">
                      {session.ipAddress ?? 'IP hidden'} · since {formatRelative(session.createdAt, language)}
                    </Caption>
                  </View>
                  {session.current ? null : (
                    <Button
                      label="Revoke"
                      size="sm"
                      variant="ghost"
                      loading={revokeSession.isPending}
                      onPress={() =>
                        void revokeSession.mutateAsync(session.id, {
                          onSuccess: () => toast.success('Session revoked'),
                          onError: (error) => toast.error('Could not revoke', error instanceof ApiError ? error.message : undefined),
                        })
                      }
                    />
                  )}
                </Row>
              </View>
            ))
          )}
        </Card>
      </Section>

      <Section title="Security">
        <Card>
          {passwordOpen ? (
            <>
              {passwordError ? (
                <View style={{ marginBottom: 12 }}>
                  <Notice tone="danger">{passwordError}</Notice>
                </View>
              ) : null}
              <TextField label="Current password" required secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} />
              <TextField label="New password" required secureTextEntry value={newPassword} onChangeText={setNewPassword} help="At least 8 characters." />
              <TextField label="Confirm new password" required secureTextEntry value={confirmPassword} onChangeText={setConfirmPassword} />
              <Row gap={8}>
                <Button label="Change password" onPress={savePassword} loading={savingPassword} icon="shield-checkmark-outline" />
                <Button label="Cancel" variant="ghost" onPress={() => setPasswordOpen(false)} />
              </Row>
            </>
          ) : (
            <Row justify="space-between">
              <View style={{ flex: 1 }}>
                <Body style={{ fontWeight: '600' }}>Password</Body>
                <Caption tone="muted">Changing it revokes nothing by itself — sign out other devices separately.</Caption>
              </View>
              <Button label="Change" size="sm" variant="secondary" onPress={() => setPasswordOpen(true)} />
            </Row>
          )}
        </Card>
      </Section>

      <Section title="Session">
        <Card>
          <Row gap={8} wrap>
            <Button label="Sign out" variant="danger" icon="log-out-outline" onPress={() => void signOut().then(() => router.replace('/login'))} />
            <Button
              label="Sign out of all devices"
              variant="ghost"
              icon="phone-portrait-outline"
              onPress={() =>
                void signOut({ allDevices: true }).then(() => {
                  toast.info('Signed out everywhere');
                  router.replace('/login');
                })
              }
            />
          </Row>
          <Caption tone="faint" style={{ marginTop: 10 }}>
            Connected to {apiConfig.baseUrl} · FEMS {apiConfig.appVersion} · {Platform.OS}
          </Caption>
        </Card>
      </Section>

      <Section title="Shortcuts">
        <Row gap={8} wrap>
          {tabsFor(user).map((tab) => (
            <Button key={tab.name} label={tab.title} size="sm" variant="secondary" icon={tab.icon} onPress={() => router.push(tab.href as never)} />
          ))}
          <Button label="All modules" size="sm" variant="ghost" icon="ellipsis-horizontal" onPress={() => router.push('/modules')} />
        </Row>
      </Section>

      <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" accessibilityLabel="Open settings" style={{ marginTop: 4 }}>
        <Card>
          <Row justify="space-between">
            <Row gap={10}>
              <Ionicons name="settings-outline" size={18} color={theme.colors.textMuted} />
              <Body>Settings and notification preferences</Body>
            </Row>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textFaint} />
          </Row>
        </Card>
      </Pressable>
    </ScrollView>
  );
}
