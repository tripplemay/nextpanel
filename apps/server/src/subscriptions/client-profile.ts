import { BadRequestException } from '@nestjs/common';

export type ClientProfile = 'compatible' | 'xhttp';

// An explicit opt-in avoids guessing capabilities from a spoofable/stale UA.
export function clientProfile(value: unknown): ClientProfile {
  if (value === undefined || value === 'compatible') return 'compatible';
  if (value === 'xhttp') return 'xhttp';
  throw new BadRequestException('Invalid client profile; expected compatible or xhttp');
}
