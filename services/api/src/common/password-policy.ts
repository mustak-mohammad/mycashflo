import { BadRequestException } from '@nestjs/common';

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_COMPLEXITY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9!@#$%^&*()_+\-=\[\]{}|;:,.<>?]).+$/;

export const PASSWORD_LENGTH_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`;

export const PASSWORD_COMPLEXITY_MESSAGE =
  'Password must contain at least one uppercase letter, one lowercase letter, and at least one number or special symbol';

export function assertStrongPassword(password: string, fieldLabel = 'Password'): void {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new BadRequestException(`${fieldLabel} must be at least ${PASSWORD_MIN_LENGTH} characters long`);
  }
  if (!PASSWORD_COMPLEXITY_REGEX.test(password)) {
    throw new BadRequestException(
      `${fieldLabel} must contain at least one uppercase letter, one lowercase letter, and at least one number or special symbol`,
    );
  }
}

