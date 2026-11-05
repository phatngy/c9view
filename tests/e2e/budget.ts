// session-one's API envelope is ~1,223 bytes, plus 64 bytes of cursor slack.
// Its messages are 191, 325 and 234 bytes: 1,600 fits one per page and cuts
// the assistant message, while preserving the prompt and tool result.
export const pageBudgetBytes = 1600;
export const budgetBaseURL = 'http://127.0.0.1:7792';
