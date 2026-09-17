import { SetMetadata } from '@nestjs/common';

export const SKIP_ENVELOPE_KEY = 'skipEnvelope';

/** Return the handler result as-is (e.g. file/QR downloads, CSV/PDF exports). */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE_KEY, true);
