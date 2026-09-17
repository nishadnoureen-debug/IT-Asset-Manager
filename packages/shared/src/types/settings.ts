export interface AppSettings {
  companyName: string;
  /** ISO-4217 code used when a record does not specify one. */
  defaultCurrency: string;
  /** Prefix for generated asset tags, e.g. AST → AST-000123. */
  assetTagPrefix: string;
  /** Days before warranty end to raise alerts. */
  warrantyAlertDays: number;
  /** Days before licence expiry to raise alerts. */
  licenseAlertDays: number;
  /** Days before a scheduled maintenance to notify the technician. */
  maintenanceDueDays: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: 'My Company',
  defaultCurrency: 'USD',
  assetTagPrefix: 'AST',
  warrantyAlertDays: 30,
  licenseAlertDays: 30,
  maintenanceDueDays: 3,
};

export const PASSWORD_POLICY = {
  minLength: 10,
  description: 'At least 10 characters, including a letter and a number.',
  pattern: /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/,
} as const;
