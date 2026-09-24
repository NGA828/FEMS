/**
 * Data-display components: badges, stat tiles, progress meters, avatars, charts
 * and timelines.
 *
 * Status colours are derived from the semantic role of the value (risk level,
 * permit state, payment state) so the same case reads the same colour wherever
 * it appears.
 */
import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { riskColor, spacing } from '../theme/tokens';
import { useTone } from './context';
import { Body, Caption, Overline, Tiny } from './text';
import { Row } from './surface';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function Badge({
  label,
  tone = 'neutral',
  icon,
  compact = false,
}: {
  label: string;
  tone?: BadgeTone;
  icon?: keyof typeof Ionicons.glyphMap;
  compact?: boolean;
}) {
  const theme = useTone();
  const palette = {
    neutral: { fg: theme.colors.neutral, bg: theme.colors.neutralSoft },
    primary: { fg: theme.colors.primary, bg: theme.colors.primarySoft },
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerSoft },
    info: { fg: theme.colors.info, bg: theme.colors.infoSoft },
    accent: { fg: theme.colors.accent, bg: theme.colors.accentSoft },
  }[tone];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: palette.bg,
        paddingVertical: compact ? 2 : 4,
        paddingHorizontal: compact ? 6 : 9,
        borderRadius: theme.radii.pill,
      }}
    >
      {icon ? <Ionicons name={icon} size={compact ? 10 : 12} color={palette.fg} /> : null}
      <Tiny style={{ color: palette.fg, fontWeight: '700', letterSpacing: 0.2 }}>{label}</Tiny>
    </View>
  );
}

/** Maps a domain status string onto a badge tone. */
export function statusTone(status: string | null | undefined): BadgeTone {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
    case 'VERIFIED':
    case 'COMPLETED':
    case 'SUCCESSFUL':
    case 'READY':
    case 'CLOSED':
    case 'RESOLVED':
    case 'COMPLIANT':
    case 'CONFIRMED':
    case 'PASS':
    case 'AVAILABLE':
      return 'success';
    case 'PENDING':
    case 'PENDING_VERIFICATION':
    case 'PAYMENT_PENDING':
    case 'PROCESSING':
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'REVIEWING':
    case 'SCHEDULED':
    case 'PLANNED':
    case 'GENERATING':
    case 'NEW':
    case 'OPEN':
    case 'UNDER_INVESTIGATION':
    case 'MAINTENANCE':
    case 'PENDING_SYNC':
      return 'warning';
    case 'REJECTED':
    case 'FAILED':
    case 'REVOKED':
    case 'EXPIRED':
    case 'SUSPENDED':
    case 'CANCELLED':
    case 'DEACTIVATED':
    case 'CRITICAL':
    case 'OUT_OF_SERVICE':
    case 'CRITICAL_NON_COMPLIANCE':
    case 'ESCALATED':
    case 'DISMISSED':
      return 'danger';
    case 'APPROVED':
    case 'REVISION_REQUIRED':
    case 'IN_PROGRESS':
    case 'IN_USE':
    case 'REVIEWED':
    case 'MINOR_NON_COMPLIANCE':
    case 'MAJOR_NON_COMPLIANCE':
    case 'HIGH':
      return 'accent';
    default:
      return 'neutral';
  }
}

export function StatusPill({ status, label }: { status: string | null | undefined; label: string }) {
  return <Badge label={label} tone={statusTone(status)} />;
}

export function RiskPill({ level, label }: { level: string | null | undefined; label: string }) {
  const theme = useTone();
  const { fg, bg } = riskColor(theme, level);
  return (
    <View style={{ backgroundColor: bg, paddingVertical: 4, paddingHorizontal: 9, borderRadius: theme.radii.pill }}>
      <Tiny style={{ color: fg, fontWeight: '700' }}>{label}</Tiny>
    </View>
  );
}

