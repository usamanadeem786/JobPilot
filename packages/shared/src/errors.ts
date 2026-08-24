/**
 * Machine-readable error codes.
 *
 * The API never returns a bare string to the client: every failure carries a
 * code from this list plus a human message, so the UI can localise, retry or
 * offer a specific remedy instead of showing "something went wrong".
 */
export const ErrorCode = {
  // Generic
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',

  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  OAUTH_PROVIDER_DISABLED: 'OAUTH_PROVIDER_DISABLED',

  // Files & CV
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  FILE_REJECTED_BY_SCANNER: 'FILE_REJECTED_BY_SCANNER',
  CV_PARSE_FAILED: 'CV_PARSE_FAILED',
  CV_GENERATION_FAILED: 'CV_GENERATION_FAILED',
  NO_MASTER_CV: 'NO_MASTER_CV',

  // Job sources
  SOURCE_NOT_CONFIGURED: 'SOURCE_NOT_CONFIGURED',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  SOURCE_RATE_LIMITED: 'SOURCE_RATE_LIMITED',
  SOURCE_FORBIDDEN_BY_ROBOTS: 'SOURCE_FORBIDDEN_BY_ROBOTS',
  NO_JOBS_FOUND: 'NO_JOBS_FOUND',

  // AI
  AI_PROVIDER_NOT_CONFIGURED: 'AI_PROVIDER_NOT_CONFIGURED',
  OAUTH_NOT_CONFIGURED: 'OAUTH_NOT_CONFIGURED',
  AI_RESPONSE_INVALID: 'AI_RESPONSE_INVALID',
  AI_REQUEST_FAILED: 'AI_REQUEST_FAILED',

  // Contacts & outreach
  NO_VERIFIED_CONTACT_FOUND: 'NO_VERIFIED_CONTACT_FOUND',
  OUTREACH_NOT_APPROVED: 'OUTREACH_NOT_APPROVED',
  OUTREACH_TRANSPORT_NOT_CONFIGURED: 'OUTREACH_TRANSPORT_NOT_CONFIGURED',

  // Applications
  AUTOMATED_APPLICATION_NOT_PERMITTED: 'AUTOMATED_APPLICATION_NOT_PERMITTED',
  APPLICATION_ALREADY_EXISTS: 'APPLICATION_ALREADY_EXISTS',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Field-level detail attached to a VALIDATION_FAILED response. */
export interface ApiFieldError {
  readonly path: string;
  readonly message: string;
}

/** The exact JSON body every non-2xx API response uses. */
export interface ApiErrorBody {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly message: string;
  readonly fieldErrors?: ApiFieldError[];
  /** Correlates the failure with the server logs. */
  readonly requestId?: string;
  readonly timestamp: string;
  readonly path?: string;
}

/**
 * Default copy shown when the client has no more specific message. Kept next
 * to the codes so a new code cannot be added without user-facing wording.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'Some of the values you entered are not valid.',
  NOT_FOUND: 'We could not find what you were looking for.',
  CONFLICT: 'That change conflicts with data that already exists.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. The error has been logged.',

  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  EMAIL_ALREADY_REGISTERED: 'An account with this email already exists.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have access to this resource.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  TOKEN_REUSE_DETECTED: 'Your session was ended for security reasons. Please sign in again.',
  ACCOUNT_SUSPENDED: 'This account has been suspended.',
  OAUTH_PROVIDER_DISABLED: 'This sign-in provider is not configured on this deployment.',

  FILE_TOO_LARGE: 'That file is larger than the allowed upload size.',
  UNSUPPORTED_FILE_TYPE: 'Only PDF and DOCX files are supported.',
  FILE_REJECTED_BY_SCANNER: 'The uploaded file did not pass the security scan.',
  CV_PARSE_FAILED: 'We could not read the text out of that CV. Try a different export.',
  CV_GENERATION_FAILED: 'The CV could not be generated. Nothing was saved.',
  NO_MASTER_CV: 'Upload a master CV first — tailoring needs something to work from.',

  SOURCE_NOT_CONFIGURED: 'This job source is not configured on this deployment.',
  SOURCE_UNAVAILABLE: 'That job source is temporarily unavailable.',
  SOURCE_RATE_LIMITED: 'That job source is rate limiting us. Results may be incomplete.',
  SOURCE_FORBIDDEN_BY_ROBOTS: 'This site does not permit automated access to that page.',
  NO_JOBS_FOUND: 'No jobs found for this search.',

  AI_PROVIDER_NOT_CONFIGURED: 'No AI provider is configured. Add an API key in settings.',
  OAUTH_NOT_CONFIGURED: 'That sign-in provider is not configured on this deployment.',
  AI_RESPONSE_INVALID: 'The AI returned a response we could not verify, so nothing was saved.',
  AI_REQUEST_FAILED: 'The AI provider could not be reached.',

  NO_VERIFIED_CONTACT_FOUND: 'No verified public contact found.',
  OUTREACH_NOT_APPROVED: 'This message must be reviewed and approved before it can be sent.',
  OUTREACH_TRANSPORT_NOT_CONFIGURED: 'Email sending is not configured on this deployment.',

  AUTOMATED_APPLICATION_NOT_PERMITTED:
    'This platform does not permit automated applications. Use “Apply manually” to open the official application page.',
  APPLICATION_ALREADY_EXISTS: 'You already have an application tracked for this job.',
  INVALID_STATE_TRANSITION: 'That is not a valid next step for this application.',
};
