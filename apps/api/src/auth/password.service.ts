import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';
import { PASSWORD_POLICY } from '@itam/shared';
import { Errors } from '../common/errors';

// OWASP-recommended Argon2id parameters (19 MiB, 2 iterations, 1 lane). Argon2id is the library default.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordService {
  /** Pre-computed hash used to equalise timing when the account does not exist. */
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string | null | undefined, password: string): Promise<boolean> {
    const target = passwordHash ?? (await (this.dummyHash ??= this.hash('dummy-password-000')));
    try {
      const ok = await verify(target, password);
      return ok && !!passwordHash;
    } catch {
      return false;
    }
  }

  assertPolicy(password: string, field = 'password'): void {
    if (!PASSWORD_POLICY.pattern.test(password)) {
      throw Errors.badRequest(PASSWORD_POLICY.description, field);
    }
  }
}
