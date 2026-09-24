import { Module } from '@nestjs/common';
import { AccessoriesController } from './accessories/accessories.controller';
import { ActivityLogsController } from './activity-logs/activity-logs.controller';
import { AssetsController } from './assets/assets.controller';
import { AssetsService } from './assets/assets.service';
import { AssignmentsController } from './assignments/assignments.controller';
import { AssignmentsService } from './assignments/assignments.service';
import { HandoverPdfService } from './assignments/handover-pdf.service';
import { AuditsController } from './audits/audits.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { DocumentsController } from './documents/documents.controller';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { MaintenanceController } from './maintenance/maintenance.controller';
import { AlertsScheduler } from './notifications/alerts.scheduler';
import { NotificationsController } from './notifications/notifications.controller';
import {
  AssetTypesController,
  DepartmentsController,
  LocationsController,
} from './organization/organization.controllers';
import { PurchasesController, VendorsController } from './procurement/procurement.controllers';
import { QrController } from './qr/qr.controller';
import { QrService } from './qr/qr.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { SettingsController } from './settings/settings.controller';
import { LicensesController, SoftwareController } from './software/software.controllers';
import { RequestPdfService } from './requests/request-pdf.service';
import { RequestsController } from './requests/requests.controller';
import { RolesController, UsersController } from './users/users.controller';
import { WarrantiesController } from './warranties/warranties.controller';

@Module({ controllers: [AuthController], providers: [AuthService] })
export class AuthModule {}

@Module({
  controllers: [UsersController, RolesController, ActivityLogsController, SettingsController],
})
export class AdministrationModule {}

@Module({ controllers: [DepartmentsController, LocationsController, AssetTypesController] })
export class OrganizationModule {}

@Module({
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}

@Module({
  controllers: [AssetsController, WarrantiesController, QrController, DocumentsController],
  providers: [AssetsService, QrService],
  exports: [AssetsService],
})
export class AssetsModule {}

@Module({
  imports: [AssetsModule],
  controllers: [AssignmentsController, AccessoriesController],
  providers: [AssignmentsService, HandoverPdfService],
  exports: [AssignmentsService],
})
export class AssignmentsModule {}

@Module({ controllers: [VendorsController, PurchasesController] })
export class ProcurementModule {}

@Module({ imports: [AssetsModule], controllers: [MaintenanceController] })
export class MaintenanceModule {}

@Module({ controllers: [SoftwareController, LicensesController] })
export class SoftwareModule {}

@Module({
  imports: [AssignmentsModule],
  controllers: [RequestsController],
  providers: [RequestPdfService],
})
export class RequestsModule {}

@Module({ controllers: [AuditsController] })
export class AuditsModule {}

@Module({ controllers: [ReportsController, DashboardController], providers: [ReportsService] })
export class ReportsModule {}

@Module({ controllers: [NotificationsController], providers: [AlertsScheduler] })
export class NotificationsModule {}

export const FEATURE_MODULES = [
  AuthModule,
  AdministrationModule,
  OrganizationModule,
  EmployeesModule,
  AssetsModule,
  AssignmentsModule,
  ProcurementModule,
  MaintenanceModule,
  SoftwareModule,
  RequestsModule,
  AuditsModule,
  ReportsModule,
  NotificationsModule,
];
