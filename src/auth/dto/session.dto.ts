export class UserInfoDto {
  id: string;
  email: string;
}

export class SessionResponseDto {
  accessToken: string;
  expiresIn: number;
  user: UserInfoDto;
  profileCompleted: boolean;
  grade: number;
}
