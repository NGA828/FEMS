/**
 * Forest Assistant.
 *
 * The conversation runs entirely on the server: the app sends a question and the
 * API decides, from the caller's permissions, which sections of the register may
 * be sent to the model at all. The reply arrives with the scope the API actually
 * authorised and with anything it withheld — that transparency is the point, so it
 * is shown rather than hidden. With no Gemini key configured the deterministic
 * rule engine answers instead, and the screen says so.
 */
import React, { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError } from '../../../src/api/client';
import {
  useAiCatalogue,
  useAiStatus,
  useAskAssistant,
  useArchiveConversation,
  useConversation,
  useConversations,
  useDeleteConversation,
} from '../../../src/api/queries';
import { useAuth } from '../../../src/auth/AuthProvider';
import { useTheme } from '../../../src/theme/theme';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Divider,
  Notice,
  Overline,
  Row,
  Section,
  SkeletonList,
  TextField,
  Tiny,
  Title,
  useConfirm,
  useToast,
} from '../../../src/ui';
import { formatDateTime, formatRelative } from '../../../src/lib/format';

interface ChatTurn {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  provider?: string | null;
  latencyMs?: number | null;
  withheld?: { section: string; label: string; reason: string }[];
  sections?: { key: string; label: string; records: number }[];
  createdAt: string;
  error?: string | null;
}

