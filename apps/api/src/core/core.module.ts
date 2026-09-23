import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ActivityLogService } from '../activity-logs/activity-log.service';
import { AssetHistoryService } from '../assets/asset-history.service';
import { PasswordService } from '../auth/password.service';
import { UserAccessService } from '../auth/user-access.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CompanyFormService } from '../pdf/company-form.service';
import { PdfService } from '../pdf/pdf.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';

const services = [
  ActivityLogService,
  AssetHistoryService,
  CryptoService,
  DocumentsService,
  NotificationsService,
  PasswordService,
  CompanyFormService,
  PdfService,
  SettingsService,
  StorageService,
  UserAccessService,
];

/** Cross-cutting services used by most feature modules. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: services,
  exports: [...services, JwtModule],
})
export class CoreModule {}
