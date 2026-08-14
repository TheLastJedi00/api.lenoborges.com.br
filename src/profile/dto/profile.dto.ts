export class ProfileDto {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  bio: string | null;
  grade: number;
  profileCompleted: boolean;
}