export default function AssistantTab() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { user, hasPermission } = useAuth();
  const language = user?.preferredLanguage === 'fr' ? 'fr' : 'en';

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const listRef = useRef<FlatList<ChatTurn>>(null);

  const status = useAiStatus();
  const catalogue = useAiCatalogue();
  const conversations = useConversations({ limit: 20 });
  const conversation = useConversation(conversationId);
  const ask = useAskAssistant();
  const archive = useArchiveConversation();
  const remove = useDeleteConversation();

  React.useEffect(() => {
    if (!conversation.data?.messages) return;
    setTurns(
      conversation.data.messages.map((message) => ({
        id: message.id,
        role: message.role === 'USER' ? 'USER' : 'ASSISTANT',
        content: message.content,
        provider: (message.provider as string | null) ?? null,
        latencyMs: message.latencyMs,
        createdAt: message.createdAt,
      })),
    );
  }, [conversation.data]);

  const suggestions = useMemo(() => {
    const sections = catalogue.data?.assistantSections ?? [];
    return [
      'Which permits are active in my scope?',
      'Summarise the environmental cases opened this year.',
      'Which inspections are still waiting for a review?',
      'How much royalty was collected per month?',
      ...sections.slice(0, 2).map((entry) => `Explain the ${entry.label.toLowerCase()} section.`),
    ].slice(0, 5);
  }, [catalogue.data]);

  const ask_ = async () => {
    const text = question.trim();
    if (text.length < 3) {
      toast.error('Question too short', 'The API requires at least 3 characters.');
      return;
    }
    const localId = `local-${Date.now()}`;
    setTurns((current) => [...current, { id: localId, role: 'USER', content: text, createdAt: new Date().toISOString() }]);
    setQuestion('');
    try {
      const answer = await ask.mutateAsync({ question: text, conversationId: conversationId ?? undefined });
      setConversationId(answer.conversationId);
      setTurns((current) => [
        ...current,
        {
          id: `answer-${Date.now()}`,
          role: 'ASSISTANT',
          content: answer.answer,
          provider: answer.provider,
          latencyMs: answer.latencyMs,
          withheld: answer.context?.withheld,
          sections: answer.context?.sections,
          createdAt: new Date().toISOString(),
          error: answer.providerError ?? null,
        },
      ]);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'The assistant could not answer.';
      setTurns((current) => [
        ...current,
        { id: `error-${Date.now()}`, role: 'ASSISTANT', content: message, createdAt: new Date().toISOString(), error: message },
      ]);
      toast.error('Answer refused', message);
    }
  };

  const openConversation = (id: string) => {
    setConversationId(id);
    setShowHistory(false);
  };

  if (!hasPermission('ai:assistant_use')) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 16, paddingTop: insets.top + 16 }}>
        <Notice tone="warning" title="Not available for your role">
          Using the assistant requires the `ai:assistant_use` permission. Reading the forest register remains available from the other tabs.
        </Notice>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <FlatList
        ref={listRef}
        data={turns}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Row justify="space-between" align="flex-start" style={{ marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Title>Forest Assistant</Title>
                <Caption tone="muted">
                  {status.data?.geminiConfigured
                    ? `Answers from ${status.data.model} using only the records your role may read.`
                    : 'Rule-engine answers computed on your authorised records — no model is called without an API key.'}
                </Caption>
              </View>
              <Row gap={6}>
                <Button label="History" size="sm" variant="secondary" icon="time-outline" onPress={() => setShowHistory((current) => !current)} />
                {turns.length > 0 || conversationId ? (
                  <Button
                    label="New"
                    size="sm"
                    variant="ghost"
                    icon="add"
                    onPress={() => {
                      setConversationId(null);
                      setTurns([]);
                    }}
                  />
                ) : null}
              </Row>
            </Row>

            {showHistory ? (
              <Card style={{ marginBottom: 12 }}>
                <Overline style={{ marginBottom: 8 }}>Your conversations</Overline>
                {conversations.isLoading ? <SkeletonList rows={2} /> : null}
                {(conversations.data?.items ?? []).length === 0 && !conversations.isLoading ? (
                  <Caption tone="muted">No conversation stored yet. Ask a question to start one — it is kept with your account only.</Caption>
                ) : null}
                {(conversations.data?.items ?? []).map((entry) => (
                  <View key={entry.id} style={{ marginBottom: 10 }}>
                    <Pressable onPress={() => openConversation(entry.id)} accessibilityRole="button" accessibilityLabel={`Open conversation ${entry.title}`}>
                      <Row justify="space-between">
                        <Body style={{ flex: 1, fontWeight: entry.id === conversationId ? '700' : '500' }} lines={1}>
                          {entry.title}
                        </Body>
                        <Tiny tone="faint">{entry._count?.messages ?? 0} msg</Tiny>
                      </Row>
                      <Caption tone="faint">{formatRelative(entry.updatedAt ?? entry.createdAt, language)}</Caption>
                    </Pressable>
                    <Row gap={8} style={{ marginTop: 6 }}>
                      <Button
                        label="Archive"
                        size="sm"
                        variant="ghost"
                        icon="archive-outline"
                        loading={archive.isPending}
                        onPress={() =>
                          void archive
                            .mutateAsync(entry.id)
                            .then(() => toast.success('Conversation archived'))
                            .catch((error) => toast.error('Could not archive', error instanceof ApiError ? error.message : undefined))
                        }
                      />
                      <Button
                        label="Delete"
                        size="sm"
                        variant="ghost"
                        icon="trash-outline"
                        loading={remove.isPending}
                        onPress={async () => {
                          const answer = await confirm({
                            title: 'Delete conversation',
                            message: `“${entry.title}” and its messages will be removed from your account.`,
                            confirmLabel: 'Delete',
                            destructive: true,
                          });
                          if (!answer.confirmed) return;
                          try {
                            await remove.mutateAsync(entry.id);
                            if (entry.id === conversationId) {
                              setConversationId(null);
                              setTurns([]);
                            }
                            toast.success('Conversation deleted');
                          } catch (error) {
                            toast.error('Could not delete', error instanceof ApiError ? error.message : undefined);
                          }
                        }}
                      />
                    </Row>
                    <Divider style={{ marginTop: 8 }} />
                  </View>
                ))}
              </Card>
            ) : null}

            {turns.length === 0 ? (
              <Card style={{ marginBottom: 12 }}>
                <Overline style={{ marginBottom: 8 }}>What the assistant can see</Overline>
                <Caption tone="muted" style={{ marginBottom: 10 }}>
                  {status.data?.message ??
                    'The API decides per question which register sections you are authorised to read, and never sends anything else to the AI provider.'}
                </Caption>
                <Row gap={6} wrap>
                  {(catalogue.data?.assistantSections ?? []).map((section) => (
                    <Badge key={section.key} label={section.label} tone="neutral" compact />
                  ))}
                </Row>
                <View style={{ marginTop: 12 }}>
                  <Overline style={{ marginBottom: 8 }}>Try one of these</Overline>
                  {suggestions.map((suggestion) => (
                    <Pressable
                      key={suggestion}
                      onPress={() => setQuestion(suggestion)}
                      accessibilityRole="button"
                      accessibilityLabel={`Use suggestion: ${suggestion}`}
                      style={{ marginBottom: 8 }}
                    >
                      <Card padded>
                        <Row gap={8}>
                          <Ionicons name="sparkles-outline" size={16} color={theme.colors.primary} />
                          <Caption tone="muted" style={{ flex: 1 }}>
                            {suggestion}
                          </Caption>
                        </Row>
                      </Card>
                    </Pressable>
                  ))}
                </View>
              </Card>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ marginBottom: 12, alignItems: item.role === 'USER' ? 'flex-end' : 'flex-start' }}>
            <Card
              style={{
                maxWidth: '92%',
                backgroundColor: item.role === 'USER' ? theme.colors.primarySoft : theme.colors.surface,
                borderColor: item.error ? theme.colors.danger : theme.colors.border,
              }}
            >
              <Row justify="space-between" style={{ marginBottom: 6 }}>
                <Row gap={6}>
                  <Ionicons
                    name={item.role === 'USER' ? 'person-outline' : 'sparkles-outline'}
                    size={14}
                    color={item.role === 'USER' ? theme.colors.primary : theme.colors.info}
                  />
                  <Tiny tone="faint">{item.role === 'USER' ? 'You' : 'Forest Assistant'}</Tiny>
                </Row>
                <Tiny tone="faint">{formatRelative(item.createdAt, language)}</Tiny>
              </Row>
              <Body>{item.content}</Body>
              {item.role === 'ASSISTANT' && !item.error ? (
                <>
                  <Row gap={6} wrap style={{ marginTop: 10 }}>
                    <Badge label={item.provider === 'GEMINI' ? (item.provider ?? 'gemini') : 'rule engine'} tone={item.provider === 'GEMINI' ? 'success' : 'info'} compact />
                    {item.latencyMs !== null && item.latencyMs !== undefined ? <Badge label={`${item.latencyMs} ms`} tone="neutral" compact /> : null}
                  </Row>
                  {item.sections && item.sections.length > 0 ? (
                    <View style={{ marginTop: 8 }}>
                      <Tiny tone="faint">Authorised for this question: {item.sections.map((section) => `${section.label} (${section.records})`).join(' · ')}</Tiny>
                    </View>
                  ) : null}
                  {item.withheld && item.withheld.length > 0 ? (
                    <View style={{ marginTop: 6 }}>
                      <Tiny tone="faint">Withheld: {item.withheld.map((entry) => entry.reason).join(' ')}</Tiny>
                    </View>
                  ) : null}
                </>
              ) : null}
            </Card>
          </View>
        )}
      />

      <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface }}>
        <Row gap={8} style={{ paddingTop: 10 }}>
          <TextField
            label=""
            value={question}
            onChangeText={setQuestion}
            placeholder="Ask about permits, activities, cases, payments…"
            multiline
            style={{ flex: 1 }}
            editable={!ask.isPending}
            maxLength={status.data?.capabilities.maxQuestionLength ?? 800}
          />
          <View style={{ paddingTop: 6 }}>
            <Button label="Ask" icon="send-outline" loading={ask.isPending} disabled={question.trim().length < 3} onPress={() => void ask_()} />
          </View>
        </Row>
        <Row justify="space-between" style={{ marginTop: 4 }}>
          <Tiny tone="faint">
            {question.length}/{status.data?.capabilities.maxQuestionLength ?? 800} characters
          </Tiny>
          <Tiny tone="faint">
            {status.data?.counters.conversations ?? 0} conversation(s) · alerts awaiting review {status.data?.counters.alertsAwaitingReview ?? 0}
          </Tiny>
        </Row>
        <Caption tone="faint" style={{ marginTop: 4 }}>
          The assistant never accuses anyone and never takes a regulatory decision; it reports what the records in your scope contain.
          {status.data?.guardrails.length ? ` ${status.data.guardrails.length} guardrails enforced by the API.` : ''}
        </Caption>
      </View>
    </View>
  );
}
