import { configure } from '@testing-library/react';

/**
 * CI runners are slower and shared, so give DOM assertions a generous window.
 * This is a ceiling, not a delay: a passing assertion still resolves immediately.
 */
configure({ asyncUtilTimeout: 15000 });