/**
 * Metric tile. `trend` is only rendered when the caller passes a real
 * comparison — a tile never invents an arrow.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'primary',
  trend,
  onPress,
  style,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tone?: BadgeTone;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string; good?: boolean };
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTone();
  const palette = {
    neutral: { fg: theme.colors.neutral, bg: theme.colors.neutralSoft },
    primary: { fg: theme.colors.primary, bg: theme.colors.primarySoft },
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerSoft },
    info: { fg: theme.colors.info, bg: theme.colors.infoSoft },
    accent: { fg: theme.colors.accent, bg: theme.colors.accentSoft },
  }[tone];

  const content = (
    <View
      style={[
        {
          flexGrow: 1,
          flexBasis: 150,
          backgroundColor: theme.colors.surface,
          borderRadius: theme.radii.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.colors.border,
          padding: spacing.lg,
          gap: 6,
        },
        theme.shadows.card,
        style,
      ]}
    >
      <Row justify="space-between" align="flex-start">
        <Overline style={{ letterSpacing: 0.8, color: theme.colors.textMuted, flex: 1 }}>{label}</Overline>
        {icon ? (
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: theme.radii.sm,
              backgroundColor: palette.bg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon} size={14} color={palette.fg} />
          </View>
        ) : null}
      </Row>
      <Body style={{ fontSize: 24, lineHeight: 29, fontWeight: '800' }} lines={1}>
        {value}
      </Body>
      {trend ? (
        <Row gap={4}>
          <Ionicons
            name={trend.direction === 'up' ? 'trending-up' : trend.direction === 'down' ? 'trending-down' : 'remove'}
            size={13}
            color={trend.good === false ? theme.colors.danger : theme.colors.success}
          />
          <Tiny style={{ color: theme.colors.textMuted }}>{trend.label}</Tiny>
        </Row>
      ) : hint ? (
        <Caption tone="muted" lines={2}>
          {hint}
        </Caption>
      ) : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={{ flexGrow: 1, flexBasis: 150 }}>
      {content}
    </Pressable>
  );
}

export function ProgressBar({
  value,
  max = 100,
  tone = 'primary',
  height = 8,
  label,
}: {
  value: number;
  max?: number;
  tone?: BadgeTone;
  height?: number;
  label?: string;
}) {
  const theme = useTone();
  const color = {
    neutral: theme.colors.neutral,
    primary: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    danger: theme.colors.danger,
    info: theme.colors.info,
    accent: theme.colors.accent,
  }[tone];
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));

  return (
    <View style={{ gap: 4 }}>
      {label ? <Caption tone="muted">{label}</Caption> : null}
      <View style={{ height, borderRadius: height / 2, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden' }}>
        <View style={{ width: `${ratio * 100}%`, height, borderRadius: height / 2, backgroundColor: color }} />
      </View>
    </View>
  );
}

export function Avatar({
  first,
  last,
  size = 40,
  tone = 'primary',
}: {
  first?: string | null;
  last?: string | null;
  size?: number;
  tone?: BadgeTone;
}) {
  const theme = useTone();
  const palette = {
    neutral: { fg: theme.colors.neutral, bg: theme.colors.neutralSoft },
    primary: { fg: theme.colors.primary, bg: theme.colors.primarySoft },
    success: { fg: theme.colors.success, bg: theme.colors.successSoft },
    warning: { fg: theme.colors.warning, bg: theme.colors.warningSoft },
    danger: { fg: theme.colors.danger, bg: theme.colors.dangerSoft },
    info: { fg: theme.colors.info, bg: theme.colors.infoSoft },
    accent: { fg: theme.colors.accent, bg: theme.colors.accentSoft },
  }[tone];
  const letters = `${(first ?? '').trim().charAt(0)}${(last ?? '').trim().charAt(0)}`.trim() || '?';

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Body style={{ color: palette.fg, fontWeight: '700', fontSize: size * 0.38 }}>{letters.toUpperCase()}</Body>
    </View>
  );
}

/** Compact horizontal bar chart driven by real aggregate values. */
export function BarChart({
  data,
  height = 120,
  valueFormatter,
}: {
  data: { label: string; value: number; tone?: string }[];
  height?: number;
  valueFormatter?: (value: number) => string;
}) {
  const theme = useTone();
  if (data.length === 0) {
    return (
      <Caption tone="muted" style={{ paddingVertical: spacing.lg }}>
        No data in this range.
      </Caption>
    );
  }
  const max = Math.max(...data.map((entry) => entry.value), 1);

  return (
    <View style={{ gap: spacing.sm }}>
      {data.map((entry) => {
        const { fg } = riskColor(theme, entry.tone ?? 'LOW');
        const ratio = entry.value / max;
        return (
          <View key={entry.label} style={{ gap: 4 }}>
            <Row justify="space-between">
              <Caption tone="muted" lines={1} style={{ flex: 1 }}>
                {entry.label}
              </Caption>
              <Caption style={{ fontWeight: '700' }}>{valueFormatter ? valueFormatter(entry.value) : entry.value}</Caption>
            </Row>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: theme.colors.surfaceAlt, overflow: 'hidden' }}>
              <View style={{ width: `${Math.max(3, ratio * 100)}%`, height: 8, borderRadius: 4, backgroundColor: fg }} />
            </View>
          </View>
        );
      })}
      <Tiny tone="faint">Maximum {valueFormatter ? valueFormatter(max) : max}</Tiny>
      <View style={{ height: height - data.length * 30 - 20 > 0 ? 0 : 0 }} />
    </View>
  );
}

