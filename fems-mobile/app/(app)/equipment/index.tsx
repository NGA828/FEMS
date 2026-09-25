/**
 * Equipment register.
 *
 * Machines that belong to a company and are declared to FEMS. A company account
 * sees its own fleet; the administration sees every company's. Equipment that is
 * attached to an exploitation activity cannot be deleted — the API refuses and
 * says why, and this screen shows that answer instead of pretending it worked.
 */
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '../../../src/api/client';
import type { Equipment, EquipmentCategory, EquipmentStatus } from '../../../src/api/types';
import { useCreateEquipment, useDeleteEquipment, useEquipment, useMyCompany, useUpdateEquipment } from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { equipmentCategoryLabel, equipmentStatusLabel, formatDateInput, formatNumber, formatRelative, toIsoDateInput } from '../../../src/lib/format';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  Notice,
  Overline,
  PageHeader,
  Row,
  Screen,
  Section,
  SelectSheet,
  SkeletonList,
  StatTile,
  TextField,
  Tiny,
  useConfirm,
  useToast,
} from '../../../src/ui';

const CATEGORIES: EquipmentCategory[] = [
  'HARVESTER',
  'CHAINSAW',
  'LOGGING_TRUCK',
  'TRACTOR',
  'SKIDDER',
  'LOG_LOADER',
  'BULLDOZER',
  'DRONE',
  'SURVEY_EQUIPMENT',
  'OTHER',
];

