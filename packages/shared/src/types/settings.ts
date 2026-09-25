/** An "Approved by" box on the handover, transfer and return forms. */
export interface FormSignatory {
  title: string;
  /** Printed under the title; leave empty to write it by hand. */
  name: string;
}

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
  /** Footer lines printed on every page of the handover, transfer and return forms. */
  formFooter: string;
  /** Terms & Conditions on handover and transfer forms, one per line. {company} = company name. */
  formTerms: string;
  /** "Approved by" signature boxes, printed three per row. */
  formSignatories: FormSignatory[];
}

export const FORM_SIGNATORIES_MAX = 9;

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: 'ARC Global',
  defaultCurrency: 'AED',
  assetTagPrefix: 'AST',
  warrantyAlertDays: 30,
  licenseAlertDays: 30,
  maintenanceDueDays: 3,
  allowSelfRegistration: true,
  registrationRequiresApproval: false,
  formFooter: [
    'ARC GLOBAL TECHNICAL SERVICES | Website: www.arcglobaluae.com | Dubai – UAE',
    'Email: hr@arcgroup.ae | Contact: +97165323731 | P.O. Box: 4383',
  ].join('\n'),
  formTerms: [
    'The company-issued device(s) remain the property of {company}.',
    'The device(s) are provided strictly for official use unless otherwise approved.',
    'The employee is responsible for the care, safety, and proper use of the device(s).',
    'Any loss, damage, or misuse must be reported immediately to HR/IT.',
    'The device(s) must be returned in good condition upon resignation, termination, or when requested by management.',
    'The cost of repair or replacement may be recovered in case of negligence or misuse, as per company policy.',
  ].join('\n'),
  // Printed three per row, so six titles fill two rows.
  formSignatories: [
    'HR Department',
    'IT Department',
    'Finance Manager',
    'Commercial Manager',
    'Operations Manager',
    'Chief Operating Officer',
  ].map((title) => ({ title, name: '' })),
};

export const PASSWORD_POLICY = {
  minLength: 10,
  description: 'At least 10 characters, including a letter and a number.',
  pattern: /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/,
} as const;
