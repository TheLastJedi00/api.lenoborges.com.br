import { IsString, Length, IsEmail, Equals, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateWaitlistEntryDto {
  @IsString()
  @Length(2, 120)
  name: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Matches(/^[0-9]{10,11}$/, { message: 'phone must contain 10 or 11 digits' })
  phone: string;

  @IsEmail()
  email: string;

  @Equals(true, { message: 'consent must be true' })
  consent: boolean;
}
