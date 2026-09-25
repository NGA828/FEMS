/**
 * Company file.
 *
 * Identity, contact details, registered location, the verification state of the
 * file and the documents that support it. A verifier can approve or reject the
 * registration (a rejection requires a written reason) and suspend or restore a
 * company; both decisions are recorded by the API with the reason and the caller.
 */
import React, { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '../../../src/api/client';
import type { CompanyDocument, DocumentType } from '../../../src/api/types';
import {
  useAddCompanyDocument,
  useCompany,
  useCompanyDocuments,
  useRemoveCompanyDocument,
  useSetCompanyStatus,
  useUploadFile,
  useVerifyCompany,
  useVerifyCompanyDocument,
} from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { downloadAuthenticatedFile } from '../../../src/lib/file-download';
import { companyStatusLabel, companyTypeLabel, documentTypeLabel, formatDateInput, formatDateTime, formatNumber, toIsoDateInput } from '../../../src/lib/format';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Definition,
  Divider,
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

const DOCUMENT_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'COMPANY_REGISTRATION', label: 'Company registration' },
  { value: 'TAX_CLEARANCE', label: 'Tax clearance' },
  { value: 'EXPLOITATION_LICENCE', label: 'Exploitation licence' },
  { value: 'ENVIRONMENTAL_IMPACT_ASSESSMENT', label: 'Environmental impact assessment' },
  { value: 'MANAGEMENT_PLAN', label: 'Management plan' },
  { value: 'TRANSPORT_PERMIT', label: 'Transport permit' },
  { value: 'LAND_TITLE', label: 'Land title' },
  { value: 'IDENTITY_DOCUMENT', label: 'Identity document' },
  { value: 'OTHER', label: 'Other' },
];