const STATUSES: EquipmentStatus[] = ['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'OUT_OF_SERVICE'];

export default function EquipmentScreen() {
  const router = useRouter();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { hasPermission, user } = useAuth();

  const [status, setStatus] = useState<EquipmentStatus | 'ALL'>('ALL');
  const [category, setCategory] = useState<EquipmentCategory | 'ALL'>('ALL');
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [formCategory, setFormCategory] = useState<EquipmentCategory>('SKIDDER');
  const [formStatus, setFormStatus] = useState<EquipmentStatus>('AVAILABLE');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [capacityM3, setCapacityM3] = useState('');
  const [nextMaintenanceAt, setNextMaintenanceAt] = useState('');
  const [notes, setNotes] = useState('');

  const myCompany = useMyCompany(Boolean(user?.company));
  const query = useMemo(
    () => ({
      limit: 50,
      status: status === 'ALL' ? undefined : status,
      category: category === 'ALL' ? undefined : category,
      companyId: myCompany.data?.id,
    }),
    [status, category, myCompany.data?.id],
  );
  const equipment = useEquipment(query);
  const create = useCreateEquipment();
  const update = useUpdateEquipment();
  const remove = useDeleteEquipment();

  const items = equipment.data?.items ?? [];
  const canCreate = hasPermission('equipment:create');
  const canUpdate = hasPermission('equipment:update');
  const canDelete = hasPermission('equipment:delete');

  const dueForMaintenance = items.filter(
    (item: Equipment) => item.nextMaintenanceAt && new Date(item.nextMaintenanceAt) < new Date(Date.now() + 30 * 86_400_000),
  );

  const resetForm = () => {
    setName('');
    setRegistrationNumber('');
    setSerialNumber('');
    setManufacturer('');
    setModel('');
    setCapacityM3('');
    setNextMaintenanceAt('');
    setNotes('');
    setFormOpen(false);
  };

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error('Name the machine', 'At least two characters, as declared to the administration.');
      return;
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        category: formCategory,
        status: formStatus,
        companyId: myCompany.data?.id,
        registrationNumber: registrationNumber.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
        manufacturer: manufacturer.trim() || undefined,
        model: model.trim() || undefined,
        capacityM3: capacityM3 ? Number(capacityM3) : undefined,
        nextMaintenanceAt: nextMaintenanceAt ? new Date(`${nextMaintenanceAt}T00:00:00.000Z`).toISOString() : undefined,
        notes: notes.trim() || undefined,
      });
      toast.success('Equipment registered', `${name.trim()} is now part of the fleet.`);
      resetForm();
    } catch (error) {
      toast.error('Could not register', error instanceof ApiError ? error.message : undefined);
    }
  };

  const changeStatus = async (item: Equipment, next: EquipmentStatus) => {
    try {
      await update.mutateAsync({ id: item.id, payload: { status: next } });
      toast.success('Status updated', `${item.name} is now ${equipmentStatusLabel(next).toLowerCase()}.`);
    } catch (error) {
      toast.error('Could not update', error instanceof ApiError ? error.message : undefined);
    }
  };

  const drop = async (item: Equipment) => {
    const answer = await confirm({
      title: `Delete ${item.name}?`,
      message: 'Equipment already attached to an exploitation activity cannot be deleted — the API will refuse and say which activity holds it.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!answer.confirmed) return;
    try {
      await remove.mutateAsync(item.id);
      toast.success('Equipment removed', item.name);
    } catch (error) {
      toast.error('The API refused', error instanceof ApiError ? error.message : undefined);
    }
  };

  const mineOnly = Boolean(myCompany.data?.id);

  return (
    <Screen refresh={equipment.isRefetching ? { refreshing: true, onRefresh: () => equipment.refetch() } : undefined}>
      <PageHeader
        title="Equipment"
        subtitle={mineOnly ? `${myCompany.data?.name ?? 'Your company'} fleet` : 'All declared machinery'}
        onBack={() => router.back()}
        right={canCreate ? <Button label={formOpen ? 'Close' : 'Register'} icon={formOpen ? 'close-outline' : 'add-outline'} size="sm" onPress={() => setFormOpen(!formOpen)} /> : undefined}
      />

      <Row gap={8} wrap style={{ marginBottom: 12 }}>
        <StatTile label="Machines" value={formatNumber(equipment.data?.meta?.total ?? items.length)} icon="construct-outline" />
        <StatTile label="In use" value={items.filter((item: Equipment) => item.status === 'IN_USE').length} icon="play-outline" tone="primary" />
        <StatTile
          label="Maintenance soon"
          value={dueForMaintenance.length}
          icon="build-outline"
          tone={dueForMaintenance.length ? 'warning' : 'success'}
          hint="next 30 days"
        />
      </Row>

      {formOpen && canCreate ? (
        <Section title="Register a machine">
          <TextField label="Name" required value={name} onChangeText={setName} placeholder="John Deere 640L skidder" />
          <Row gap={8}>
            <View style={{ flex: 1 }}>
              <SelectSheet
                label="Category"
                value={formCategory}
                options={CATEGORIES.map((value) => ({ value, label: equipmentCategoryLabel(value) }))}
                onChange={setFormCategory}
                required
              />
            </View>
            <View style={{ flex: 1 }}>
              <SelectSheet
                label="Status"
                value={formStatus}
                options={STATUSES.map((value) => ({ value, label: equipmentStatusLabel(value) }))}
                onChange={setFormStatus}
              />
            </View>
          </Row>
          <Row gap={8}>
            <TextField label="Registration" value={registrationNumber} onChangeText={setRegistrationNumber} placeholder="LT-4521-CM" style={{ flex: 1 }} />
            <TextField label="Serial" value={serialNumber} onChangeText={setSerialNumber} placeholder="JD640L-2019-88213" style={{ flex: 1 }} />
          </Row>
          <Row gap={8}>
            <TextField label="Manufacturer" value={manufacturer} onChangeText={setManufacturer} placeholder="John Deere" style={{ flex: 1 }} />
            <TextField label="Model" value={model} onChangeText={setModel} placeholder="640L" style={{ flex: 1 }} />
          </Row>
          <Row gap={8}>
            <TextField label="Capacity (m³)" value={capacityM3} onChangeText={setCapacityM3} keyboardType="decimal-pad" placeholder="0.0" style={{ flex: 1 }} />
            <TextField label="Next maintenance" value={nextMaintenanceAt} onChangeText={setNextMaintenanceAt} placeholder="YYYY-MM-DD" style={{ flex: 1 }} />
          </Row>
          <TextField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Condition, permit references, drivers…" />
          <Button label={create.isPending ? 'Registering…' : 'Register equipment'} icon="checkmark-outline" loading={create.isPending} onPress={() => void submit()} />
          <Caption tone="faint" style={{ marginTop: 6 }}>
            Today is {toIsoDateInput(new Date())}. Dates are stored in UTC.
          </Caption>
        </Section>
      ) : null}

      <Row gap={6} wrap style={{ marginBottom: 8 }}>
        <Chip label="All statuses" selected={status === 'ALL'} onPress={() => setStatus('ALL')} />
        {STATUSES.map((value) => (
          <Chip key={value} label={equipmentStatusLabel(value)} selected={status === value} onPress={() => setStatus(value)} />
        ))}
      </Row>
      <Row gap={6} wrap style={{ marginBottom: 12 }}>
        <Tiny tone="faint">Category</Tiny>
        <Chip label="Any" selected={category === 'ALL'} onPress={() => setCategory('ALL')} />
        {CATEGORIES.map((value) => (
          <Chip key={value} label={equipmentCategoryLabel(value)} selected={category === value} onPress={() => setCategory(value)} />
        ))}
      </Row>

      {equipment.isLoading ? (
        <SkeletonList rows={4} />
      ) : equipment.isError ? (
        <ErrorState error={equipment.error} onRetry={() => equipment.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="construct-outline"
          title="No machine matches these filters"
          description={canCreate ? 'Register the machinery your company declares to the forest administration.' : 'Nothing has been declared for this company yet.'}
          actionLabel={canCreate ? 'Register a machine' : undefined}
          onAction={() => setFormOpen(true)}
        />
      ) : (
        items.map((item: Equipment) => {
          const maintenanceDue = item.nextMaintenanceAt ? new Date(item.nextMaintenanceAt) : null;
          const isDue = maintenanceDue ? maintenanceDue < new Date(Date.now() + 30 * 86_400_000) : false;
          const overdue = maintenanceDue ? maintenanceDue < new Date() : false;
          return (
            <Card key={item.id} style={{ marginBottom: 10 }}>
              <Row justify="space-between" style={{ marginBottom: 4 }}>
                <Body style={{ fontWeight: '700', flex: 1 }}>{item.name}</Body>
                <Badge
                  label={equipmentStatusLabel(item.status)}
                  tone={item.status === 'AVAILABLE' ? 'success' : item.status === 'IN_USE' ? 'primary' : item.status === 'MAINTENANCE' ? 'warning' : 'danger'}
                  compact
                />
              </Row>
              <Tiny tone="faint">
                {equipmentCategoryLabel(item.category)}
                {item.registrationNumber ? ` · ${item.registrationNumber}` : ''}
                {item.manufacturer ? ` · ${item.manufacturer}` : ''}
                {item.model ? ` ${item.model}` : ''}
              </Tiny>
              <Row gap={8} wrap style={{ marginTop: 6 }}>
                {item.capacityM3 ? <Tiny tone="faint">Capacity {Number(item.capacityM3)} m³</Tiny> : null}
                <Tiny tone="faint">{item._count?.usage ? `used on ${item._count.usage} activity(ies)` : 'never attached to an activity'}</Tiny>
                {item.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
              </Row>
              {maintenanceDue ? (
                <Row gap={6} style={{ marginTop: 6 }}>
                  <Tiny tone="faint">Next maintenance {formatDateInput(item.nextMaintenanceAt ?? null)}</Tiny>
                  {overdue ? <Badge label="overdue" tone="danger" compact /> : isDue ? <Badge label="due soon" tone="warning" compact /> : null}
                </Row>
              ) : null}
              {item.notes ? (
                <Caption tone="muted" style={{ marginTop: 6 }}>
                  {item.notes}
                </Caption>
              ) : null}

              {canUpdate ? (
                <>
                  <Divider style={{ marginVertical: 10 }} />
                  <Overline style={{ marginBottom: 6 }}>Set status</Overline>
                  <Row gap={6} wrap>
                    {STATUSES.filter((value) => value !== item.status).map((value) => (
                      <Chip key={value} label={equipmentStatusLabel(value)} onPress={() => void changeStatus(item, value)} />
                    ))}
                  </Row>
                </>
              ) : null}

              {canDelete ? (
                <Row style={{ marginTop: 10 }}>
                  <Button size="sm" variant="danger" label="Delete" icon="trash-outline" loading={remove.isPending} onPress={() => void drop(item)} />
                </Row>
              ) : null}
              <Tiny tone="faint" style={{ marginTop: 8 }}>
                Declared {formatRelative(item.createdAt ?? new Date().toISOString(), 'en')}
              </Tiny>
            </Card>
          );
        })
      )}

      {!mineOnly ? (
        <Notice tone="neutral" title="Fleet scope">
          You are seeing every company's equipment. A company account only ever sees its own fleet — the API applies that scope, not this screen.
        </Notice>
      ) : null}
    </Screen>
  );
}
