import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import {
  AlertQueryDto,
  AnalysisQueryDto,
  AskAssistantDto,
  ConversationQueryDto,
  ReviewAlertDto,
  RunAnalysisDto,
} from './dto/ai.dto';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { paginate } from '../common/dto/pagination.dto';

@ApiTags('ai')
@ApiBearerAuth('bearer')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('status')
  @RequirePermissions('ai:assistant_use')
  @ApiOperation({
    summary: 'AI module status for the caller',
    description:
      'Reports whether Gemini is configured, which deterministic rules exist, what the caller may do and how many alerts are waiting for a review.',
  })
  status(@CurrentUser() user: AuthenticatedUser) {
    return this.ai.status(user);
  }

  @Get('catalogue')
  @RequirePermissions('ai:assistant_use')
  @ApiOperation({ summary: 'Rule catalogue, thresholds, alert actions and assistant data sections' })
  catalogue() {
    return this.ai.catalogue();
  }

  // ----------------------------------------------------------------- analyses

  @Post('analyses')
  @RequirePermissions('ai:analysis_run')
  @ApiOperation({
    summary: 'Run a forest-intelligence analysis',
    description:
      'Computes over the live database with the caller’s scope. The deterministic rule engine always runs and produces the findings; ' +
      'Gemini, when configured, only writes the narrative summary. Every finding becomes an alert with status NEW for an officer to review.',
  })
  runAnalysis(@CurrentUser() user: AuthenticatedUser, @Body() dto: RunAnalysisDto) {
    return this.ai.runAnalysis(user, dto);
  }

  @Get('analyses')
  @RequirePermissions('ai:alerts_read')
  @ApiOperation({ summary: 'Analyses run by the caller (regulators see every analysis)' })
  async listAnalyses(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalysisQueryDto) {
    const { items, total } = await this.ai.listAnalyses(user, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Get('analyses/:id')
  @RequirePermissions('ai:alerts_read')
  @ApiOperation({ summary: 'One analysis with its findings and the alerts it raised' })
  findOneAnalysis(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ai.findOneAnalysis(user, id);
  }

  // -------------------------------------------------------------------- alerts

  @Get('alerts')
  @RequirePermissions('ai:alerts_read')
  @ApiOperation({
    summary: 'List AI signals',
    description: 'Each row carries its review position (awaiting review, overdue against the SLA) and the actions the caller may take.',
  })
  async listAlerts(@CurrentUser() user: AuthenticatedUser, @Query() query: AlertQueryDto) {
    const { items, total, reviewSlaHours } = await this.ai.listAlerts(user, query);
    const envelope = paginate(items, total, query.page, query.limit);
    return { ...envelope, reviewSlaHours };
  }

  @Get('alerts/statistics')
  @RequirePermissions('ai:alerts_read')
  @ApiOperation({ summary: 'Alert workload: review status, risk, type, forest and human decisions recorded' })
  alertStatistics(@CurrentUser() user: AuthenticatedUser) {
    return this.ai.alertStatistics(user);
  }

  @Get('alerts/:id')
  @RequirePermissions('ai:alerts_read')
  @ApiOperation({ summary: 'One alert with the reasoning behind it, its linked case and the actions available' })
  findOneAlert(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ai.findOneAlert(user, id);
  }

  @Post('alerts/:id/review')
  @RequirePermissions('ai:alerts_review')
  @ApiOperation({
    summary: 'Record an officer decision on an alert',
    description:
      'Actions: ACKNOWLEDGE, CONFIRM, DISMISS, RESOLVE, REOPEN. A written reason is required for every action that has a regulatory effect, ' +
      'confirming needs the documented evidence, and only a confirmation may link the alert to an environmental case. ' +
      'An alert is never confirmed by the algorithm: the decision and its author are stored.',
  })
  reviewAlert(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewAlertDto) {
    return this.ai.reviewAlert(user, id, dto);
  }

  // ----------------------------------------------------------------- assistant

  @Post('assistant/ask')
  @RequirePermissions('ai:assistant_use')
  @ApiOperation({
    summary: 'Ask the Forest Assistant',
    description:
      'The backend authorises the question first: only the sections the caller may read are sent to Gemini, and a company account is pinned to its own records. ' +
      'With no Gemini key configured, the deterministic reader answers from the same authorised data and says so.',
  })
  ask(@CurrentUser() user: AuthenticatedUser, @Body() dto: AskAssistantDto) {
    return this.ai.ask(user, dto);
  }

  @Get('assistant/conversations')
  @RequirePermissions('ai:assistant_use')
  @ApiOperation({ summary: 'The caller’s own assistant conversations' })
  async listConversations(@CurrentUser() user: AuthenticatedUser, @Query() query: ConversationQueryDto) {
    const { items, total } = await this.ai.listConversations(user, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Get('assistant/conversations/:id')
  @RequirePermissions('ai:assistant_use')
  @ApiOperation({ summary: 'One conversation with its messages and the scope that was used' })
  getConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ai.getConversation(user, id);
  }

  @Patch('assistant/conversations/:id/archive')
  @RequirePermissions('ai:assistant_use')
  @ApiOperation({ summary: 'Archive a conversation' })
  archiveConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ai.archiveConversation(user, id);
  }

  @Delete('assistant/conversations/:id')
  @RequirePermissions('ai:assistant_use')
  @ApiOperation({ summary: 'Delete a conversation and its messages' })
  deleteConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.ai.deleteConversation(user, id);
  }
}