export default function CompanyFileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { hasPermission } = useAuth();

  const company = useCompany(id ?? null);
  const documents = useCompanyDocuments(id ?? null);
  const upload = useUploadFile();
  const addDocument = useAddCompanyDocument();
  const verifyDocument = useVerifyCompanyDocument();
  const removeDocument = useRemoveCompanyDocument();
  const verifyCompany = useVerifyCompany();
  const setStatus = useSetCompanyStatus();

  const [documentType, setDocumentType] = useState<DocumentType>('COMPANY_REGISTRATION');
  const [documentTitle, setDocumentTitle] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  if (company.isLoading) {
    return (
      <Screen>
        <PageHeader title="Company" onBack={() => router.back()} />
        <SkeletonDetail />
      </Screen>
    );
  }

  if (company.isError || !company.data) {
    return (
      <Screen>
        <PageHeader title="Company" onBack={() => router.back()} />
        <ErrorState error={company.error} onRetry={() => company.refetch()} title="This company file could not be loaded" />
      </Screen>
    );
  }

  const data = company.data;
  const documentItems = documents.data ?? data.documents ?? [];
  const canManageDocuments = hasPermission('companies:manage_documents');
  const canVerify = hasPermission('companies:verify');

  const decide = async (approved: boolean) => {
    const answer = await confirm({
      title: approved ? 'Approve this registration?' : 'Reject this registration?',
      message: approved
        ? `${data.name} becomes a verified operator in FEMS. The decision and your name are recorded.`
        : `${data.name} is marked rejected. The reason is stored on the file and the company is notified.`,
      confirmLabel: approved ? 'Approve' : 'Reject',
      destructive: !approved,
      requireReason: !approved,
      reasonLabel: 'Reason for rejection',
      reasonMinLength: 10,
    });
    if (!answer.confirmed) return;
    if (!approved && !answer.reason) {
      toast.error('A reason is required', 'Rejections are stored with the reason that justifies them.');
      return;
    }
    try {
      await verifyCompany.mutateAsync({ id: data.id, approved, rejectionReason: approved ? undefined : answer.reason });
      toast.success(approved ? 'Registration approved' : 'Registration rejected', data.name);
    } catch (error) {
      toast.error('Decision failed', error instanceof ApiError ? error.message : undefined);
    }
  };

  const changeStatus = async (next: 'SUSPENDED' | 'VERIFIED') => {
    const answer = await confirm({
      title: next === 'SUSPENDED' ? 'Suspend this company?' : 'Restore this company?',
      message:
        next === 'SUSPENDED'
          ? 'Suspension blocks new permits and field activity for this company until it is restored.'
          : 'The company returns to the verified register and can hold active permits again.',
      confirmLabel: next === 'SUSPENDED' ? 'Suspend' : 'Restore',
      destructive: next === 'SUSPENDED',
      requireReason: true,
      reasonLabel: 'Operational reason',
      reasonMinLength: 10,
    });
    if (!answer.confirmed) return;
    try {
      await setStatus.mutateAsync({ id: data.id, status: next, reason: answer.reason ?? '' });
      toast.success(next === 'SUSPENDED' ? 'Company suspended' : 'Company restored', data.name);
    } catch (error) {
      toast.error('Action failed', error instanceof ApiError ? error.message : undefined);
    }
  };

  const pickDocument = async () => {
    if (!documentTitle.trim()) {
      toast.error('Give the document a title', 'The title is what a verifier reads in the file.');
      return;
    }
    setBusy(true);
    try {
      const result = Platform.OS === 'web' ? await ImagePicker.launchImageLibraryAsync({ quality: 0.9, base64: true }) : await ImagePicker.launchImageLibraryAsync({ quality: 0.9 });
      if (result.canceled || !result.assets?.length) {
        setBusy(false);
        return;
      }
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'application/octet-stream';
      const name = asset.fileName ?? `company-document-${Date.now()}`;
      const uri = asset.base64 && Platform.OS === 'web' ? `data:${mimeType};base64,${asset.base64}` : asset.uri;

      const stored = await upload.mutateAsync({ file: { uri, name, mimeType }, folder: 'companies/documents' });
      await addDocument.mutateAsync({
        companyId: data.id,
        type: documentType,
        title: documentTitle.trim(),
        fileKey: stored.key,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        expiresAt: expiresAt ? new Date(`${expiresAt}T00:00:00.000Z`).toISOString() : undefined,
      });
      setDocumentTitle('');
      setExpiresAt('');
      toast.success('Document attached', `${documentTitle.trim()} is now part of the file.`);
    } catch (error) {
      toast.error('Upload failed', error instanceof ApiError ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const downloadDocument = async (document: CompanyDocument) => {
    setDownloadingId(document.id);
    const fileName = document.fileUrl?.split('/').pop() ?? `${document.title.replace(/\s+/g, '-')}`;
    const outcome = await downloadAuthenticatedFile(`/files/download?key=${encodeURIComponent(document.fileKey)}`, fileName);
    setDownloadingId(null);
    if (!outcome.saved) toast.error('Download failed', outcome.reason);
  };

  const toggleDocumentVerification = async (document: CompanyDocument) => {
    try {
      await verifyDocument.mutateAsync({
        companyId: data.id,
        documentId: document.id,
        isVerified: !document.isVerified,
      });
      toast.success(document.isVerified ? 'Verification removed' : 'Document verified', document.title);
    } catch (error) {
      toast.error('Could not update', error instanceof ApiError ? error.message : undefined);
    }
  };

  const dropDocument = async (document: CompanyDocument) => {
    const answer = await confirm({
      title: 'Remove this document?',
      message: `${document.title} is detached from the company file. The stored file is kept in the archive.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!answer.confirmed) return;
    try {
      await removeDocument.mutateAsync({ companyId: data.id, documentId: document.id });
      toast.success('Document removed', document.title);
    } catch (error) {
      toast.error('Could not remove', error instanceof ApiError ? error.message : undefined);
    }
  };

  const statusTone = data.status === 'VERIFIED' ? 'success' : data.status === 'PENDING' ? 'warning' : 'danger';

  return (
    <Screen refresh={company.isRefetching ? { refreshing: true, onRefresh: () => company.refetch() } : undefined}>
      <PageHeader title={data.name} subtitle={`${companyTypeLabel(data.type)} · ${companyStatusLabel(data.status)}`} onBack={() => router.back()} />

      {data.isDemo ? (
        <Notice tone="neutral" title="Seeded demo company">
          This record is part of the FEMS demo dataset. Its coordinates are plausible Cameroon locations used for demonstration only.
        </Notice>
      ) : null}

      <Card>
        <Row justify="space-between" style={{ marginBottom: 10 }}>
          <Badge label={companyStatusLabel(data.status)} tone={statusTone} />
          <Tiny tone="faint">{data.registrationNumber}</Tiny>
        </Row>
        {data.description ? <Caption tone="muted" style={{ marginBottom: 8 }}>{data.description}</Caption> : null}
        <Definition label="Tax number" value={data.taxNumber ?? '—'} />
        <Definition label="Email" value={data.email ?? '—'} />
        <Definition label="Phone" value={data.phone ?? '—'} />
        <Definition label="Address" value={[data.addressLine, data.city, data.region, data.country].filter(Boolean).join(', ') || '—'} />
        <Definition label="Website" value={data.website ?? '—'} />
        <Definition label="Employees" value={data.employeeCount ? formatNumber(data.employeeCount) : '—'} />
        <Definition label="Member accounts" value={formatNumber(data.members?.length ?? data._count?.members ?? 0)} />
        <Definition
          label="Location"
          value={data.latitude && data.longitude ? `${Number(data.latitude).toFixed(5)}, ${Number(data.longitude).toFixed(5)}` : 'not recorded'}
        />
        <Definition label="Registered" value={formatDateTime(data.createdAt, 'en')} />
        <Definition
          label="Verification"
          value={data.verifiedAt ? `${formatDateTime(data.verifiedAt, 'en')}${data.verifiedBy ? ` · ${data.verifiedBy.firstName} ${data.verifiedBy.lastName}` : ''}` : 'not verified yet'}
          tone={data.verifiedAt ? 'success' : 'warning'}
        />
        {data.rejectionReason ? <Definition label="Rejection reason" value={data.rejectionReason} tone="danger" /> : null}
      </Card>

      {data.latitude && data.longitude ? (
        <Button
          label="Show on the map"
          variant="secondary"
          icon="map-outline"
          style={{ marginTop: 10 }}
          onPress={() =>
            router.push({
              pathname: '/map',
              params: { latitude: String(data.latitude), longitude: String(data.longitude), label: data.name },
            })
          }
        />
      ) : (
        <Tiny tone="faint" style={{ marginTop: 10 }}>
          No registered coordinates, so there is nothing to centre the map on.
        </Tiny>
      )}

      <Section title="Regulatory activity">
        <Row gap={8} wrap>
          <Card style={{ flex: 1, minWidth: 100 }}>
            <Tiny tone="faint">Permits</Tiny>
            <Body style={{ fontWeight: '700' }}>{formatNumber(data._count?.permits ?? 0)}</Body>
          </Card>
          <Card style={{ flex: 1, minWidth: 100 }}>
            <Tiny tone="faint">Activities</Tiny>
            <Body style={{ fontWeight: '700' }}>{formatNumber(data._count?.activities ?? 0)}</Body>
          </Card>
          <Card style={{ flex: 1, minWidth: 100 }}>
            <Tiny tone="faint">Payments</Tiny>
            <Body style={{ fontWeight: '700' }}>{formatNumber(data._count?.payments ?? 0)}</Body>
          </Card>
          <Card style={{ flex: 1, minWidth: 100 }}>
            <Tiny tone="faint">Cases</Tiny>
            <Body style={{ fontWeight: '700', color: (data._count?.violations ?? 0) > 0 ? theme.colors.danger : undefined }}>
              {formatNumber(data._count?.violations ?? 0)}
            </Body>
          </Card>
        </Row>
      </Section>

      {canVerify ? (
        <Section title="Verification decision">
          <Caption tone="muted" style={{ marginBottom: 8 }}>
            Verification is a human decision. FEMS records who decided, when, and the reason for a rejection.
          </Caption>
          <Row gap={8} wrap>
            <Button
              label="Approve registration"
              icon="shield-checkmark-outline"
              disabled={data.status === 'VERIFIED'}
              loading={verifyCompany.isPending}
              onPress={() => void decide(true)}
            />
            <Button label="Reject" variant="danger" icon="close-circle-outline" disabled={data.status === 'REJECTED'} onPress={() => void decide(false)} />
            {data.status === 'SUSPENDED' ? (
              <Button label="Restore" variant="secondary" icon="play-circle-outline" onPress={() => void changeStatus('VERIFIED')} />
            ) : (
              <Button label="Suspend" variant="secondary" icon="pause-circle-outline" onPress={() => void changeStatus('SUSPENDED')} />
            )}
          </Row>
        </Section>
      ) : null}

      <Section title="Documents" action={<Badge label={`${documentItems.length}`} tone="neutral" compact />}>
        {documents.isLoading ? <Tiny tone="faint">Loading documents…</Tiny> : null}
        {documentItems.length === 0 && !documents.isLoading ? (
          <Card>
            <Caption tone="muted">
              No document has been attached to this file yet.
              {canManageDocuments ? ' Use the form below to attach the registration certificate or a tax clearance.' : ''}
            </Caption>
          </Card>
        ) : (
          documentItems.map((document) => (
            <Card key={document.id} style={{ marginBottom: 8 }}>
              <Row justify="space-between" style={{ marginBottom: 4 }}>
                <Body style={{ fontWeight: '600', flex: 1 }} lines={1}>
                  {document.title}
                </Body>
                <Badge label={document.isVerified ? 'verified' : 'unverified'} tone={document.isVerified ? 'success' : 'warning'} compact />
              </Row>
              <Tiny tone="faint">
                {documentTypeLabel(document.type)} · {(document.sizeBytes / 1024).toFixed(0)} KB · attached {formatDateTime(document.createdAt, 'en')}
                {document.uploadedBy ? ` by ${document.uploadedBy.firstName} ${document.uploadedBy.lastName}` : ''}
              </Tiny>
              {document.expiresAt ? (
                <Row gap={6} style={{ marginTop: 4 }}>
                  <Tiny tone="faint">Expires {formatDateInput(document.expiresAt)}</Tiny>
                  {new Date(document.expiresAt) < new Date() ? <Badge label="expired" tone="danger" compact /> : null}
                </Row>
              ) : null}
              <Row gap={8} wrap style={{ marginTop: 8 }}>
                <Button
                  size="sm"
                  variant="secondary"
                  label="Download"
                  icon="download-outline"
                  loading={downloadingId === document.id}
                  onPress={() => void downloadDocument(document)}
                />
                {canVerify ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    label={document.isVerified ? 'Remove verification' : 'Verify document'}
                    icon={document.isVerified ? 'close-circle-outline' : 'checkmark-circle-outline'}
                    onPress={() => void toggleDocumentVerification(document)}
                  />
                ) : null}
                {canManageDocuments ? (
                  <Button size="sm" variant="danger" label="Remove" icon="trash-outline" onPress={() => void dropDocument(document)} />
                ) : null}
              </Row>
            </Card>
          ))
        )}

        {canManageDocuments ? (
          <>
            <Divider />
            <Overline style={{ marginBottom: 8 }}>Attach a document</Overline>
            <SelectSheet label="Document type" value={documentType} options={DOCUMENT_TYPES} onChange={setDocumentType} required />
            <TextField label="Title" value={documentTitle} onChangeText={setDocumentTitle} placeholder="Registre de commerce 2026" required />
            <TextField
              label="Expires (optional)"
              value={expiresAt}
              onChangeText={setExpiresAt}
              placeholder="YYYY-MM-DD"
              help={`Today is ${toIsoDateInput(new Date())}`}
            />
            <Button
              label={busy ? 'Uploading…' : 'Choose a file and attach it'}
              icon="cloud-upload-outline"
              loading={busy}
              onPress={() => void pickDocument()}
            />
            <Caption tone="faint" style={{ marginTop: 6 }}>
              Allowed folders are fixed by the API; the file is stored server-side and only downloadable by an authorised caller.
            </Caption>
          </>
        ) : null}
      </Section>

      {data.members?.length ? (
        <Section title="Member accounts">
          <Card>
            {data.members.map((member) => (
              <Pressable
                key={member.id}
                onPress={() => router.push({ pathname: '/user/[id]', params: { id: member.id } })}
                accessibilityRole="button"
                accessibilityLabel={`${member.firstName} ${member.lastName}`}
              >
                <Row justify="space-between" style={{ marginBottom: 6 }}>
                  <View style={{ flex: 1 }}>
                    <Tiny style={{ fontWeight: '600' }}>
                      {member.firstName} {member.lastName}
                    </Tiny>
                    <Tiny tone="faint">
                      {member.jobTitle ?? member.email} · {member.userRoles?.map((entry) => entry.role.label).join(', ') ?? 'no role'}
                    </Tiny>
                  </View>
                  <Ionicons name="chevron-forward-outline" size={16} color={theme.colors.textFaint} />
                </Row>
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}
    </Screen>
  );
}
