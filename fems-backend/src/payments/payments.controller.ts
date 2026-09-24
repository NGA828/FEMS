import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import {
  CampayWebhookDto,
  InitiatePaymentDto,
  PaymentQueryDto,
  SimulatePaymentDto,
  VerifyPaymentDto,
} from './dto/payment.dto';
import { CurrentUser, Public, RequireAnyPermission, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { paginate } from '../common/dto/pagination.dto';

@ApiTags('payments')
@ApiBearerAuth('bearer')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @RequireAnyPermission('payments:read', 'payments:read_own')
  @ApiOperation({
    summary: 'List payments',
    description: 'A company account sees the payments it initiated; regulators see every payment in the system.',
  })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: PaymentQueryDto) {
    const { items, total } = await this.payments.list(user, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Get('statistics')
  @RequireAnyPermission('payments:read', 'payments:read_own')
  @ApiOperation({ summary: 'Collection totals, purpose mix and 12-month trend' })
  statistics(@CurrentUser() user: AuthenticatedUser, @Query() query: PaymentQueryDto) {
    return this.payments.statistics(user, query);
  }

  @Get('provider')
  @RequireAnyPermission('payments:read', 'payments:read_own')
  @ApiOperation({
    summary: 'Which payment provider is active and whether it is fully configured',
    description:
      'Lets the app tell a user honestly whether money can move right now, instead of pretending the mobile-money gateway is ready.',
  })
  provider() {
    return this.payments.describeProvider();
  }

  @Post()
  @RequirePermissions('payments:create')
  @ApiOperation({
    summary: 'Initiate a payment',
    description:
      'The backend re-computes the outstanding permit balance, asks the configured provider for a collection and returns a PENDING payment. ' +
      'A payment only becomes SUCCESSFUL after the provider confirms it (server-side verification or signed webhook).',
  })
  async initiate(@CurrentUser() user: AuthenticatedUser, @Body() dto: InitiatePaymentDto) {
    const result = await this.payments.initiate(user, dto);
    return { ...result.payment, duplicate: result.duplicate, sandbox: result.sandbox ?? false, instructions: result.instructions };
  }

  @Get(':id')
  @RequireAnyPermission('payments:read', 'payments:read_own')
  @ApiOperation({ summary: 'Payment detail' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payments.findOne(user, id);
  }

  @Get(':id/receipt')
  @RequirePermissions('payments:download_receipt')
  @ApiOperation({ summary: 'Receipt data for a settled payment' })
  receipt(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payments.receipt(user, id);
  }

  @Post(':id/verify')
  @RequirePermissions('payments:verify')
  @ApiOperation({
    summary: 'Verify a payment with the provider',
    description: 'Reads the authoritative transaction status back from Campay. The mobile app can never mark a payment as received.',
  })
  async verify(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: VerifyPaymentDto) {
    const result = await this.payments.verify(user, id, dto);
    return { ...result.payment, verification: result.verification };
  }

  @Post(':id/simulate')
  @RequirePermissions('payments:verify')
  @ApiOperation({
    summary: 'Confirm the outcome of a sandbox payment (PAYMENT_PROVIDER=simulator only)',
    description:
      'This endpoint replaces nothing about the real gateway: it exists so the full lifecycle can be tested without Campay credentials, and it is refused outright when a real provider is configured.',
  })
  async simulate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SimulatePaymentDto) {
    const result = await this.payments.simulate(user, id, dto);
    return { ...result.payment, sandbox: result.sandbox };
  }

  @Post(':id/refund')
  @RequirePermissions('payments:refund')
  @ApiOperation({ summary: 'Record a refund of a settled payment' })
  refund(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: VerifyPaymentDto) {
    return this.payments.refund(user, id, dto.notes);
  }

  @Post('webhook/campay')
  @Public()
  @HttpCode(200)
  @ApiHeader({ name: 'x-campay-signature', required: false, description: 'Shared secret configured as CAMPAY_WEBHOOK_SECRET' })
  @ApiParam({ name: 'id', required: false })
  @ApiOperation({
    summary: 'Campay settlement webhook',
    description:
      'Public endpoint authenticated by the shared webhook secret header. It can only settle a payment that already exists in FEMS.',
  })
  webhook(@Headers('x-campay-signature') signature: string | undefined, @Body() dto: CampayWebhookDto) {
    return this.payments.handleCampayWebhook(signature, dto);
  }
}
