import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminUsersService } from './admin-users.service';
import { AdminUserPageDto } from './dto/admin-user-page.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar usuários cadastrados',
    description:
      'Junta a identidade do Firebase Auth com o perfil do Firestore. Quem ainda ' +
      'não concluiu o onboarding aparece com os campos de perfil nulos — e não ' +
      'pode sumir da lista, porque é quem o admin mais precisa ver.',
  })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'pageToken', required: false })
  @ApiResponse({ status: 200, type: AdminUserPageDto })
  @ApiResponse({ status: 403, description: 'Não é administrador.' })
  async list(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('pageToken') pageToken?: string,
  ): Promise<AdminUserPageDto> {
    return this.users.list(Math.min(Math.max(limit, 1), 1000), pageToken);
  }

  @Patch(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Alterar o grade de um membro',
    description:
      'Só `grade`. Promover a admin é script de terminal, e apagar usuário não ' +
      'existe nesta spec.',
  })
  @ApiResponse({ status: 204, description: 'Alterado.' })
  @ApiResponse({ status: 404, description: 'Usuário sem perfil.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<void> {
    await this.users.updateUser(id, dto);
  }
}
