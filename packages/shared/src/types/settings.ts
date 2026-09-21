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
  /** Show "Create an account" on the sign-in page. */
  allowSelfRegistration: boolean;
  /**
   * When true, self-registered accounts wait for an administrator to approve them and choose roles.
   * When false (default) they can sign in immediately with the Employee role.
   */
  registrationRequiresApproval: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: 'My Company',
  defaultCurrency: 'USD',
  assetTagPrefix: 'AST',
  warrantyAlertDays: 30,
  licenseAlertDays: 30,
  maintenanceDueDays: 3,
  allowSelfRegistration: true,
  registrationRequiresApproval: false,
};

export const PASSWORD_POLICY = {
  minLength: 10,
  description: 'At least 10 characters, including a letter and a number.',
  pattern: /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/,
} as const;
