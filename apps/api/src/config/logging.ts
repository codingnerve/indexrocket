/**
 * The redaction rules live in @indexrocket/utils so the API request log and the
 * worker log apply exactly the same ones.
 */
export { redactUrlForLog as sanitizeUrlForLog } from '@indexrocket/utils';
