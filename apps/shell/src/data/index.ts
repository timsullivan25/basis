import { IndexedDbCompanyRepository } from './indexedDbCompanyRepository';
import type { CompanyRepository } from './types';

export type { Company, CompanyRepository, CreateCompanyInput } from './types';

// The one place that picks which adapter backs the app. Swapping to a real
// API later is a new class implementing CompanyRepository and a change here.
export const companyRepository: CompanyRepository = new IndexedDbCompanyRepository();
