import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { CreateEmployeeDto, EmployeeQueryDto, UpdateEmployeeDto } from './employees.dto';
import { EmployeesService } from './employees.service';

const VIEW = ['employee.view', 'employee.view_department', 'employee.view_own'] as const;

@ApiTags('Employees')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions(...VIEW)
  list(@Query() q: EmployeeQueryDto, @CurrentUser() user: AuthUser) {
    return this.employees.list(q, user);
  }

  @Post()
  @RequirePermissions('employee.create')
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.create(dto, user);
  }

  @Get(':id')
  @RequirePermissions(...VIEW)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.employees.get(id, user);
  }

  @Patch(':id')
  @RequirePermissions('employee.edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.employees.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('employee.delete')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.employees.remove(id, user);
  }

  @Get(':id/assets')
  @RequirePermissions(...VIEW)
  assets(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.employees.assets(id, user);
  }

  @Get(':id/tickets')
  @RequirePermissions(...VIEW)
  tickets(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.employees.tickets(id, user);
  }
}
