import type { StatementSchema } from '../types';
import abbreviatedModel from './default-abbreviated-model.json';

/** Templates exported from the app and kept in the repo, so they come back whenever the
 *  statementSchema store is empty (first run, or after a DB version bump). To update one,
 *  re-export it from the template library and overwrite its JSON file here. */
export function createBundledTemplates(): StatementSchema[] {
  return [abbreviatedModel as unknown as StatementSchema];
}
