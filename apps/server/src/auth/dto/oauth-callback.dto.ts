import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class OAuthCallbackDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  code!: string;

  @Matches(/^[a-f0-9]{64}$/)
  state!: string;
}

export class OAuthBindStartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}
