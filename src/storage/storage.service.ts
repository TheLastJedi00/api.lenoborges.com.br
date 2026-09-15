import { Injectable, Logger } from '@nestjs/common';
import { FirebaseService } from '../auth/firebase.service';

/**
 * Host das URLs publicas de objeto do Cloud Storage.
 *
 * E o endereco que o `makePublic()` habilita. **Nao e o
 * `firebasestorage.googleapis.com/.../o/<path>?alt=media`**, que e a API de
 * download do SDK web e exige o caminho escapado mais um token: aquela forma
 * existe para quem le por regra, e aqui ninguem le por regra.
 */
const STORAGE_HOST = 'storage.googleapis.com';

/**
 * O unico lugar deste repositorio que fala com o bucket (spec 027).
 *
 * **Toda escrita no Storage passa por aqui, e nao existe outro caminho** -- o
 * front manda o arquivo para esta API em multipart e nunca fala com o Firebase,
 * pela decisao da spec 005 que a spec 020 defendeu ao preco de tres rotas
 * publicas para tratar o `oobCode`. E por isso que o `storage.rules` nega tudo,
 * do mesmo jeito e pela mesma razao que o `firestore.rules`.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly firebase: FirebaseService) {}

  private get bucket() {
    return this.firebase.storage.bucket();
  }

  /**
   * Grava o arquivo e devolve a URL publica dele.
   *
   * **O `?v=<timestamp>` nao e enfeite.** O caminho de um avatar e fixo, para a
   * foto nova sobrescrever a velha em vez de acumular orfaos cobrados no bucket
   * (ver `avatarPath`). O preco disso e que a URL nao muda entre trocas, e o
   * navegador serve a antiga do cache: a pessoa troca a foto, recarrega a pagina
   * e ve a de antes, sem erro em lugar nenhum. O parametro e o que torna cada
   * troca uma URL nova para o cache, sem tornar o objeto um arquivo novo para o
   * bucket.
   *
   * **`makePublic` depois do `save`**, e nao um bucket com acesso publico
   * uniforme: o que fica legivel e o objeto que esta API acabou de escrever, e
   * nao todo caminho que exista ou venha a existir ali.
   */
  async upload(
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const file = this.bucket.file(path);

    await file.save(buffer, {
      contentType,
      // `resumable: false` porque estes arquivos tem no maximo 5 MB e a sessao
      // retomavel custa uma ida e volta a mais para nada. `cacheControl` longo
      // porque a invalidacao e o `?v=`, nao a expiracao.
      resumable: false,
      metadata: { cacheControl: 'public, max-age=31536000' },
    });

    await file.makePublic();

    return `${this.publicUrl(path)}?v=${Date.now()}`;
  }

  /**
   * Apaga o objeto.
   *
   * **O "nao existe" e engolido, e isso e decisao.** Remover a foto de quem nunca
   * teve uma pede um estado final -- nao ha foto -- que ja era verdade, e um 500
   * ali diria que falhou uma operacao que nao tinha nada para fazer. O resto sobe:
   * um 403 de credencial errada nao e "ja nao estava la", e engolir tudo faria uma
   * configuracao quebrada parecer remocao bem-sucedida para sempre.
   */
  async remove(path: string): Promise<void> {
    try {
      await this.bucket.file(path).delete();
    } catch (error) {
      if (this.isNotFound(error)) {
        this.logger.debug(`Objeto ja nao existia: ${path}`);
        return;
      }
      throw error;
    }
  }

  /**
   * Confere se a URL foi cunhada por esta API para aquele caminho exato.
   *
   * **Parseia como URL e compara host e pathname; nunca `includes`.** E a mesma
   * regra do `isUrlOf` em `src/common/social-url.ts`, escrita la porque procurar
   * `linkedin.com` dentro do texto aceita `https://evil.com/?u=linkedin.com`.
   * Aqui o preco de errar e maior: a rota de upload confere o tier antes de
   * gravar, mas ela e o `complete` sao duas chamadas, e sem esta conferencia o
   * membro manda no `complete` uma URL que ele nunca teve direito de produzir --
   * a de outro membro, ou uma de fora.
   */
  isOwnUrl(value: string, path: string): boolean {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }

    if (url.protocol !== 'https:') {
      return false;
    }

    if (url.hostname.toLowerCase() !== STORAGE_HOST) {
      return false;
    }

    // Igualdade, e nao `startsWith`: por prefixo, `trainings/uid-1/trn-10`
    // passaria por `trainings/uid-1/trn-1`.
    return url.pathname === `/${this.firebase.storageBucket}/${path}`;
  }

  private publicUrl(path: string): string {
    return `https://${STORAGE_HOST}/${this.firebase.storageBucket}/${path}`;
  }

  private isNotFound(error: unknown): boolean {
    // O erro do SDK de Storage traz `code` numerico; a mensagem e conferida so
    // como rede de seguranca, porque o campo ja mudou de formato entre versoes.
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 404) {
      return true;
    }
    return /no such object/i.test(
      (error as { message?: string } | null)?.message ?? '',
    );
  }
}
