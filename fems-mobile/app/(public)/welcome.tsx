/**
 * Visitor landing page — a public, image-first introduction to the national
 * forest estate.
 *
 * Everything here is served by public API endpoints and rendered from
 * database-resident media (`media_assets`), so a signed-out visitor gets a rich,
 * photography-led view of forests, protected areas and the platform's purpose —
 * with a clear path to sign in or register when they need to *act* rather than
 * *view*.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeroMedia, useMediaCovers, useForestStatistics, useForests, useProtectedAreas } from '../../src/api/queries';
import { mediaImageUrl } from '../../src/api/endpoints';
import { useTheme } from '../../src/theme/theme';
import { LogoLockup } from '../../src/components/brand/Logo';
import { MediaCover } from '../../src/components/media/MediaCover';
import {
  Badge,
  Body,
  Button,
  Caption,
  Overline,
  Row,
  Section,
  StatTile,
  Title,
  Heading,
  ErrorState,
  SkeletonList,
} from '../../src/ui';
import { forestTypeLabel, formatArea, protectedAreaTypeLabel } from '../../src/lib/format';
import type { Forest, MediaDescriptor, ProtectedArea } from '../../src/api/types';

export default function WelcomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const heroes = useHeroMedia();
  const statistics = useForestStatistics();
  const forests = useForests({ page: 1, limit: 8 });
  const protectedAreas = useProtectedAreas({ page: 1, limit: 6 });

  const forestIds = useMemo(() => (forests.data?.items ?? []).map((forest: Forest) => String(forest.id)), [forests.data]);
  const areaIds = useMemo(() => (protectedAreas.data?.items ?? []).map((area: ProtectedArea) => String(area.id)), [protectedAreas.data]);
  const forestCovers = useMediaCovers('FOREST', forestIds);
  const areaCovers = useMediaCovers('PROTECTED_AREA', areaIds);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} showsVerticalScrollIndicator={false}>
      {/* ------------------------------------------------------------- hero */}
      <View style={{ height: 470 }}>
        <HeroCarousel urls={(heroes.data ?? []).map((hero) => mediaImageUrl(hero)).filter((url): url is string => Boolean(url))} />
        <View style={{ position: 'absolute', inset: 0, justifyContent: 'space-between', paddingTop: insets.top + 16, paddingBottom: 30, paddingHorizontal: 20 }}>
          <Row justify="space-between" align="center">
            <LogoLockup mono align="left" markSize={44} />
            <Button label="Sign in" size="sm" variant="secondary" onPress={() => router.push('/login')} />
          </Row>

          <View style={{ gap: 14 }}>
            <Overline tone="inverted" style={{ letterSpacing: 2 }}>
              Cameroon · National forest estate
            </Overline>
            <Title style={{ color: '#FFFFFF', fontSize: 30, lineHeight: 36, fontWeight: '800' }}>The forest, accounted for.</Title>
            <Caption style={{ color: 'rgba(255,255,255,0.85)', maxWidth: 340, fontSize: 14, lineHeight: 20 }}>
              Explore classified forests, protected areas and the timber species of Cameroon — and, when you are ready to
              work with them, sign in to request permits, report from the field and monitor compliance.
            </Caption>
            <Row gap={10} style={{ marginTop: 4 }}>
              <Button label="Explore forests" icon="leaf-outline" onPress={() => router.push('/explore')} />
              <Button label="Create account" variant="secondary" onPress={() => router.push('/register')} />
            </Row>
          </View>
        </View>
      </View>

      {/* ------------------------------------------------------------- stats */}
      <View style={{ paddingHorizontal: 20, marginTop: -28 }}>
        <View
          style={{
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radii.xl,
            padding: 16,
            borderWidth: 1,
            borderColor: theme.colors.border,
            ...theme.shadows.raised,
          }}
        >
          {statistics.data ? (
            <Row gap={10} wrap>
              <StatTile label="Classified forests" value={statistics.data.total ?? 0} icon="leaf-outline" />
              <StatTile label="Protected areas" value={protectedAreas.data?.items?.length ?? 0} icon="shield-checkmark-outline" tone="success" />
              <StatTile label="Classified area" value={formatArea(statistics.data.totalAreaHa ?? 0)} icon="resize-outline" tone="accent" />
            </Row>
          ) : (
            <SkeletonList rows={1} />
          )}
        </View>
      </View>

      {/* -------------------------------------------------- featured forests */}
      <Section title="Featured forests" style={{ marginTop: 28, paddingHorizontal: 20 }}>
        {forests.isError ? (
          <ErrorState error={forests.error} onRetry={() => forests.refetch()} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 20 }}>
            {(forests.data?.items ?? []).map((forest: Forest) => (
              <ForestMediaCard
                key={String(forest.id)}
                forest={forest}
                cover={forestCovers.data?.[String(forest.id)] ?? null}
                onPress={() => router.push({ pathname: '/forest/[id]', params: { id: String(forest.id) } })}
              />
            ))}
            {forests.isLoading ? (
              <View style={{ width: 260 }}>
                <SkeletonList rows={1} />
              </View>
            ) : null}
          </ScrollView>
        )}
      </Section>

      {/* ----------------------------------------------- protected areas */}
      <Section title="Protected areas" style={{ paddingHorizontal: 20 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 20 }}>
          {(protectedAreas.data?.items ?? []).map((area: ProtectedArea) => (
            <AreaMediaCard key={String(area.id)} area={area} cover={areaCovers.data?.[String(area.id)] ?? null} />
          ))}
          {protectedAreas.isLoading ? (
            <View style={{ width: 240 }}>
              <SkeletonList rows={1} />
            </View>
          ) : null}
        </ScrollView>
      </Section>

      {/* --------------------------------------------------- how it works */}
      <Section title="How FEMS works" style={{ paddingHorizontal: 20 }}>
        <View style={{ gap: 12 }}>
          <StepRow icon="search-outline" step="01" title="Discover" text="Browse the public register of forests, zones and protected areas on an interactive map." />
          <StepRow icon="document-text-outline" step="02" title="Request & regulate" text="Companies and explorers file permit applications; officers review, approve and monitor them." />
          <StepRow icon="walk-outline" step="03" title="Verify in the field" text="Inspectors and operators capture GPS-stamped activity and evidence that the backend validates." />
        </View>
      </Section>

      {/* ----------------------------------------------------------- CTA */}
      <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40 }}>
        <View style={{ backgroundColor: theme.colors.primary, borderRadius: theme.radii.xl, padding: 20, gap: 12 }}>
          <Heading style={{ color: theme.colors.onPrimary }}>Ready to work with the forest?</Heading>
          <Caption style={{ color: 'rgba(255,255,255,0.85)' }}>
            Sign in to access role-specific dashboards — permits, payments, inspections, AI alerts and the GIS console.
          </Caption>
          <Row gap={12} align="center">
            <Button label="Sign in" variant="accent" icon="log-in-outline" onPress={() => router.push('/login')} />
            <Link href="/register" asChild>
              <Pressable accessibilityRole="link">
                <Caption style={{ color: theme.colors.onPrimary, fontWeight: '700', paddingVertical: 10 }}>Create an account →</Caption>
              </Pressable>
            </Link>
          </Row>
        </View>
        <Caption tone="faint" style={{ textAlign: 'center', marginTop: 16 }}>
          Demonstration dataset — seeded Cameroonian records labelled DEMO; not an official government register.
        </Caption>
      </View>
    </ScrollView>
  );
}