/** Compliance score ring used by inspection detail screens. */
export function ScoreRing({
  value,
  size = 92,
  label = 'score',
  max = 100,
}: {
  value: number | null | undefined;
  size?: number;
  label?: string;
  max?: number;
}) {
  const theme = useTone();
  const safe = Math.max(0, Math.min(max, value ?? 0));
  const radius = size / 2 - 7;
  const circumference = 2 * Math.PI * radius;
  const dash = (safe / max) * circumference;
  const tone = safe >= 90 ? theme.colors.success : safe >= 75 ? theme.colors.primary : safe >= 55 ? theme.colors.warning : theme.colors.danger;

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={radius} stroke={theme.colors.surfaceAlt} strokeWidth={8} fill="transparent" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={tone}
            strokeWidth={8}
            fill="transparent"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeLinecap="round"
          />
        </G>
        <SvgText x={size / 2} y={size / 2 + 2} textAnchor="middle" fill={theme.colors.text} fontSize={20} fontWeight="700">
          {value === null || value === undefined ? '—' : Math.round(safe)}
        </SvgText>
        <SvgText x={size / 2} y={size / 2 + 18} textAnchor="middle" fill={theme.colors.textMuted} fontSize={10}>
          {label}
        </SvgText>
      </Svg>
    </View>
  );
}

/** Monthly activity/alert sparkline (volume columns). */
export function MonthBars({
  data,
  height = 70,
  color,
}: {
  data: { month: string; value: number }[];
  height?: number;
  color?: string;
}) {
  const theme = useTone();
  if (!data.length) {
    return (
      <Caption tone="muted" style={{ paddingVertical: spacing.md }}>
        No monthly data available.
      </Caption>
    );
  }
  const max = Math.max(...data.map((entry) => entry.value), 1);
  const accent = color ?? theme.colors.primary;
  const width = 320;
  const barWidth = Math.max(6, width / data.length - 6);

  return (
    <View style={{ gap: spacing.xs }}>
      <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <Line x1={0} y1={height - 1} x2={width} y2={height - 1} stroke={theme.colors.border} strokeWidth={1} />
        {data.map((entry, index) => {
          const barHeight = Math.max(2, (entry.value / max) * (height - 14));
          return (
            <Rect
              key={`${entry.month}-${index}`}
              x={index * (barWidth + 6) + 3}
              y={height - 1 - barHeight}
              width={barWidth}
              height={barHeight}
              rx={3}
              fill={entry.value === 0 ? theme.colors.surfaceAlt : accent}
            />
          );
        })}
      </Svg>
      <Row justify="space-between">
        <Tiny tone="faint">{data[0]?.month}</Tiny>
        <Tiny tone="faint">{data[data.length - 1]?.month}</Tiny>
      </Row>
    </View>
  );
}

