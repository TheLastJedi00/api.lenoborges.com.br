import { Controller, Delete, HttpCode, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { MuralService } from './mural.service';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/mural')
@UseGuards(FirebaseAuthGuard, AdminGuard)
export class AdminMuralController {
  constructor(private readonly mural: MuralService) {}

  @Delete('perguntas/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Moderar: remover uma pergunta',
    description:
      'Para pergunta ofensiva, duplicada ou fora de tema. **Apaga os votos ' +
      'junto** — subcoleção não desaparece com o pai no Firestore, e votos ' +
      'órfãos são invisíveis e cobrados.',
  })
  @ApiResponse({ status: 204, description: 'Removida.' })
  @ApiResponse({ status: 403, description: 'Não é administrador.' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.mural.remove(id);
  }
}
