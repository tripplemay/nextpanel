import { IsBoolean } from 'class-validator';

export class UsageEnabledDto { @IsBoolean() enabled!: boolean; }
export class UsagePrepareDto { @IsBoolean() allowRestart!: boolean; }