export function Timeline({
  entries,
}: {
  entries: { id: string; title: string; description?: string | null; timestamp: string; tone?: BadgeTone; icon?: keyof typeof Ionicons.glyphMap }[];
}) {
  const theme = useTone();
  if (!entries.length) {
    return (
      <Caption tone="muted" style={{ paddingVertical: spacing.md }}>
        No history recorded yet.
      </Caption>
    );
  }
  return (
    <View>
      {entries.map((entry, index) => {
        const palette = {
          neutral: theme.colors.neutral,
          primary: theme.colors.primary,
          success: theme.colors.success,
          warning: theme.colors.warning,
          danger: theme.colors.danger,
          info: theme.colors.info,
          accent: theme.colors.accent,
        }[entry.tone ?? 'neutral'];

        return (
          <View key={entry.id} style={{ flexDirection: 'row', gap: spacing.md }}>
            <View style={{ alignItems: 'center', width: 22 }}>
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  backgroundColor: theme.colors.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name={entry.icon ?? 'ellipse'} size={entry.icon ? 12 : 7} color={palette} />
              </View>
              {index < entries.length - 1 ? (
                <View style={{ width: 1.5, flex: 1, backgroundColor: theme.colors.border, minHeight: 18 }} />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: spacing.lg }}>
              <Body style={{ fontWeight: '600' }}>{entry.title}</Body>
              {entry.description ? (
                <Caption tone="muted" style={{ marginTop: 2 }}>
                  {entry.description}
                </Caption>
              ) : null}
              <Tiny tone="faint" style={{ marginTop: 2 }}>
                {entry.timestamp}
              </Tiny>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Simple table used by the report preview (columns come from the API). */
export function DataTable({
  columns,
  rows,
  maxRows = 12,
}: {
  columns: { key: string; label: string }[];
  rows: (string | number | null)[][];
  maxRows?: number;
}) {
  const theme = useTone();
  if (!rows.length) {
    return (
      <Caption tone="muted" style={{ paddingVertical: spacing.md }}>
        The preview returned no rows for this filter.
      </Caption>
    );
  }
  return (
    <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, borderRadius: theme.radii.md, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', backgroundColor: theme.colors.surfaceAlt }}>
        {columns.map((column) => (
          <View key={column.key} style={{ flex: 1, padding: spacing.sm }}>
            <Tiny style={{ color: theme.colors.textMuted, fontWeight: '700' }} lines={2}>
              {column.label}
            </Tiny>
          </View>
        ))}
      </View>
      {rows.slice(0, maxRows).map((row, rowIndex) => (
        <View
          key={rowIndex}
          style={{
            flexDirection: 'row',
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: theme.colors.border,
            backgroundColor: rowIndex % 2 === 1 ? theme.colors.surfaceAlt : theme.colors.surface,
          }}
        >
          {columns.map((column, columnIndex) => (
            <View key={column.key} style={{ flex: 1, padding: spacing.sm }}>
              <Tiny tone="default" lines={2}>
                {row[columnIndex] === null || row[columnIndex] === undefined ? '—' : String(row[columnIndex])}
              </Tiny>
            </View>
          ))}
        </View>
      ))}
      {rows.length > maxRows ? (
        <View style={{ padding: spacing.sm, backgroundColor: theme.colors.surfaceAlt }}>
          <Tiny tone="muted">+ {rows.length - maxRows} more rows in the generated file</Tiny>
        </View>
      ) : null}
    </View>
  );
}

/** Legend used by the GIS map and the AI console. */
export function Legend({ items }: { items: { label: string; color: string; count?: number }[] }) {
  return (
    <Row gap={spacing.md} wrap>
      {items.map((item) => (
        <Row key={item.label} gap={6}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: item.color }} />
          <Tiny tone="muted">
            {item.label}
            {item.count !== undefined ? ` · ${item.count}` : ''}
          </Tiny>
        </Row>
      ))}
    </Row>
  );
}