/** Auto-advancing crossfade carousel of the seeded hero frames. */
function HeroCarousel({ urls }: { urls: string[] }) {
  const [active, setActive] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (urls.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => {
        setActive((current) => (current + 1) % urls.length);
        fade.setValue(0);
        Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
      });
    }, 5200);
    return () => clearInterval(timer);
  }, [urls.length, fade]);

  return (
    <View style={{ position: 'absolute', inset: 0, backgroundColor: '#0B241C' }}>
      {urls.length > 0 ? (
        <Animated.Image source={{ uri: urls[active] }} style={{ position: 'absolute', inset: 0, opacity: fade }} resizeMode="cover" />
      ) : null}
      {/* Legibility scrims over the photography. */}
      <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(4,18,12,0.30)' }} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 240, backgroundColor: 'rgba(4,18,12,0.55)' }} />
      {urls.length > 1 ? (
        <Row gap={6} style={{ position: 'absolute', bottom: 12, alignSelf: 'center' }}>
          {urls.map((_, index) => (
            <View
              key={index}
              style={{
                width: index === active ? 18 : 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: index === active ? '#F0B24A' : 'rgba(255,255,255,0.4)',
              }}
            />
          ))}
        </Row>
      ) : null}
    </View>
  );
}

function ForestMediaCard({ forest, cover, onPress }: { forest: Forest; cover: MediaDescriptor | null; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Forest ${forest.name}`} style={{ width: 260 }}>
      <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, ...theme.shadows.card }}>
        <MediaCover descriptor={cover} fallbackLabel={forest.name} height={140} borderRadius={0} />
        <View style={{ padding: 14, gap: 6 }}>
          <Row justify="space-between" align="center">
            <Body style={{ fontWeight: '700', flex: 1 }} numberOfLines={1}>
              {forest.name}
            </Body>
            <Badge label={forestTypeLabel(forest.type)} tone="primary" compact />
          </Row>
          <Caption tone="muted">
            {forest.code} · {forest.region}
          </Caption>
          <Row gap={8}>
            <Badge label={formatArea(forest.totalAreaHa)} tone="neutral" icon="resize-outline" compact />
            {forest.isDemo ? <Badge label="DEMO" tone="info" compact /> : null}
          </Row>
        </View>
      </View>
    </Pressable>
  );
}

function AreaMediaCard({ area, cover }: { area: ProtectedArea; cover: MediaDescriptor | null }) {
  const theme = useTheme();
  return (
    <View style={{ width: 240, backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, ...theme.shadows.card }}>
      <MediaCover descriptor={cover} fallbackLabel={area.name} height={120} borderRadius={0} />
      <View style={{ padding: 14, gap: 6 }}>
        <Body style={{ fontWeight: '700' }} numberOfLines={1}>
          {area.name}
        </Body>
        <Caption tone="muted">{area.region}</Caption>
        <Badge label={protectedAreaTypeLabel(area.type)} tone="success" icon="shield-checkmark-outline" compact />
      </View>
    </View>
  );
}

function StepRow({ icon, step, title, text }: { icon: keyof typeof Ionicons.glyphMap; step: string; title: string; text: string }) {
  const theme = useTheme();
  return (
    <Row gap={12} align="flex-start" style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg, padding: 14, borderWidth: 1, borderColor: theme.colors.border }}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={20} color={theme.colors.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Row gap={6} align="center">
          <Caption tone="faint">{step}</Caption>
          <Body style={{ fontWeight: '700' }}>{title}</Body>
        </Row>
        <Caption tone="muted">{text}</Caption>
      </View>
    </Row>
  );
}
