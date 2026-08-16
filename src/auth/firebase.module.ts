import { Global, Module } from '@nestjs/common';
import { FirebaseService } from './firebase.service';

/**
 * Global de proposito.
 *
 * O FirebaseService e a porta unica para o Firebase: auth e Firestore, a mesma
 * credencial. Isso significa que os repositories de waitlist e profile precisam
 * dele, e o AuthModule tambem -- e o AuthModule ja importa aqueles dois. Sem
 * @Global, o grafo fecha em circulo e a saida seria um forwardRef em cada ponta.
 *
 * O que era global antes, e continua sendo, e a conexao com o banco: o
 * TypeOrmModule.forRoot no AppModule tinha exatamente este papel. A mudanca aqui
 * e de fornecedor, nao de arquitetura.
 */
@Global()
@Module({
  providers: [FirebaseService],
  exports: [FirebaseService],
})
export class FirebaseModule {}
