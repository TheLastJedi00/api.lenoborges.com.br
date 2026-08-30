import { computeXp, resolveElapsedSeconds } from './xp';

describe('resolveElapsedSeconds', () => {
  // O `min` e a decisao inteira: a latencia entre o clique e o `submittedAt`
  // e tempo de rede, e o membro nao pode ser penalizado por ela (decisao 3).
  it('usa o tempo do cliente quando ele e menor que o do servidor', () => {
    expect(
      resolveElapsedSeconds({ serverSeconds: 9, clientElapsedMs: 4200 }),
    ).toBeCloseTo(4.2);
  });

  it('usa o tempo do servidor quando o cliente alega ter demorado mais', () => {
    expect(
      resolveElapsedSeconds({ serverSeconds: 6, clientElapsedMs: 7000 }),
    ).toBe(6);
  });

  it('descarta tempo de cliente negativo', () => {
    // Ninguem responde em menos de zero segundo. Aceitar isto seria pagar 50 XP
    // por um numero que o proprio cliente escolheu.
    expect(
      resolveElapsedSeconds({ serverSeconds: 20, clientElapsedMs: -5000 }),
    ).toBe(20);
  });

  it('descarta tempo de cliente acima da tolerancia sobre o servidor', () => {
    // `serverSeconds + 2` e o teto. Acima disso o relogio do cliente esta
    // mentindo ou dessincronizado, e o do servidor prevalece.
    expect(
      resolveElapsedSeconds({ serverSeconds: 10, clientElapsedMs: 12_001 }),
    ).toBe(10);
  });

  it('aceita tempo de cliente dentro da tolerancia', () => {
    expect(
      resolveElapsedSeconds({ serverSeconds: 10, clientElapsedMs: 11_500 }),
    ).toBe(10);
  });

  it('usa o tempo do servidor quando o cliente nao mandou nada', () => {
    expect(
      resolveElapsedSeconds({ serverSeconds: 8, clientElapsedMs: null }),
    ).toBe(8);
  });

  it('nao aceita tempo de servidor negativo', () => {
    // Relogio do servidor nao anda para tras, mas `submittedAt - servedAt` pode
    // sair negativo num documento escrito por um caminho que ninguem previu, e
    // um numero negativo aqui pagaria acima do teto la na frente.
    expect(
      resolveElapsedSeconds({ serverSeconds: -3, clientElapsedMs: null }),
    ).toBe(0);
  });
});

describe('computeXp', () => {
  it('paga o valor cheio dentro da janela livre', () => {
    // Os cinco primeiros segundos sao de leitura do enunciado, e nao custam.
    expect(computeXp({ serverSeconds: 0, clientElapsedMs: null })).toBe(50);
    expect(computeXp({ serverSeconds: 5, clientElapsedMs: null })).toBe(50);
  });

  it('perde 1 XP por segundo completo a partir do sexto', () => {
    expect(computeXp({ serverSeconds: 6, clientElapsedMs: null })).toBe(49);
    expect(computeXp({ serverSeconds: 15, clientElapsedMs: null })).toBe(40);
  });

  it('conta segundo completo, e nao fracao', () => {
    // 6.9s ainda e o sexto segundo: a penalidade e por segundo cheio, senao o
    // XP viraria um numero quebrado na tela.
    expect(computeXp({ serverSeconds: 6.9, clientElapsedMs: null })).toBe(49);
  });

  it('nunca desce abaixo do piso de 1 XP', () => {
    // Quem acerta, recebe. Zero transformaria o acerto lento em erro.
    expect(computeXp({ serverSeconds: 54, clientElapsedMs: null })).toBe(1);
    expect(computeXp({ serverSeconds: 600, clientElapsedMs: null })).toBe(1);
  });

  it('nunca paga acima do valor base', () => {
    expect(computeXp({ serverSeconds: -10, clientElapsedMs: null })).toBe(50);
  });

  it('usa o tempo do cliente quando ele favorece o membro', () => {
    // O servidor mediu 12s por causa da rede; o dedo tocou a alternativa aos
    // 4s. O membro recebe os 50.
    expect(computeXp({ serverSeconds: 12, clientElapsedMs: 4000 })).toBe(50);
  });

  it('ignora o cliente que alega tempo negativo', () => {
    expect(computeXp({ serverSeconds: 30, clientElapsedMs: -1 })).toBe(25);
  });

  it('aceita o cliente que alega zero, e isso e o preco combinado', () => {
    // O piso e zero, entao um cliente adulterado que manda `0` leva os 50 XP.
    // **Isto e conhecido e aceito** (decisao 3): o teto protege contra o relogio
    // dessincronizado, nao contra quem edita o corpo da requisicao. Fechar essa
    // porta exigiria ignorar o tempo do cliente -- e ai a rede lenta passaria a
    // roubar XP de todo mundo que joga honesto, que e o dano maior.
    expect(computeXp({ serverSeconds: 30, clientElapsedMs: 0 })).toBe(50);
  });

  it('devolve sempre um inteiro', () => {
    for (const serverSeconds of [0.3, 5.5, 7.7, 33.33]) {
      const xp = computeXp({ serverSeconds, clientElapsedMs: null });
      expect(Number.isInteger(xp)).toBe(true);
    }
  });
});
