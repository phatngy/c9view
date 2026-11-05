// The current session-one response envelope is about 1.2 KB, so 1,600 bytes
// fits the envelope and a typical message but forces multiple pages. The split
// depends on the fixture, serialized fields, cursors, and JSON number formatting.
export const pageBudgetBytes = 1600;
export const defaultServerBaseURL = 'http://127.0.0.1:7791';
export const budgetBaseURL = 'http://127.0.0.1:7792';
