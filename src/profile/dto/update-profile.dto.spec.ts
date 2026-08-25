import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

const base = {
  name: 'Leno Borges',
  phone: '47999990000',
  bio: 'Bio valida para o teste do DTO.',
};

async function errorsFor(payload: Record<string, unknown>) {
  const dto = plainToInstance(UpdateProfileDto, payload);
  return validate(dto);
}

describe('UpdateProfileDto — redes sociais', () => {
  it('aceita o corpo sem as redes: os dois campos sao opcionais', async () => {
    expect(await errorsFor(base)).toHaveLength(0);
  });

  it('aceita as duas URLs completas', async () => {
    const errors = await errorsFor({
      ...base,
      linkedin: 'https://www.linkedin.com/in/fulano',
      instagram: 'https://instagram.com/fulano',
    });

    expect(errors).toHaveLength(0);
  });

  it('recusa URL de outro dominio', async () => {
    const errors = await errorsFor({
      ...base,
      linkedin: 'https://evil.com/?u=linkedin.com',
    });

    expect(errors.map((error) => error.property)).toEqual(['linkedin']);
  });

  it('recusa handle solto: o front normaliza antes de mandar', async () => {
    const errors = await errorsFor({ ...base, instagram: '@fulano' });

    expect(errors.map((error) => error.property)).toEqual(['instagram']);
  });

  it('string vazia vira null, que e a remocao do campo', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      ...base,
      linkedin: '',
      instagram: '   ',
    });

    expect(dto.linkedin).toBeNull();
    expect(dto.instagram).toBeNull();
    expect(await validate(dto)).toHaveLength(0);
  });

  it('recusa URL acima de 200 caracteres', async () => {
    const errors = await errorsFor({
      ...base,
      linkedin: `https://www.linkedin.com/in/${'a'.repeat(200)}`,
    });

    expect(errors.map((error) => error.property)).toEqual(['linkedin']);
  });
});
